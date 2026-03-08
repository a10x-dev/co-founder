use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Listener};
use uuid::Uuid;

use crate::cli_adapter::CliAdapter;
use crate::db::Database;
use crate::heartbeat::HeartbeatScheduler;
use crate::models::AgentStatus;
use crate::process_pool::ProcessPool;
use crate::state_manager::StateManager;
use crate::{LiveMessage, PairSessionHandle};

// ── Telegram API types ────────────────────────────────────────────────────

#[derive(serde::Deserialize, Debug)]
struct TgResponse<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
}

#[derive(serde::Deserialize, Debug)]
struct TgUpdate {
    update_id: i64,
    message: Option<TgMessage>,
}

#[derive(serde::Deserialize, Debug)]
struct TgMessage {
    chat: TgChat,
    text: Option<String>,
}

#[derive(serde::Deserialize, Debug)]
struct TgChat {
    id: i64,
}

#[derive(serde::Deserialize, Debug)]
pub struct TgBotInfo {
    pub first_name: String,
    pub username: Option<String>,
}

// ── Config row ────────────────────────────────────────────────────────────

pub struct TelegramConfigRow {
    pub agent_id: String,
    pub bot_token: String,
    pub chat_id: Option<i64>,
    pub bot_username: Option<String>,
    pub enabled: bool,
}

// ── Bridge Manager ────────────────────────────────────────────────────────

struct BridgeHandle {
    cancel: Arc<AtomicBool>,
    cancel_notify: Arc<tokio::sync::Notify>,
}

pub struct TelegramBridgeManager {
    bridges: Mutex<HashMap<String, BridgeHandle>>,
}

impl TelegramBridgeManager {
    pub fn new() -> Self {
        Self {
            bridges: Mutex::new(HashMap::new()),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn start_bridge(
        &self,
        agent_id: String,
        bot_token: String,
        chat_id: Option<i64>,
        db: Arc<Database>,
        pair_sessions: Arc<Mutex<HashMap<String, PairSessionHandle>>>,
        heartbeat: Arc<HeartbeatScheduler>,
        process_pool: Arc<ProcessPool>,
        cli: Arc<std::sync::RwLock<CliAdapter>>,
        app_handle: AppHandle,
    ) {
        self.stop_bridge(&agent_id);

        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_notify = Arc::new(tokio::sync::Notify::new());
        let cancel_clone = cancel.clone();
        let notify_clone = cancel_notify.clone();
        let agent_id_clone = agent_id.clone();

        tauri::async_runtime::spawn(async move {
            bridge_loop(
                agent_id_clone,
                bot_token,
                chat_id,
                db,
                pair_sessions,
                heartbeat,
                process_pool,
                cli,
                app_handle,
                cancel_clone,
                notify_clone,
            )
            .await;
        });

        if let Ok(mut bridges) = self.bridges.lock() {
            bridges.insert(
                agent_id,
                BridgeHandle {
                    cancel,
                    cancel_notify,
                },
            );
        }
    }

    pub fn stop_bridge(&self, agent_id: &str) {
        if let Ok(mut bridges) = self.bridges.lock() {
            if let Some(handle) = bridges.remove(agent_id) {
                handle.cancel.store(true, Ordering::Relaxed);
                handle.cancel_notify.notify_one();
            }
        }
    }

    pub fn stop_all(&self) {
        if let Ok(mut bridges) = self.bridges.lock() {
            for (_, handle) in bridges.drain() {
                handle.cancel.store(true, Ordering::Relaxed);
                handle.cancel_notify.notify_one();
            }
        }
    }

    pub fn is_running(&self, agent_id: &str) -> bool {
        self.bridges
            .lock()
            .ok()
            .map(|b| b.contains_key(agent_id))
            .unwrap_or(false)
    }
}

// ── Telegram API helpers ──────────────────────────────────────────────────

async fn get_updates(
    client: &reqwest::Client,
    token: &str,
    offset: i64,
    timeout: u64,
) -> Result<Vec<TgUpdate>, String> {
    let url = format!("https://api.telegram.org/bot{}/getUpdates", token);
    let resp = client
        .get(&url)
        .query(&[
            ("offset", offset.to_string()),
            ("timeout", timeout.to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?;

    let body: TgResponse<Vec<TgUpdate>> =
        resp.json().await.map_err(|e| format!("Parse error: {e}"))?;

    if !body.ok {
        return Err(body
            .description
            .unwrap_or_else(|| "Unknown Telegram error".to_string()));
    }

    Ok(body.result.unwrap_or_default())
}

/// Convert GitHub-flavored markdown to Telegram-compatible markdown.
/// Telegram doesn't support `#` headers, `**bold**`, or `---` dividers.
fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn to_telegram_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for line in text.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("### ") {
            out.push_str(&format!("<b>{}</b>", escape_html(rest.trim())));
        } else if let Some(rest) = trimmed.strip_prefix("## ") {
            out.push_str(&format!("<b>{}</b>", escape_html(rest.trim())));
        } else if let Some(rest) = trimmed.strip_prefix("# ") {
            out.push_str(&format!("<b>{}</b>", escape_html(rest.trim())));
        } else if trimmed == "---" || trimmed == "***" || trimmed == "___" {
            out.push_str("———");
        } else {
            let escaped = escape_html(trimmed);
            let converted = replace_delimited(&escaped, "**", "<b>", "</b>");
            let converted = replace_delimited(&converted, "*", "<i>", "</i>");
            let converted = replace_delimited(&converted, "`", "<code>", "</code>");
            out.push_str(&converted);
        }
        out.push('\n');
    }
    while out.ends_with('\n') {
        out.pop();
    }
    out
}

/// Replace paired delimiters: `**foo**` → `<b>foo</b>`
fn replace_delimited(text: &str, delim: &str, open: &str, close: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        if let Some(start) = rest.find(delim) {
            result.push_str(&rest[..start]);
            let after_open = &rest[start + delim.len()..];
            if let Some(end) = after_open.find(delim) {
                result.push_str(open);
                result.push_str(&after_open[..end]);
                result.push_str(close);
                rest = &after_open[end + delim.len()..];
            } else {
                // No closing delimiter — keep literal
                result.push_str(delim);
                rest = after_open;
            }
        } else {
            result.push_str(rest);
            break;
        }
    }
    result
}

async fn send_message(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    text: &str,
) -> Result<(), String> {
    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    let formatted = to_telegram_html(text);

    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "text": formatted,
            "parse_mode": "HTML",
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    // If markdown parsing failed, retry as plain text
    if !status.is_success() || body.contains("\"ok\":false") {
        let _ = client
            .post(&url)
            .json(&serde_json::json!({
                "chat_id": chat_id,
                "text": text,
            }))
            .send()
            .await;
    }

    Ok(())
}

async fn send_chunked(client: &reqwest::Client, token: &str, chat_id: i64, text: &str) {
    const MAX_LEN: usize = 4096;
    if text.len() <= MAX_LEN {
        let _ = send_message(client, token, chat_id, text).await;
        return;
    }
    let mut remaining = text;
    while !remaining.is_empty() {
        let chunk_end = if remaining.len() <= MAX_LEN {
            remaining.len()
        } else {
            remaining[..MAX_LEN].rfind('\n').unwrap_or(MAX_LEN)
        };
        let _ = send_message(client, token, chat_id, &remaining[..chunk_end]).await;
        remaining = &remaining[chunk_end..];
    }
}

async fn send_typing(client: &reqwest::Client, token: &str, chat_id: i64) {
    let url = format!("https://api.telegram.org/bot{}/sendChatAction", token);
    let _ = client
        .post(&url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "action": "typing",
        }))
        .send()
        .await;
}

pub async fn verify_token(token: &str) -> Result<TgBotInfo, String> {
    let client = reqwest::Client::new();
    let url = format!("https://api.telegram.org/bot{}/getMe", token);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?;
    let body: TgResponse<TgBotInfo> = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;

    if !body.ok {
        return Err(body
            .description
            .unwrap_or_else(|| "Invalid token".to_string()));
    }
    body.result.ok_or_else(|| "No bot info returned".to_string())
}

// ── Bridge loop ───────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn bridge_loop(
    agent_id: String,
    bot_token: String,
    initial_chat_id: Option<i64>,
    db: Arc<Database>,
    pair_sessions: Arc<Mutex<HashMap<String, PairSessionHandle>>>,
    heartbeat: Arc<HeartbeatScheduler>,
    process_pool: Arc<ProcessPool>,
    cli: Arc<std::sync::RwLock<CliAdapter>>,
    app_handle: AppHandle,
    cancel: Arc<AtomicBool>,
    cancel_notify: Arc<tokio::sync::Notify>,
) {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .unwrap_or_default();

    let mut offset: i64 = 0;
    let mut chat_id: Option<i64> = initial_chat_id;
    let mut active_session_id: Option<String> = None;
    let mut last_message_at = Instant::now();
    let mut consecutive_errors: u32 = 0;

    // Turn-completion tracking via watch channel
    let turn_counter = Arc::new(AtomicU64::new(0));
    let (turn_count_tx, turn_count_rx) = tokio::sync::watch::channel(0u64);

    let counter_for_listener = turn_counter.clone();
    let agent_id_for_turn = agent_id.clone();
    let turn_listener = app_handle.listen("pair-turn-complete", move |event| {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            if v.get("agent_id").and_then(|a| a.as_str()) == Some(&agent_id_for_turn) {
                let new_val = counter_for_listener.fetch_add(1, Ordering::Relaxed) + 1;
                let _ = turn_count_tx.send(new_val);
            }
        }
    });

    // Session-ended tracking
    let session_end_notify = Arc::new(tokio::sync::Notify::new());
    let session_end_clone = session_end_notify.clone();
    let agent_id_for_end = agent_id.clone();
    let end_listener = app_handle.listen("pair-session-ended", move |event| {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            if v.get("agent_id").and_then(|a| a.as_str()) == Some(&agent_id_for_end) {
                session_end_clone.notify_one();
            }
        }
    });

    const IDLE_TIMEOUT_SECS: u64 = 600; // 10 minutes

    loop {
        if cancel.load(Ordering::Relaxed) {
            break;
        }

        // Check for external session end (non-blocking)
        if tokio::time::timeout(Duration::from_millis(0), session_end_notify.notified())
            .await
            .is_ok()
        {
            active_session_id = None;
        }

        // Idle timeout for active telegram sessions
        if active_session_id.is_some()
            && last_message_at.elapsed() > Duration::from_secs(IDLE_TIMEOUT_SECS)
        {
            if let Ok(sessions) = pair_sessions.lock() {
                if let Some(handle) = sessions.get(&agent_id) {
                    let _ = handle.sender.try_send(LiveMessage::End);
                }
            }
            active_session_id = None;
            if let Some(cid) = chat_id {
                let _ = send_message(
                    &client,
                    &bot_token,
                    cid,
                    "Session ended due to inactivity. Send a new message to start again.",
                )
                .await;
            }
        }

        // Poll Telegram with long polling
        let updates = tokio::select! {
            result = get_updates(&client, &bot_token, offset, 30) => result,
            _ = cancel_notify.notified() => break,
        };

        let updates = match updates {
            Ok(u) => {
                consecutive_errors = 0;
                u
            }
            Err(e) => {
                consecutive_errors += 1;
                eprintln!(
                    "[telegram] getUpdates error for {}: {} (attempt {})",
                    agent_id, e, consecutive_errors
                );
                if consecutive_errors >= 10 {
                    let _ = app_handle.emit(
                        "telegram-error",
                        serde_json::json!({
                            "agent_id": agent_id,
                            "error": format!("Telegram bridge stopped after {} errors: {}", consecutive_errors, e),
                        }),
                    );
                    break;
                }
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
        };

        for update in updates {
            offset = update.update_id + 1;

            let msg = match update.message {
                Some(m) => m,
                None => continue,
            };

            let msg_chat_id = msg.chat.id;
            let text = msg.text.unwrap_or_default();

            // ── Handle /start ─────────────────────────────────────────────
            if text.starts_with("/start") {
                if chat_id.is_none() {
                    chat_id = Some(msg_chat_id);
                    let _ = db.update_telegram_chat_id(&agent_id, msg_chat_id);

                    let agent_name = db
                        .get_agent(
                            &Uuid::parse_str(&agent_id).unwrap_or_default(),
                        )
                        .map(|a| a.name.clone())
                        .unwrap_or_else(|_| "your co-founder".to_string());

                    let _ = send_message(
                        &client,
                        &bot_token,
                        msg_chat_id,
                        &format!(
                            "Connected! I'm {}, your co-founder.\n\nSend me a message to start working together.\n\nCommands:\n/status - current state\n/tasks - task board\n/end - end current session",
                            agent_name
                        ),
                    )
                    .await;

                    let _ = app_handle.emit(
                        "telegram-connected",
                        serde_json::json!({
                            "agent_id": agent_id,
                            "chat_id": msg_chat_id,
                        }),
                    );
                } else if chat_id == Some(msg_chat_id) {
                    let _ = send_message(
                        &client,
                        &bot_token,
                        msg_chat_id,
                        "Already connected! Send a message to chat.",
                    )
                    .await;
                }
                continue;
            }

            // Only process from authorized chat
            if chat_id != Some(msg_chat_id) {
                continue;
            }

            last_message_at = Instant::now();

            // ── Handle /status ────────────────────────────────────────────
            if text == "/status" {
                if let Ok(agent) =
                    db.get_agent(&Uuid::parse_str(&agent_id).unwrap_or_default())
                {
                    let state = StateManager::read_state(&agent.workspace);
                    send_chunked(&client, &bot_token, msg_chat_id, &state).await;
                }
                continue;
            }

            // ── Handle /tasks ─────────────────────────────────────────────
            if text == "/tasks" {
                if let Ok(agent) =
                    db.get_agent(&Uuid::parse_str(&agent_id).unwrap_or_default())
                {
                    let tasks = StateManager::read_tasks(&agent.workspace);
                    send_chunked(&client, &bot_token, msg_chat_id, &tasks).await;
                }
                continue;
            }

            // ── Handle /end ──────────────────────────────────────────────
            if text == "/end" {
                if active_session_id.is_some() {
                    if let Ok(sessions) = pair_sessions.lock() {
                        if let Some(handle) = sessions.get(&agent_id) {
                            let _ = handle.sender.try_send(LiveMessage::End);
                        }
                    }
                    active_session_id = None;
                    let _ = send_message(
                        &client,
                        &bot_token,
                        msg_chat_id,
                        "Session ended. Send a new message to start again.",
                    )
                    .await;
                } else {
                    let _ = send_message(
                        &client,
                        &bot_token,
                        msg_chat_id,
                        "No active session.",
                    )
                    .await;
                }
                continue;
            }

            // Skip empty messages
            if text.trim().is_empty() {
                continue;
            }

            // ── Route to pair session ─────────────────────────────────────
            send_typing(&client, &bot_token, msg_chat_id).await;

            if active_session_id.is_none() {
                // Start a new pair session
                match start_telegram_pair_session(
                    &agent_id,
                    &text,
                    &db,
                    &pair_sessions,
                    &heartbeat,
                    &process_pool,
                    &cli,
                    &app_handle,
                )
                .await
                {
                    Ok(sid) => {
                        active_session_id = Some(sid);
                    }
                    Err(e) => {
                        let _ = send_message(
                            &client,
                            &bot_token,
                            msg_chat_id,
                            &format!("Failed to start session: {}", e),
                        )
                        .await;
                        continue;
                    }
                }
            } else {
                // Send to existing session
                let sender = pair_sessions
                    .lock()
                    .ok()
                    .and_then(|s| s.get(&agent_id).map(|h| h.sender.clone()));

                if let Some(sender) = sender {
                    if sender.send(LiveMessage::UserMessage(text.clone())).await.is_err() {
                        // Session ended, start a new one
                        active_session_id = None;
                        match start_telegram_pair_session(
                            &agent_id,
                            &text,
                            &db,
                            &pair_sessions,
                            &heartbeat,
                            &process_pool,
                            &cli,
                            &app_handle,
                        )
                        .await
                        {
                            Ok(sid) => active_session_id = Some(sid),
                            Err(e) => {
                                let _ = send_message(
                                    &client,
                                    &bot_token,
                                    msg_chat_id,
                                    &format!("Failed to start session: {}", e),
                                )
                                .await;
                                continue;
                            }
                        }
                    }
                } else {
                    active_session_id = None;
                    continue;
                }
            }

            // Wait for turn completion
            let current = *turn_count_rx.borrow();
            let mut turn_count_rx_clone = turn_count_rx.clone();
            let wait_result = tokio::select! {
                result = tokio::time::timeout(
                    Duration::from_secs(300),
                    turn_count_rx_clone.wait_for(|&v| v > current),
                ) => {
                    matches!(result, Ok(Ok(_)))
                }
                _ = cancel_notify.notified() => false,
            };

            if !wait_result {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                let _ = send_message(
                    &client,
                    &bot_token,
                    msg_chat_id,
                    "Response timed out. Try again.",
                )
                .await;
                continue;
            }

            // Read the latest agent response from DB
            if let Some(ref sid) = active_session_id {
                let messages = db.get_pair_messages_by_session_str(&agent_id, sid).unwrap_or_default();
                if let Some((_, content, _)) =
                    messages.iter().rev().find(|(role, _, _)| role == "agent")
                {
                    send_chunked(&client, &bot_token, msg_chat_id, content).await;
                }
            }
        }
    }

    // Cleanup: end any active pair session
    if active_session_id.is_some() {
        if let Ok(sessions) = pair_sessions.lock() {
            if let Some(handle) = sessions.get(&agent_id) {
                let _ = handle.sender.try_send(LiveMessage::End);
            }
        }
    }

    app_handle.unlisten(turn_listener);
    app_handle.unlisten(end_listener);
}

// ── Start pair session for Telegram ───────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn start_telegram_pair_session(
    agent_id: &str,
    initial_message: &str,
    db: &Arc<Database>,
    pair_sessions: &Arc<Mutex<HashMap<String, PairSessionHandle>>>,
    heartbeat: &Arc<HeartbeatScheduler>,
    process_pool: &Arc<ProcessPool>,
    cli: &Arc<std::sync::RwLock<CliAdapter>>,
    app_handle: &AppHandle,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent = db.get_agent(&uuid)?;

    let (sender, receiver) = tokio::sync::mpsc::channel::<LiveMessage>(32);
    let session_id = Uuid::new_v4().to_string();
    let cancelled = Arc::new(AtomicBool::new(false));

    {
        let mut sessions = pair_sessions
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;

        if let Some(handle) = sessions.get(agent_id) {
            if !handle.sender.is_closed() {
                return Ok(handle.session_id.clone());
            }
            sessions.remove(agent_id);
        }

        heartbeat.stop_agent_heartbeat(agent_id);
        let _ = process_pool.kill_agent(agent_id);
        let _ = db.reset_consecutive_errors(&uuid);

        sessions.insert(
            agent_id.to_string(),
            PairSessionHandle {
                sender,
                session_id: session_id.clone(),
                cancelled: cancelled.clone(),
            },
        );
    }

    db.update_agent_status(&uuid, &AgentStatus::Running)?;

    let cli_adapter = cli.read().map_err(|e| format!("CLI lock: {e}"))?.clone();
    let db_clone = db.clone();
    let pool_clone = process_pool.clone();
    let heartbeat_clone = heartbeat.clone();
    let pair_sessions_clone = pair_sessions.clone();
    let app_clone = app_handle.clone();
    let agent_id_str = agent_id.to_string();
    let session_id_clone = session_id.clone();
    let message = initial_message.to_string();

    tauri::async_runtime::spawn(async move {
        let run_result = crate::work_session::WorkSessionEngine::run_pair_session(
            cli_adapter,
            agent,
            message,
            receiver,
            pool_clone,
            db_clone.clone(),
            app_clone.clone(),
            session_id_clone.clone(),
            cancelled,
        )
        .await;

        crate::cli_adapter::clear_pair_preview_urls(&session_id_clone);

        if let Ok(mut sessions) = pair_sessions_clone.lock() {
            let should_remove = sessions
                .get(&agent_id_str)
                .map(|h| h.session_id == session_id_clone)
                .unwrap_or(false);
            if should_remove {
                sessions.remove(&agent_id_str);
            }
        }

        if run_result.is_err() {
            let _ = app_clone.emit(
                "pair-session-ended",
                serde_json::json!({
                    "agent_id": agent_id_str,
                    "session_id": session_id_clone,
                    "summary": "Telegram pair session ended.",
                }),
            );
        }

        if let Ok(agent_uuid) = Uuid::parse_str(&agent_id_str) {
            if heartbeat_clone.get_interval(&agent_id_str).is_none() {
                let _ = db_clone.update_agent_status(&agent_uuid, &AgentStatus::Idle);
            }
        }
    });

    Ok(session_id)
}
