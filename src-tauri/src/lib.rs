mod models;
mod db;
mod cli_adapter;
mod state_manager;
mod process_pool;
mod heartbeat;
mod work_session;
mod event_translator;
mod commands;

use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent, WindowEvent,
};

pub struct AppState {
    pub db: Arc<db::Database>,
    pub process_pool: Arc<process_pool::ProcessPool>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Arc::new(db::Database::new().expect("Failed to initialize database"));
    let pool = Arc::new(process_pool::ProcessPool::new(3));

    let app_state = AppState {
        db: db.clone(),
        process_pool: pool.clone(),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
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
                        println!("[tray] Pause All Agents clicked — not yet implemented");
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            api.prevent_exit();
        }
    });
}
