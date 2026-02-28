use chrono::Utc;
use std::fs;
use tauri::Emitter;
use uuid::Uuid;

use crate::cli_adapter::detect_claude_path;
use crate::models::*;
use crate::state_manager::StateManager;
use crate::AppState;

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
        max_session_duration_secs: 900,
        created_at: Utc::now().to_rfc3339(),
        last_heartbeat_at: None,
        total_sessions: 0,
        personality: req.personality,
        checkin_interval_secs: req.checkin_interval_secs,
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
        max_session_duration_secs: 900,
        created_at: Utc::now().to_rfc3339(),
        last_heartbeat_at: None,
        total_sessions: 0,
        personality: req.personality,
        checkin_interval_secs: req.checkin_interval_secs,
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
pub async fn read_text_file(path: String) -> Result<String, String> {
    let expanded = expand_home(&path);
    let canonical = std::fs::canonicalize(&expanded)
        .map_err(|e| format!("Could not read file: {e}"))?;

    let home = std::env::var("HOME").map_err(|_| "Could not determine HOME directory")?;
    let home_path = std::path::Path::new(&home);

    if !canonical.starts_with(home_path) {
        return Err("Reading files outside your home directory is not allowed".into());
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
