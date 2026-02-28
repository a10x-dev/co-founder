mod models;
mod db;
mod cli_adapter;
mod state_manager;
mod process_pool;
mod heartbeat;
mod work_session;
mod event_translator;
mod commands;

use std::sync::{Arc, RwLock};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Listener, Manager, RunEvent, WindowEvent,
};
use uuid::Uuid;

pub struct AppState {
    pub db: Arc<db::Database>,
    pub process_pool: Arc<process_pool::ProcessPool>,
    pub heartbeat: Arc<heartbeat::HeartbeatScheduler>,
    pub cli: Arc<RwLock<cli_adapter::CliAdapter>>,
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
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "open", "Open Agent Founder", true, None::<&str>)?;
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

            let icon = app.default_window_icon().cloned().unwrap();
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
                        if let Ok(agents) = state.db.get_agents() {
                            for agent in agents
                                .into_iter()
                                .filter(|a| a.status == models::AgentStatus::Running)
                            {
                                let agent_id = agent.id.to_string();
                                state.heartbeat.stop_agent_heartbeat(&agent_id);
                                let _ = state.process_pool.kill_agent(&agent_id);
                                let _ = state
                                    .db
                                    .update_agent_status(&agent.id, &models::AgentStatus::Paused);
                            }
                        }
                    }
                    "quit" => {
                        let state = app.state::<AppState>();
                        state.heartbeat.stop_all();
                        let _ = state.process_pool.kill_all();
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

                let db = db.clone();
                let process_pool = process_pool.clone();
                let heartbeat = heartbeat.clone();
                let cli = cli.clone();
                let app_handle = app_handle.clone();

                tauri::async_runtime::spawn(async move {
                    run_heartbeat_tick(agent_id, db, process_pool, heartbeat, cli, app_handle).await;
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
            commands::get_global_settings,
            commands::update_global_settings,
            commands::start_agent,
            commands::pause_agent,
            commands::stop_agent,
            commands::import_agent,
            commands::read_text_file,
            commands::detect_claude_cli,
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
                state.heartbeat.stop_all();
                let _ = state.process_pool.kill_all();
            }
        }
    });
}

fn fail_agent(
    db: &db::Database,
    heartbeat: &heartbeat::HeartbeatScheduler,
    agent_id: &str,
    agent_uuid: &Uuid,
    status: models::AgentStatus,
) {
    if let Ok(current) = db.get_agent(agent_uuid) {
        if current.status == models::AgentStatus::Running {
            heartbeat.stop_agent_heartbeat(agent_id);
            let _ = db.update_agent_status(agent_uuid, &status);
        }
    }
}

async fn run_heartbeat_tick(
    agent_id: String,
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

    if agent.status != models::AgentStatus::Running {
        return;
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
        let result = work_session::WorkSessionEngine::run_session(
            &cli_adapter,
            &agent_for_session,
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
        Ok(Ok(log)) => {
            match log.outcome {
                models::SessionOutcome::Blocked => {
                    fail_agent(&db, &heartbeat, &agent_id, &agent_uuid, models::AgentStatus::Paused);
                }
                models::SessionOutcome::Error => {
                    fail_agent(&db, &heartbeat, &agent_id, &agent_uuid, models::AgentStatus::Error);
                }
                _ => {}
            }
            let _ = app_handle.emit("session-completed", log);
        }
        Ok(Err(err)) => {
            fail_agent(&db, &heartbeat, &agent_id, &agent_uuid, models::AgentStatus::Error);
            let _ = app_handle.emit(
                "session-runtime-error",
                serde_json::json!({ "agent_id": agent_id, "error": err }),
            );
        }
        Err(join_err) => {
            fail_agent(&db, &heartbeat, &agent_id, &agent_uuid, models::AgentStatus::Error);
            let _ = app_handle.emit(
                "session-runtime-error",
                serde_json::json!({ "agent_id": agent_id, "error": format!("Runtime join error: {join_err}") }),
            );
        }
    }
}
