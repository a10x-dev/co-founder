mod models;
mod db;
mod crypto;
mod cli_adapter;
mod state_manager;
mod process_pool;
mod heartbeat;
mod work_session;
mod commands;
mod daily_report;

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Listener, Manager, RunEvent, WindowEvent,
};
use uuid::Uuid;

pub struct PairSessionHandle {
    pub sender: tokio::sync::mpsc::Sender<LiveMessage>,
    pub session_id: String,
    pub cancelled: Arc<AtomicBool>,
}

#[derive(Clone)]
pub enum LiveMessage {
    UserMessage(String),
    End,
}

pub struct AppState {
    pub db: Arc<db::Database>,
    pub process_pool: Arc<process_pool::ProcessPool>,
    pub heartbeat: Arc<heartbeat::HeartbeatScheduler>,
    pub cli: Arc<RwLock<cli_adapter::CliAdapter>>,
    pub pair_sessions: Arc<Mutex<HashMap<String, PairSessionHandle>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Arc::new(db::Database::new().expect("Failed to initialize database"));
    let settings = db
        .get_global_settings()
        .expect("Failed to load global settings");

    let pool = Arc::new(process_pool::ProcessPool::new(
        settings.max_concurrent_agents.max(1) as usize,
    ));
    let heartbeat = Arc::new(heartbeat::HeartbeatScheduler::new());
    let cli = Arc::new(RwLock::new(cli_adapter::CliAdapter::new(
        settings.claude_cli_path.clone(),
    )));

    let app_state = AppState {
        db: db.clone(),
        process_pool: pool.clone(),
        heartbeat: heartbeat.clone(),
        cli: cli.clone(),
        pair_sessions: Arc::new(Mutex::new(HashMap::new())),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "open", "Open Co-Founder", true, None::<&str>)?;
            let pause_item = MenuItem::with_id(app, "pause_all", "Pause All Agents", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &open_item,
                    &tauri::menu::PredefinedMenuItem::separator(app)?,
                    &pause_item,
                    &tauri::menu::PredefinedMenuItem::separator(app)?,
                    &quit_item,
                ],
            )?;

            let tray_icon_bytes = include_bytes!("../icons/tray-icon.png");
            let icon = tauri::image::Image::from_bytes(tray_icon_bytes)?;
            TrayIconBuilder::new()
                .icon(icon)
                .icon_as_template(true)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "pause_all" => {
                        let state = app.state::<AppState>();
                        pause_running_agents(
                            state.db.as_ref(),
                            state.process_pool.as_ref(),
                            state.heartbeat.as_ref(),
                        );
                    }
                    "quit" => {
                        let state = app.state::<AppState>();
                        pause_running_agents(
                            state.db.as_ref(),
                            state.process_pool.as_ref(),
                            state.heartbeat.as_ref(),
                        );
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            let state = app.state::<AppState>();
            let db = state.db.clone();
            let db_for_startup = db.clone();
            let process_pool = state.process_pool.clone();
            let heartbeat = state.heartbeat.clone();
            let cli = state.cli.clone();
            let app_handle = app.handle().clone();

            // Recover stale pair sessions if app exited unexpectedly during a pair run.
            let _ = db.recover_interrupted_pair_sessions();

            // If the app was exited unexpectedly, stale "running" statuses can remain.
            // Normalize them to paused so UI and runtime state are consistent at launch.
            pause_running_agents(db.as_ref(), process_pool.as_ref(), heartbeat.as_ref());

            app.listen("heartbeat-tick", move |event| {
                let payload = event.payload();

                let parsed: serde_json::Value = match serde_json::from_str(payload) {
                    Ok(value) => value,
                    Err(_) => return,
                };

                let agent_id = match parsed.get("agent_id").and_then(|v| v.as_str()) {
                    Some(id) => id.to_string(),
                    None => return,
                };
                let reason = parsed
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let db = db.clone();
                let process_pool = process_pool.clone();
                let heartbeat = heartbeat.clone();
                let cli = cli.clone();
                let app_handle = app_handle.clone();

                tauri::async_runtime::spawn(async move {
                    run_heartbeat_tick(agent_id, reason, db, process_pool, heartbeat, cli, app_handle).await;
                });
            });

            {
                let settings = db_for_startup.get_global_settings().ok();
                let cli_path = settings
                    .as_ref()
                    .map(|s| s.claude_cli_path.clone())
                    .unwrap_or_default();

                let needs_warning = if !cli_path.is_empty() {
                    !std::path::Path::new(&cli_path).exists()
                } else {
                    cli_adapter::detect_claude_path().is_none()
                };

                if needs_warning {
                    let app_handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(1200)).await;
                        let _ = app_handle.emit(
                            "cli-missing",
                            serde_json::json!({
                                "message": "Claude CLI not found. Install Claude CLI or configure the path in Settings."
                            }),
                        );
                    });
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let minimize = state
                    .db
                    .get_global_settings()
                    .map(|s| s.minimize_to_tray)
                    .unwrap_or(true);

                if minimize {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_agents,
            commands::get_agent,
            commands::create_agent,
            commands::update_agent_status,
            commands::delete_agent,
            commands::get_work_sessions,
            commands::get_work_sessions_export,
            commands::get_global_settings,
            commands::update_global_settings,
            commands::start_agent,
            commands::pause_agent,
            commands::stop_agent,
            commands::import_agent,
            commands::read_text_file,
            commands::inspect_project_folder,
            commands::detect_claude_cli,
            commands::install_claude_cli,
            commands::check_claude_cli_status,
            commands::get_agent_env_vars,
            commands::set_agent_env_var,
            commands::delete_agent_env_var,
            commands::write_text_file,
            commands::trigger_manual_session,
            commands::send_message_to_agent,
            commands::update_autonomy_level,
            commands::check_workspace_health,
            commands::repair_workspace,
            commands::read_artifacts_manifest,
            commands::read_tools_manifest,
            commands::generate_daily_report,
            commands::get_daily_reports,
            commands::clone_agent,
            commands::clear_agent_sessions,
            commands::get_db_size,
            commands::get_integrations,
            commands::save_integration,
            commands::remove_integration,
            commands::get_claude_version_cmd,
            commands::update_daily_budget,
            commands::get_spend_breakdown,
            commands::git_create_branch,
            commands::git_get_status,
            commands::git_get_diff,
            commands::git_rollback,
            commands::git_undo_last_session,
            commands::get_task_board,
            commands::move_task,
            commands::get_schedule,
            commands::save_schedule_entry,
            commands::delete_schedule_entry,
            commands::toggle_schedule_entry,
            commands::save_inbox_images,
            commands::update_agent_behavior,
            commands::start_pair_session,
            commands::send_pair_message,
            commands::end_pair_session,
            commands::get_pair_session_messages,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            let state = app_handle.state::<AppState>();
            let minimize = state
                .db
                .get_global_settings()
                .map(|s| s.minimize_to_tray)
                .unwrap_or(true);

            if minimize {
                api.prevent_exit();
            } else {
                pause_running_agents(
                    state.db.as_ref(),
                    state.process_pool.as_ref(),
                    state.heartbeat.as_ref(),
                );
            }
        }
    });
}

fn pause_running_agents(
    db: &db::Database,
    process_pool: &process_pool::ProcessPool,
    heartbeat: &heartbeat::HeartbeatScheduler,
) {
    if let Ok(agents) = db.get_agents() {
        for agent in agents
            .into_iter()
            .filter(|a| a.status == models::AgentStatus::Running)
        {
            let agent_id = agent.id.to_string();
            heartbeat.stop_agent_heartbeat(&agent_id);
            let _ = process_pool.kill_agent(&agent_id);
            let _ = db.update_agent_status(&agent.id, &models::AgentStatus::Paused);
        }
    }
}

fn permanently_fail_agent(
    db: &db::Database,
    heartbeat: &heartbeat::HeartbeatScheduler,
    agent_id: &str,
    agent_uuid: &Uuid,
    status: models::AgentStatus,
) {
    heartbeat.stop_agent_heartbeat(agent_id);
    let _ = db.update_agent_status(agent_uuid, &status);
}

async fn run_heartbeat_tick(
    agent_id: String,
    reason: Option<String>,
    db: Arc<db::Database>,
    process_pool: Arc<process_pool::ProcessPool>,
    heartbeat: Arc<heartbeat::HeartbeatScheduler>,
    cli: Arc<RwLock<cli_adapter::CliAdapter>>,
    app_handle: tauri::AppHandle,
) {
    if process_pool.is_busy(&agent_id) {
        return;
    }

    let agent_uuid = match Uuid::parse_str(&agent_id) {
        Ok(uuid) => uuid,
        Err(_) => return,
    };

    let agent = match db.get_agent(&agent_uuid) {
        Ok(agent) => agent,
        Err(_) => return,
    };

    if agent.daily_budget_usd > 0.0 {
        if let Ok(daily_spend) = db.get_daily_spend(&agent_uuid) {
            if daily_spend >= agent.daily_budget_usd {
                let _ = db.update_agent_status(&agent_uuid, &models::AgentStatus::Paused);
                heartbeat.stop_agent_heartbeat(&agent_id);
                let _ = app_handle.emit("budget-exceeded", serde_json::json!({
                    "agent_id": agent_id,
                    "agent_name": agent.name,
                    "daily_spend": daily_spend,
                    "budget": agent.daily_budget_usd,
                }));
                return;
            }
        }
    }

    if daily_report::is_report_hour() && daily_report::should_generate_report(&agent) {
        if let Ok(report) = daily_report::build_report(&agent, &db) {
            let _ = app_handle.emit("daily-report-ready", serde_json::json!({
                "agent_id": agent_id,
                "agent_name": agent.name,
                "preview": report.lines().take(5).collect::<Vec<_>>().join("\n"),
            }));
        }
    }

    match agent.status {
        models::AgentStatus::Running => {}
        models::AgentStatus::Error => {
            if agent.consecutive_errors >= models::MAX_CONSECUTIVE_ERRORS {
                heartbeat.stop_agent_heartbeat(&agent_id);
                return;
            }
            // Apply backoff: skip heartbeats based on error count.
            // Error 1 → wait 1 tick, Error 2 → wait 2 ticks, etc.
            // We use last_error_at to calculate cooldown.
            if let Some(ref last_error) = agent.last_error_at {
                if let Ok(error_time) = chrono::DateTime::parse_from_rfc3339(last_error) {
                    let cooldown_secs = 60u64 * (1u64 << agent.consecutive_errors.min(6));
                    let elapsed = chrono::Utc::now()
                        .signed_duration_since(error_time)
                        .num_seconds() as u64;
                    if elapsed < cooldown_secs {
                        return;
                    }
                }
            }
            let _ = db.update_agent_status(&agent_uuid, &models::AgentStatus::Running);
        }
        _ => return,
    }

    if !process_pool.mark_pending(&agent_id) {
        return;
    }

    let _permit = match process_pool.try_acquire() {
        Ok(permit) => permit,
        Err(_) => {
            process_pool.clear_pending(&agent_id);
            return;
        }
    };

    let cli_adapter = match cli.read() {
        Ok(cli) => cli.clone(),
        Err(_) => {
            process_pool.clear_pending(&agent_id);
            return;
        }
    };

    let db_for_session = db.clone();
    let pool_for_session = process_pool.clone();
    let app_for_session = app_handle.clone();
    let agent_for_session = agent.clone();
    let agent_id_for_session = agent_id.clone();

    let session_result = tauri::async_runtime::spawn_blocking(move || {
        let trigger = if reason.as_deref() == Some("manual") {
            models::SessionTrigger::Manual
        } else {
            models::SessionTrigger::Heartbeat
        };
        let result = work_session::WorkSessionEngine::run_session(
            &cli_adapter,
            &agent_for_session,
            trigger,
            &pool_for_session,
            &db_for_session,
            app_for_session,
        );
        pool_for_session.clear_pending(&agent_id_for_session);
        result
    })
    .await;

    let now = chrono::Utc::now().to_rfc3339();
    let _ = db.update_last_heartbeat(&agent_uuid, &now);

    match session_result {
        Ok(Ok(session_result)) => {
            let log = session_result.log;
            let requested_interval = session_result.requested_next_checkin_secs;

            match log.outcome {
                models::SessionOutcome::Blocked => {
                    permanently_fail_agent(&db, &heartbeat, &agent_id, &agent_uuid, models::AgentStatus::Paused);
                }
                models::SessionOutcome::Error | models::SessionOutcome::RateLimited => {
                    let new_count = db.increment_consecutive_errors(&agent_uuid).unwrap_or(1);
                    if new_count >= models::MAX_CONSECUTIVE_ERRORS {
                        permanently_fail_agent(&db, &heartbeat, &agent_id, &agent_uuid, models::AgentStatus::Error);
                    } else {
                        let _ = db.update_agent_status(&agent_uuid, &models::AgentStatus::Error);
                    }
                }
                models::SessionOutcome::Interrupted => {
                    // Neutral — user or system interrupted a pair session; preserve error state.
                }
                models::SessionOutcome::Completed | models::SessionOutcome::Timeout => {
                    let _ = db.reset_consecutive_errors(&agent_uuid);

                    let base = agent.checkin_interval_secs;
                    let was_noop = log.summary == "Nothing to do";

                    let effective_interval = if was_noop {
                        base
                    } else if let Some(req) = requested_interval {
                        req.clamp(60, 86400)
                    } else {
                        base
                    };

                    if effective_interval != base || requested_interval.is_some() {
                        heartbeat.update_interval(&agent_id, effective_interval, app_handle.clone());
                        let _ = db.update_checkin_interval(&agent_uuid, effective_interval);
                    }

                    let _ = app_handle.emit("agent-output", serde_json::json!({
                        "agent_id": agent_id,
                        "type": "tempo_change",
                        "interval_secs": effective_interval,
                        "was_noop": was_noop,
                        "message": if was_noop {
                            format!("Nothing to do — checking back in {}",
                                if effective_interval >= 3600 { format!("{}h", effective_interval / 3600) }
                                else { format!("{}m", effective_interval / 60) })
                        } else {
                            format!("Co-founder set next check-in to {}",
                                if effective_interval >= 3600 { format!("{}h", effective_interval / 3600) }
                                else { format!("{}m", effective_interval / 60) })
                        },
                    }));
                }
            }
            let _ = app_handle.emit("session-completed", &log);
        }
        Ok(Err(err)) => {
            let new_count = db.increment_consecutive_errors(&agent_uuid).unwrap_or(1);
            if new_count >= models::MAX_CONSECUTIVE_ERRORS {
                permanently_fail_agent(&db, &heartbeat, &agent_id, &agent_uuid, models::AgentStatus::Error);
            } else {
                let _ = db.update_agent_status(&agent_uuid, &models::AgentStatus::Error);
            }
            let _ = app_handle.emit(
                "session-runtime-error",
                serde_json::json!({ "agent_id": agent_id, "error": err }),
            );
        }
        Err(join_err) => {
            let new_count = db.increment_consecutive_errors(&agent_uuid).unwrap_or(1);
            if new_count >= models::MAX_CONSECUTIVE_ERRORS {
                permanently_fail_agent(&db, &heartbeat, &agent_id, &agent_uuid, models::AgentStatus::Error);
            } else {
                let _ = db.update_agent_status(&agent_uuid, &models::AgentStatus::Error);
            }
            let _ = app_handle.emit(
                "session-runtime-error",
                serde_json::json!({ "agent_id": agent_id, "error": format!("Runtime join error: {join_err}") }),
            );
        }
    }
}
