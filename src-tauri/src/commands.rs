use chrono::{Datelike, Utc};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::cli_adapter::{detect_claude_path, get_claude_version};
use crate::models::*;
use crate::state_manager::StateManager;
use crate::{AppState, LiveMessage, LiveSessionHandle};

#[derive(Clone, Debug, Serialize)]
pub struct WorkspaceHealthResponse {
    pub healthy: bool,
    pub missing_files: Vec<String>,
    pub workspace_exists: bool,
    pub founder_exists: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct FolderInspectionResponse {
    pub detected_type: Option<String>,
    pub already_has_founder: bool,
    pub readme_summary: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct LiveSessionStartResponse {
    pub agent_id: String,
    pub session_id: String,
}

#[tauri::command]
pub async fn get_agents(state: tauri::State<'_, AppState>) -> Result<Vec<Agent>, String> {
    state.db.get_agents()
}

#[tauri::command]
pub async fn get_agent(id: String, state: tauri::State<'_, AppState>) -> Result<Agent, String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.get_agent(&uuid)
}

#[tauri::command]
pub async fn create_agent(
    req: CreateAgentRequest,
    state: tauri::State<'_, AppState>,
) -> Result<Agent, String> {
    let settings = state.db.get_global_settings()?;
    let workspace = StateManager::create_workspace(
        &settings.default_workspace_root,
        &req.name,
        &req.personality,
        &req.mission,
    )?;

    let agent = Agent {
        id: Uuid::new_v4(),
        name: req.name,
        workspace: workspace.clone(),
        soul_path: format!("{}/.founder/SOUL.md", workspace),
        mission: req.mission,
        autonomy_level: AutonomyLevel::from_str(&req.autonomy_level),
        allowed_tools: String::new(),
        status: AgentStatus::Idle,
        current_session_id: None,
        max_session_duration_secs: 1800,
        created_at: Utc::now().to_rfc3339(),
        last_heartbeat_at: None,
        total_sessions: 0,
        personality: req.personality,
        checkin_interval_secs: req.checkin_interval_secs,
        consecutive_errors: 0,
        last_error_at: None,
        daily_budget_usd: 0.0,
    };

    state.db.create_agent(&agent)?;
    Ok(agent)
}

#[tauri::command]
pub async fn update_agent_status(
    id: String,
    status: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent_status = AgentStatus::from_str(&status);
    state.db.update_agent_status(&uuid, &agent_status)
}

#[tauri::command]
pub async fn get_work_sessions(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<WorkSessionLog>, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.get_work_sessions(&uuid)
}

#[tauri::command]
pub async fn get_work_sessions_export(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<WorkSessionLog>, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.get_work_sessions_export(&uuid)
}

#[tauri::command]
pub async fn get_global_settings(
    state: tauri::State<'_, AppState>,
) -> Result<GlobalSettings, String> {
    state.db.get_global_settings()
}

#[tauri::command]
pub async fn update_global_settings(
    settings: GlobalSettings,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.db.update_global_settings(&settings)?;

    if let Ok(mut cli) = state.cli.write() {
        *cli = crate::cli_adapter::CliAdapter::new(settings.claude_cli_path.clone());
    }

    state
        .process_pool
        .update_max_concurrent(settings.max_concurrent_agents.max(1) as usize);

    Ok(())
}

#[tauri::command]
pub async fn start_agent(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;

    let _ = state.db.reset_consecutive_errors(&uuid);
    state.db.update_agent_status(&uuid, &AgentStatus::Running)?;
    state
        .heartbeat
        .start_agent_heartbeat(id.clone(), agent.checkin_interval_secs, app.clone());

    let payload = serde_json::json!({
        "agent_id": id,
        "timestamp": Utc::now().to_rfc3339(),
        "reason": "start",
    });
    let _ = app.emit("heartbeat-tick", payload);

    Ok(())
}

#[tauri::command]
pub async fn pause_agent(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.heartbeat.stop_agent_heartbeat(&id);
    let _ = state.process_pool.kill_agent(&id);
    state.db.update_agent_status(&uuid, &AgentStatus::Paused)
}

#[tauri::command]
pub async fn stop_agent(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.heartbeat.stop_agent_heartbeat(&id);
    let _ = state.process_pool.kill_agent(&id);
    state.db.update_agent_status(&uuid, &AgentStatus::Idle)
}

#[tauri::command]
pub async fn import_agent(
    req: ImportAgentRequest,
    state: tauri::State<'_, AppState>,
) -> Result<Agent, String> {
    let expanded = expand_home(&req.workspace_path);
    let founder_dir = format!("{}/.founder", expanded.trim_end_matches('/'));
    let already_exists = std::path::Path::new(&founder_dir).exists();

    let workspace = if already_exists {
        expanded
    } else {
        StateManager::init_existing_workspace(&expanded, &req.personality, &req.mission)?
    };

    let agent = Agent {
        id: Uuid::new_v4(),
        name: req.name,
        workspace: workspace.clone(),
        soul_path: format!("{}/.founder/SOUL.md", workspace),
        mission: req.mission,
        autonomy_level: AutonomyLevel::from_str(&req.autonomy_level),
        allowed_tools: String::new(),
        status: AgentStatus::Idle,
        current_session_id: None,
        max_session_duration_secs: 1800,
        created_at: Utc::now().to_rfc3339(),
        last_heartbeat_at: None,
        total_sessions: 0,
        personality: req.personality,
        checkin_interval_secs: req.checkin_interval_secs,
        consecutive_errors: 0,
        last_error_at: None,
        daily_budget_usd: 0.0,
    };

    state.db.create_agent(&agent)?;
    Ok(agent)
}

#[tauri::command]
pub async fn delete_agent(
    id: String,
    remove_founder_files: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let remove_founder = remove_founder_files.unwrap_or(false);

    state.heartbeat.stop_agent_heartbeat(&id);
    let _ = state.process_pool.kill_agent(&id);

    if let Ok(mut sessions) = state.live_sessions.lock() {
        if let Some(handle) = sessions.remove(&id) {
            handle.cancelled.store(true, Ordering::Relaxed);
            let _ = handle.sender.try_send(LiveMessage::End);
        }
    }

    if remove_founder {
        let agent = state.db.get_agent(&uuid)?;
        let founder_path = format!("{}/.founder", agent.workspace.trim_end_matches('/'));
        if std::path::Path::new(&founder_path).exists() {
            fs::remove_dir_all(&founder_path)
                .map_err(|e| format!("Failed to remove .founder files: {e}"))?;
        }
    }

    state.db.delete_agent(&uuid)
}

#[tauri::command]
pub async fn read_text_file(
    agent_id: String,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let expanded = expand_home(&path);
    let canonical =
        std::fs::canonicalize(&expanded).map_err(|e| format!("Could not read file: {e}"))?;
    let workspace = std::fs::canonicalize(&agent.workspace)
        .map_err(|e| format!("Could not resolve workspace path: {e}"))?;

    if !canonical.starts_with(&workspace) {
        return Err("Reading files outside the agent workspace is not allowed".into());
    }

    fs::read_to_string(canonical).map_err(|e| format!("Could not read file: {e}"))
}

fn expand_home(path: &str) -> String {
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{}{}", home, &path[1..]);
        }
    }
    path.to_string()
}

#[tauri::command]
pub async fn detect_claude_cli() -> Result<Option<String>, String> {
    Ok(detect_claude_path())
}

#[tauri::command]
pub async fn get_agent_env_vars(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AgentEnvVar>, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.get_agent_env_vars(&uuid)
}

#[tauri::command]
pub async fn set_agent_env_var(
    agent_id: String,
    key: String,
    value: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.set_agent_env_var(&uuid, &key, &value)
}

#[tauri::command]
pub async fn delete_agent_env_var(
    agent_id: String,
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.delete_agent_env_var(&uuid, &key)
}

#[tauri::command]
pub async fn write_text_file(
    agent_id: String,
    path: String,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let expanded = expand_home(&path);
    let canonical_parent = std::path::Path::new(&expanded)
        .parent()
        .ok_or("Invalid path")?;
    let resolved_parent = std::fs::canonicalize(canonical_parent)
        .map_err(|e| format!("Could not resolve path: {e}"))?;
    let workspace = std::fs::canonicalize(&agent.workspace)
        .map_err(|e| format!("Could not resolve workspace path: {e}"))?;

    if !resolved_parent.starts_with(&workspace) {
        return Err("Writing files outside the agent workspace is not allowed".into());
    }
    fs::write(&expanded, content).map_err(|e| format!("Could not write file: {e}"))
}

#[tauri::command]
pub async fn inspect_project_folder(path: String) -> Result<FolderInspectionResponse, String> {
    let expanded = expand_home(&path);
    let project = std::path::Path::new(&expanded);
    if !project.exists() {
        return Err("Folder does not exist".into());
    }
    if !project.is_dir() {
        return Err("Path is not a folder".into());
    }

    let markers: [(&str, &str); 9] = [
        ("package.json", "Node.js"),
        ("Cargo.toml", "Rust"),
        ("requirements.txt", "Python"),
        ("pyproject.toml", "Python"),
        ("go.mod", "Go"),
        ("pom.xml", "Java"),
        ("Gemfile", "Ruby"),
        ("composer.json", "PHP"),
        ("pubspec.yaml", "Flutter"),
    ];

    let detected_type = markers.iter().find_map(|(filename, label)| {
        let marker = project.join(filename);
        if marker.exists() {
            Some((*label).to_string())
        } else {
            None
        }
    });

    let already_has_founder = project.join(".founder").join("MISSION.md").exists();
    let readme_summary = project.join("README.md");
    let readme_summary = if readme_summary.exists() {
        match fs::read_to_string(readme_summary) {
            Ok(content) => {
                let summary = content
                    .lines()
                    .map(|l| l.trim())
                    .filter(|l| !l.is_empty() && !l.starts_with('#'))
                    .take(3)
                    .collect::<Vec<_>>()
                    .join(" ");
                if summary.is_empty() {
                    None
                } else {
                    Some(summary)
                }
            }
            Err(_) => None,
        }
    } else {
        None
    };

    Ok(FolderInspectionResponse {
        detected_type,
        already_has_founder,
        readme_summary,
    })
}

#[tauri::command]
pub async fn trigger_manual_session(
    id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;

    if agent.status != AgentStatus::Running {
        let _ = state.db.reset_consecutive_errors(&uuid);
        state.db.update_agent_status(&uuid, &AgentStatus::Running)?;
        state
            .heartbeat
            .start_agent_heartbeat(id.clone(), agent.checkin_interval_secs, app.clone());
    }

    let payload = serde_json::json!({
        "agent_id": id,
        "timestamp": Utc::now().to_rfc3339(),
        "reason": "manual",
    });
    let _ = app.emit("heartbeat-tick", payload);
    Ok(())
}

#[tauri::command]
pub async fn start_live_session(
    agent_id: String,
    message: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<LiveSessionStartResponse, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;

    let (receiver, live_session_id, cancelled) = {
        let mut sessions = state
            .live_sessions
            .lock()
            .map_err(|e| format!("Live session lock error: {e}"))?;

        if let Some(handle) = sessions.get(&agent_id) {
            if !handle.sender.is_closed() {
                return Ok(LiveSessionStartResponse {
                    agent_id,
                    session_id: handle.session_id.clone(),
                });
            }
            sessions.remove(&agent_id);
        }

        state.heartbeat.stop_agent_heartbeat(&agent_id);
        let _ = state.process_pool.kill_agent(&agent_id);
        let _ = state.db.reset_consecutive_errors(&uuid);

        let (sender, receiver) = mpsc::channel::<LiveMessage>(32);
        let session_id = Uuid::new_v4().to_string();
        let cancelled = Arc::new(AtomicBool::new(false));
        sessions.insert(
            agent_id.clone(),
            LiveSessionHandle {
                sender,
                session_id: session_id.clone(),
                cancelled: cancelled.clone(),
            },
        );
        (receiver, session_id, cancelled)
    };

    state.db.update_agent_status(&uuid, &AgentStatus::Running)?;

    let cli = state
        .cli
        .read()
        .map_err(|e| format!("CLI lock error: {e}"))?
        .clone();
    let db = state.db.clone();
    let pool = state.process_pool.clone();
    let heartbeat = state.heartbeat.clone();
    let live_sessions = state.live_sessions.clone();
    let app_handle = app.clone();
    let agent_id_for_task = agent_id.clone();
    let session_id_for_task = live_session_id.clone();

    tauri::async_runtime::spawn(async move {
        let run_result = crate::work_session::WorkSessionEngine::run_live_session(
            cli,
            agent,
            message,
            receiver,
            pool,
            db.clone(),
            app_handle.clone(),
            session_id_for_task.clone(),
            cancelled,
        )
        .await;
        crate::cli_adapter::clear_live_preview_urls(&session_id_for_task);

        if let Ok(mut sessions) = live_sessions.lock() {
            let should_remove = sessions
                .get(&agent_id_for_task)
                .map(|h| h.session_id == session_id_for_task)
                .unwrap_or(false);
            if should_remove {
                sessions.remove(&agent_id_for_task);
            }
        }

        if run_result.is_err() {
            let _ = app_handle.emit(
                "live-session-ended",
                serde_json::json!({
                    "agent_id": agent_id_for_task,
                    "session_id": session_id_for_task,
                    "summary": "Live session ended due to an unexpected runtime error.",
                }),
            );
        }

        if let Ok(agent_uuid) = Uuid::parse_str(&agent_id_for_task) {
            if heartbeat.get_interval(&agent_id_for_task).is_none() {
                let _ = db.update_agent_status(&agent_uuid, &AgentStatus::Idle);
            }
        }
    });

    Ok(LiveSessionStartResponse {
        agent_id,
        session_id: live_session_id,
    })
}

#[tauri::command]
pub async fn send_live_message(
    agent_id: String,
    session_id: String,
    message: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if message.trim().is_empty() {
        return Err("Message cannot be empty".to_string());
    }

    let sender = {
        let sessions = state
            .live_sessions
            .lock()
            .map_err(|e| format!("Live session lock error: {e}"))?;
        let handle = sessions
            .get(&agent_id)
            .ok_or("No active live session for this co-founder")?;
        if handle.session_id != session_id {
            return Err("Session mismatch — this live session is no longer active".to_string());
        }
        handle.sender.clone()
    };

    sender
        .send(LiveMessage::UserMessage(message))
        .await
        .map_err(|_| "Live session is no longer available".to_string())
}

#[tauri::command]
pub async fn end_live_session(
    agent_id: String,
    session_id: String,
    continue_autonomous: Option<bool>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let continue_autonomous = continue_autonomous.unwrap_or(true);
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;

    let sender = {
        let mut sessions = state
            .live_sessions
            .lock()
            .map_err(|e| format!("Live session lock error: {e}"))?;
        let handle = sessions
            .get(&agent_id)
            .ok_or("No active live session for this co-founder")?;
        if handle.session_id != session_id {
            return Err("Session mismatch — this live session is no longer active".to_string());
        }
        handle.cancelled.store(true, Ordering::Relaxed);
        let sender = handle.sender.clone();
        sessions.remove(&agent_id);
        sender
    };

    state.heartbeat.stop_agent_heartbeat(&agent_id);
    let _ = state.process_pool.kill_agent(&agent_id);
    let _ = sender.send(LiveMessage::End).await;

    if continue_autonomous {
        state.db.update_agent_status(&uuid, &AgentStatus::Running)?;
        state.heartbeat.start_agent_heartbeat(
            agent_id.clone(),
            agent.checkin_interval_secs,
            app.clone(),
        );
        let payload = serde_json::json!({
            "agent_id": agent_id,
            "timestamp": Utc::now().to_rfc3339(),
            "reason": "live-end",
        });
        let _ = app.emit("heartbeat-tick", payload);
    } else {
        state.db.update_agent_status(&uuid, &AgentStatus::Idle)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn send_message_to_agent(
    agent_id: String,
    message: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let inbox_path = format!(
        "{}/.founder/INBOX.md",
        agent.workspace.trim_end_matches('/')
    );
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M UTC").to_string();

    let entry = format!("\n---\n**[{}]** {}\n", now, message);

    let existing = fs::read_to_string(&inbox_path)
        .unwrap_or_else(|_| "# Inbox\n\nMessages from the user.\n".to_string());
    let updated = format!("{}{}", existing, entry);
    fs::write(&inbox_path, updated).map_err(|e| format!("Failed to write INBOX.md: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn update_autonomy_level(
    id: String,
    level: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let autonomy = AutonomyLevel::from_str(&level);
    state.db.update_autonomy_level(&uuid, &autonomy)
}

#[tauri::command]
pub async fn check_workspace_health(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<WorkspaceHealthResponse, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let health = StateManager::check_workspace_health(&agent.workspace);
    Ok(WorkspaceHealthResponse {
        healthy: health.healthy,
        missing_files: health.missing_files,
        workspace_exists: health.workspace_exists,
        founder_exists: health.founder_exists,
    })
}

#[tauri::command]
pub async fn repair_workspace(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    StateManager::repair_workspace(&agent.workspace, &agent.personality, &agent.mission)
}

#[tauri::command]
pub async fn read_artifacts_manifest(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let manifest_path = format!(
        "{}/.founder/artifacts/manifest.json",
        agent.workspace.trim_end_matches('/')
    );
    fs::read_to_string(&manifest_path).map_err(|_| "No artifacts manifest found".into())
}

#[tauri::command]
pub async fn read_tools_manifest(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let manifest_path = format!(
        "{}/.founder/tools/manifest.json",
        agent.workspace.trim_end_matches('/')
    );
    fs::read_to_string(&manifest_path).map_err(|_| "No tools manifest found".into())
}

#[tauri::command]
pub async fn generate_daily_report(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let report = crate::daily_report::build_report(&agent, &state.db)?;
    Ok(report)
}

#[tauri::command]
pub async fn get_daily_reports(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Value>, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let reports_dir = format!("{}/.founder/reports", agent.workspace.trim_end_matches('/'));
    let mut reports: Vec<Value> = Vec::new();
    if let Ok(entries) = fs::read_dir(&reports_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Ok(content) = fs::read_to_string(&path) {
                    let filename = path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string();
                    reports.push(serde_json::json!({
                        "date": filename,
                        "content": content,
                    }));
                }
            }
        }
    }
    reports.sort_by(|a, b| {
        b["date"]
            .as_str()
            .unwrap_or("")
            .cmp(a["date"].as_str().unwrap_or(""))
    });
    Ok(reports)
}

#[tauri::command]
pub async fn clone_agent(
    id: String,
    new_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<Agent, String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let source = state.db.get_agent(&uuid)?;
    let settings = state.db.get_global_settings()?;

    let workspace = StateManager::create_workspace(
        &settings.default_workspace_root,
        &new_name,
        &source.personality,
        &source.mission,
    )?;

    // Copy .founder files from source to new workspace
    let source_founder = format!("{}/.founder", source.workspace.trim_end_matches('/'));
    let dest_founder = format!("{}/.founder", workspace.trim_end_matches('/'));
    for filename in &[
        "SOUL.md",
        "MISSION.md",
        "MEMORY.md",
        "STATE.md",
        "HEARTBEAT.md",
        "INBOX.md",
    ] {
        let src_path = format!("{}/{}", source_founder, filename);
        let dest_path = format!("{}/{}", dest_founder, filename);
        if let Ok(content) = fs::read_to_string(&src_path) {
            let _ = fs::write(&dest_path, &content);
        }
    }

    // Copy .mcp.json
    let src_mcp = format!("{}/.mcp.json", source.workspace.trim_end_matches('/'));
    let dest_mcp = format!("{}/.mcp.json", workspace.trim_end_matches('/'));
    if let Ok(content) = fs::read_to_string(&src_mcp) {
        let _ = fs::write(&dest_mcp, &content);
    }

    let new_agent = Agent {
        id: Uuid::new_v4(),
        name: new_name,
        workspace: workspace.clone(),
        soul_path: format!("{}/.founder/SOUL.md", workspace),
        mission: source.mission,
        autonomy_level: source.autonomy_level,
        allowed_tools: source.allowed_tools,
        status: AgentStatus::Idle,
        current_session_id: None,
        max_session_duration_secs: source.max_session_duration_secs,
        created_at: Utc::now().to_rfc3339(),
        last_heartbeat_at: None,
        total_sessions: 0,
        personality: source.personality,
        checkin_interval_secs: source.checkin_interval_secs,
        consecutive_errors: 0,
        last_error_at: None,
        daily_budget_usd: source.daily_budget_usd,
    };

    state.db.create_agent(&new_agent)?;

    // Copy env vars
    if let Ok(env_vars) = state.db.get_agent_env_vars(&uuid) {
        for ev in env_vars {
            let _ = state
                .db
                .set_agent_env_var(&new_agent.id, &ev.key, &ev.value);
        }
    }

    Ok(new_agent)
}

#[tauri::command]
pub async fn clear_agent_sessions(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.clear_agent_sessions(&uuid)
}

#[tauri::command]
pub async fn get_db_size(state: tauri::State<'_, AppState>) -> Result<u64, String> {
    state.db.get_db_size_bytes()
}

#[tauri::command]
pub async fn get_integrations(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let mcp_path = format!("{}/.mcp.json", agent.workspace.trim_end_matches('/'));
    match fs::read_to_string(&mcp_path) {
        Ok(content) => Ok(content),
        Err(_) => Ok(r#"{"mcpServers":{}}"#.to_string()),
    }
}

#[tauri::command]
pub async fn save_integration(
    agent_id: String,
    server_key: String,
    command: String,
    args: Vec<String>,
    env: std::collections::HashMap<String, String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let mcp_path = format!("{}/.mcp.json", agent.workspace.trim_end_matches('/'));

    let mut mcp: Value = match fs::read_to_string(&mcp_path) {
        Ok(content) => {
            serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({"mcpServers": {}}))
        }
        Err(_) => serde_json::json!({"mcpServers": {}}),
    };

    let servers = mcp
        .as_object_mut()
        .and_then(|o| {
            o.entry("mcpServers")
                .or_insert_with(|| serde_json::json!({}))
                .as_object_mut()
        })
        .ok_or("Invalid .mcp.json structure")?;

    let server_config = serde_json::json!({
        "command": command,
        "args": args,
    });
    if !env.is_empty() {
        for (key, value) in env {
            state.db.set_agent_env_var(&uuid, &key, &value)?;
        }
    }

    servers.insert(server_key, server_config);

    let json_str = serde_json::to_string_pretty(&mcp)
        .map_err(|e| format!("JSON serialization failed: {e}"))?;
    fs::write(&mcp_path, json_str).map_err(|e| format!("Failed to write .mcp.json: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn remove_integration(
    agent_id: String,
    server_key: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let mcp_path = format!("{}/.mcp.json", agent.workspace.trim_end_matches('/'));

    let content = fs::read_to_string(&mcp_path).map_err(|_| "No .mcp.json found")?;
    let mut mcp: Value =
        serde_json::from_str(&content).map_err(|e| format!("Invalid JSON: {e}"))?;

    if let Some(servers) = mcp.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        servers.remove(&server_key);
    }

    let json_str = serde_json::to_string_pretty(&mcp)
        .map_err(|e| format!("JSON serialization failed: {e}"))?;
    fs::write(&mcp_path, json_str).map_err(|e| format!("Failed to write .mcp.json: {e}"))?;
    Ok(())
}

// --- CLI Version ---

#[tauri::command]
pub async fn get_claude_version_cmd() -> Result<String, String> {
    get_claude_version().ok_or_else(|| "Could not detect Claude CLI version".to_string())
}

// --- Budget ---

#[tauri::command]
pub async fn update_daily_budget(
    id: String,
    budget: f64,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.update_daily_budget(&uuid, budget)
}

#[tauri::command]
pub async fn get_spend_breakdown(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.get_spend_breakdown(&uuid)
}

// --- Git Safety ---

#[tauri::command]
pub async fn git_create_branch(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let branch_name = format!(
        "agent-founder/{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );

    let output = std::process::Command::new("git")
        .args(["checkout", "-b", &branch_name])
        .current_dir(&agent.workspace)
        .output()
        .map_err(|e| format!("Git error: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Git branch creation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(branch_name)
}

#[tauri::command]
pub async fn git_get_status(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;

    let is_repo = std::process::Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(&agent.workspace)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !is_repo {
        return Ok(serde_json::json!({ "is_repo": false }));
    }

    let branch = std::process::Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(&agent.workspace)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    let status = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&agent.workspace)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let changes: Vec<Value> = status
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let status_code = l.get(..2).unwrap_or("??").trim().to_string();
            let file = l.get(3..).unwrap_or("").to_string();
            serde_json::json!({ "status": status_code, "file": file })
        })
        .collect();

    let head_hash = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&agent.workspace)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    Ok(serde_json::json!({
        "is_repo": true,
        "branch": branch,
        "head": head_hash,
        "changes": changes,
        "changed_files": changes.len(),
    }))
}

#[tauri::command]
pub async fn git_get_diff(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;

    let output = std::process::Command::new("git")
        .args(["diff", "HEAD"])
        .current_dir(&agent.workspace)
        .output()
        .map_err(|e| format!("Git error: {e}"))?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub async fn git_rollback(
    agent_id: String,
    commit_hash: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;

    let output = std::process::Command::new("git")
        .args(["reset", "--hard", &commit_hash])
        .current_dir(&agent.workspace)
        .output()
        .map_err(|e| format!("Git error: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Git rollback failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn git_undo_last_session(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let sessions = state.db.get_work_sessions(&uuid)?;

    if sessions.is_empty() {
        return Err("No sessions to undo".to_string());
    }

    let last_session = &sessions[0];
    let started_at = &last_session.started_at;

    let output = std::process::Command::new("git")
        .args(["log", "--before", started_at, "-1", "--format=%H"])
        .current_dir(&agent.workspace)
        .output()
        .map_err(|e| format!("Git error: {e}"))?;

    let commit = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if commit.is_empty() {
        return Err("No commit found before this session".to_string());
    }

    let reset = std::process::Command::new("git")
        .args(["reset", "--hard", &commit])
        .current_dir(&agent.workspace)
        .output()
        .map_err(|e| format!("Git error: {e}"))?;

    if !reset.status.success() {
        return Err(format!(
            "Git reset failed: {}",
            String::from_utf8_lossy(&reset.stderr)
        ));
    }

    Ok(format!(
        "Rolled back to commit {}",
        &commit[..8.min(commit.len())]
    ))
}

// --- Task Board ---

#[tauri::command]
pub async fn get_task_board(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Value, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let tasks_path = format!(
        "{}/.founder/TASKS.md",
        agent.workspace.trim_end_matches('/')
    );

    let content = fs::read_to_string(&tasks_path).unwrap_or_else(|_| {
        "# Tasks\n\n## In Progress\n\n\n## To Do\n\n\n## Done\n\n\n## Blocked".to_string()
    });

    let mut columns: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    let mut current_col = String::new();

    for line in content.lines() {
        if line.starts_with("## ") {
            current_col = line[3..].trim().to_string();
            columns.entry(current_col.clone()).or_default();
        } else if (line.starts_with("- ") || line.starts_with("* ")) && !current_col.is_empty() {
            let task = line[2..].trim().to_string();
            if !task.is_empty() {
                columns.entry(current_col.clone()).or_default().push(task);
            }
        }
    }

    let col_order = ["In Progress", "To Do", "Done", "Blocked"];
    let board: Vec<Value> = col_order
        .iter()
        .map(|col| {
            serde_json::json!({
                "column": col,
                "tasks": columns.get(*col).cloned().unwrap_or_default(),
            })
        })
        .collect();

    Ok(serde_json::json!({ "columns": board }))
}

#[tauri::command]
pub async fn move_task(
    agent_id: String,
    task: String,
    from_column: String,
    to_column: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let tasks_path = format!(
        "{}/.founder/TASKS.md",
        agent.workspace.trim_end_matches('/')
    );

    let content = fs::read_to_string(&tasks_path).unwrap_or_default();
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

    let mut in_from = false;
    let mut removed = false;
    lines.retain(|line| {
        if line.starts_with("## ") {
            in_from = line[3..].trim() == from_column;
        }
        if in_from
            && (line.starts_with("- ") || line.starts_with("* "))
            && line[2..].trim() == task
            && !removed
        {
            removed = true;
            return false;
        }
        true
    });

    if !removed {
        return Err("Task not found in source column".to_string());
    }

    let mut new_lines = Vec::new();
    let mut inserted = false;
    for line in &lines {
        new_lines.push(line.clone());
        if !inserted && line.starts_with("## ") && line[3..].trim() == to_column {
            new_lines.push(format!("- {}", task));
            inserted = true;
        }
    }

    if !inserted {
        return Err(format!("Destination column not found: {to_column}"));
    }

    fs::write(&tasks_path, new_lines.join("\n"))
        .map_err(|e| format!("Failed to write TASKS.md: {e}"))?;
    Ok(())
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ScheduleEntry {
    pub id: String,
    pub time: String,
    pub action: String,
    pub recurrence: String,
    pub source: String,
    pub enabled: bool,
    pub last_run: Option<String>,
    pub day_of_week: Option<u8>,
}

fn parse_schedule(content: &str) -> Vec<ScheduleEntry> {
    let mut entries = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("- ") {
            continue;
        }
        let parts: Vec<&str> = trimmed[2..].split('|').map(|s| s.trim()).collect();
        if parts.len() < 5 {
            continue;
        }
        let id = if parts.len() > 5 {
            parts[5].to_string()
        } else {
            uuid::Uuid::new_v4().to_string()
        };
        let last_run = if parts.len() > 6 {
            Some(parts[6].to_string())
        } else {
            None
        };
        let day_of_week = if parts.len() > 7 {
            parts[7].parse().ok()
        } else {
            None
        };
        entries.push(ScheduleEntry {
            id,
            time: parts[0].to_string(),
            action: parts[1].to_string(),
            recurrence: parts[2].to_string(),
            source: parts[3].to_string(),
            enabled: parts[4] != "false",
            last_run,
            day_of_week,
        });
    }
    entries
}

fn serialize_schedule(entries: &[ScheduleEntry]) -> String {
    let mut out = String::from("# Schedule\n\nYour daily agenda. Both you and your human partner can add entries here.\nItems marked `[user]` were scheduled by your partner — treat them as commitments.\nItems marked `[cofounder]` were scheduled by you — adjust as needed.\n\nFormat: `- HH:MM | action description | recurrence | source | enabled`\n\n## Entries\n\n");
    for e in entries {
        out.push_str(&format!(
            "- {} | {} | {} | {} | {} | {} | {} | {}\n",
            e.time,
            e.action,
            e.recurrence,
            e.source,
            e.enabled,
            e.id,
            e.last_run.as_deref().unwrap_or(""),
            e.day_of_week.map_or(String::new(), |d| d.to_string()),
        ));
    }
    out
}

#[tauri::command]
pub async fn get_schedule(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ScheduleEntry>, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let content = StateManager::read_schedule(&agent.workspace);
    Ok(parse_schedule(&content))
}

#[tauri::command]
pub async fn save_schedule_entry(
    agent_id: String,
    entry: ScheduleEntry,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let mut normalized_entry = entry;
    if normalized_entry.recurrence == "weekly" {
        if normalized_entry.day_of_week.is_none() {
            normalized_entry.day_of_week =
                Some(chrono::Local::now().weekday().num_days_from_sunday() as u8);
        }
    } else {
        normalized_entry.day_of_week = None;
    }
    if normalized_entry.recurrence != "once" {
        normalized_entry.last_run = None;
    }

    let content = StateManager::read_schedule(&agent.workspace);
    let mut entries = parse_schedule(&content);
    if let Some(existing) = entries.iter_mut().find(|e| e.id == normalized_entry.id) {
        *existing = normalized_entry;
    } else {
        entries.push(normalized_entry);
    }
    entries.sort_by(|a, b| a.time.cmp(&b.time));
    StateManager::write_schedule(&agent.workspace, &serialize_schedule(&entries))
}

#[tauri::command]
pub async fn delete_schedule_entry(
    agent_id: String,
    entry_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let content = StateManager::read_schedule(&agent.workspace);
    let entries: Vec<ScheduleEntry> = parse_schedule(&content)
        .into_iter()
        .filter(|e| e.id != entry_id)
        .collect();
    StateManager::write_schedule(&agent.workspace, &serialize_schedule(&entries))
}

#[tauri::command]
pub async fn toggle_schedule_entry(
    agent_id: String,
    entry_id: String,
    enabled: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = state.db.get_agent(&uuid)?;
    let content = StateManager::read_schedule(&agent.workspace);
    let mut entries = parse_schedule(&content);
    if let Some(entry) = entries.iter_mut().find(|e| e.id == entry_id) {
        entry.enabled = enabled;
    }
    StateManager::write_schedule(&agent.workspace, &serialize_schedule(&entries))
}
