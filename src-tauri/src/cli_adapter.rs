use std::io::BufRead;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};
use crate::process_pool::ProcessPool;

fn redact_secrets(text: &str, secrets: &[(String, String)]) -> String {
    let mut result = text.to_string();
    for (_, value) in secrets {
        if value.len() >= 4 {
            result = result.replace(value, &format!("{}****", &value[..2]));
        }
    }
    result
}

#[derive(Clone, Debug)]
pub struct CliAdapter {
    pub claude_path: String,
}

#[derive(Clone, Debug)]
pub struct TurnConfig {
    pub agent_id: String,
    pub workspace: String,
    pub prompt: String,
    pub soul_content: Option<String>,
    pub resume_session_id: Option<String>,
    pub allowed_tools: String,
    pub env_vars: Vec<(String, String)>,
    pub skip_permissions: bool,
}

#[derive(Clone, Debug)]
pub struct TurnResult {
    pub events: Vec<StreamEvent>,
    pub session_id: Option<String>,
    pub text_output: String,
}

#[derive(Clone, Debug)]
pub struct StreamEvent {
    pub event_type: String,
    pub raw_json: String,
}

#[derive(Clone, Debug)]
pub enum TurnError {
    RateLimited(String),
    Transient(String),
    Fatal(String),
}

impl std::fmt::Display for TurnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TurnError::RateLimited(msg) => write!(f, "Rate limited: {msg}"),
            TurnError::Transient(msg) => write!(f, "Transient error: {msg}"),
            TurnError::Fatal(msg) => write!(f, "Fatal error: {msg}"),
        }
    }
}

impl TurnError {
    pub fn is_rate_limited(&self) -> bool {
        matches!(self, TurnError::RateLimited(_))
    }
}

fn classify_error(err: &str) -> TurnError {
    let lower = err.to_lowercase();
    if lower.contains("rate")
        || lower.contains("429")
        || lower.contains("overloaded")
        || lower.contains("cooldown")
        || lower.contains("too many requests")
        || lower.contains("quota")
        || lower.contains("capacity")
    {
        TurnError::RateLimited(err.to_string())
    } else if lower.contains("not found")
        || lower.contains("permission denied")
        || lower.contains("no such file")
        || lower.contains("enoent")
    {
        TurnError::Fatal(err.to_string())
    } else {
        TurnError::Transient(err.to_string())
    }
}

impl CliAdapter {
    pub fn new(claude_path: String) -> Self {
        let path = if claude_path.is_empty() {
            detect_claude_path().unwrap_or_else(|| "claude".to_string())
        } else {
            claude_path
        };
        CliAdapter { claude_path: path }
    }

    pub fn run_turn_with_retry(
        &self,
        config: TurnConfig,
        process_pool: Option<&ProcessPool>,
        app_handle: Option<&AppHandle>,
        max_retries: u32,
    ) -> Result<TurnResult, TurnError> {
        let backoff_secs = [30u64, 60, 120];

        for attempt in 0..=max_retries {
            match self.run_turn(config.clone(), process_pool, app_handle) {
                Ok(result) => return Ok(result),
                Err(err) => {
                    let classified = classify_error(&err);
                    if attempt == max_retries {
                        return Err(classified);
                    }
                    match &classified {
                        TurnError::Fatal(_) => return Err(classified),
                        TurnError::RateLimited(_) | TurnError::Transient(_) => {
                            let delay = backoff_secs.get(attempt as usize).copied().unwrap_or(120);
                            eprintln!(
                                "[agent-founder] Retry {}/{} for agent {} after {}s: {}",
                                attempt + 1,
                                max_retries,
                                config.agent_id,
                                delay,
                                classified
                            );
                            if let Some(handle) = app_handle {
                                let _ = handle.emit("agent-output", serde_json::json!({
                                    "agent_id": config.agent_id,
                                    "type": "retry",
                                    "attempt": attempt + 1,
                                    "max_retries": max_retries,
                                    "delay_secs": delay,
                                    "error": classified.to_string(),
                                }));
                            }
                            std::thread::sleep(std::time::Duration::from_secs(delay));
                        }
                    }
                }
            }
        }
        Err(TurnError::Fatal("Exhausted retries".to_string()))
    }

    pub fn run_turn(
        &self,
        config: TurnConfig,
        process_pool: Option<&ProcessPool>,
        app_handle: Option<&AppHandle>,
    ) -> Result<TurnResult, String> {
        let mut cmd = Command::new(&self.claude_path);
        cmd.arg("-p").arg(&config.prompt);
        cmd.arg("--output-format").arg("stream-json");
        cmd.arg("--verbose");

        if let Some(ref session_id) = config.resume_session_id {
            cmd.arg("--resume").arg(session_id);
        }

        if !config.allowed_tools.is_empty() {
            for tool in config.allowed_tools.split(',') {
                let tool = tool.trim();
                if !tool.is_empty() {
                    cmd.arg("--allowedTools").arg(tool);
                }
            }
        }

        if config.skip_permissions {
            cmd.arg("--dangerously-skip-permissions");
        }

        if let Some(ref soul) = config.soul_content {
            cmd.arg("--system-prompt").arg(soul);
        }

        for (key, value) in &config.env_vars {
            cmd.env(key, value);
        }

        cmd.current_dir(&config.workspace);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn claude: {e}"))?;
        let pid = child.id();
        if let Some(pool) = process_pool {
            pool.register(&config.agent_id, pid);
        }

        let run_result = (|| -> Result<TurnResult, String> {
            let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
            let reader = std::io::BufReader::new(stdout);

            let mut events: Vec<StreamEvent> = Vec::new();
            let mut session_id: Option<String> = None;
            let mut text_output = String::new();

            for line in reader.lines() {
                let line = line.map_err(|e| format!("Read error: {e}"))?;
                if line.trim().is_empty() {
                    continue;
                }

                let parsed: serde_json::Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let event_type = parsed
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();

                let safe_line = redact_secrets(&line, &config.env_vars);

                events.push(StreamEvent {
                    event_type: event_type.clone(),
                    raw_json: safe_line.clone(),
                });

                if let Some(handle) = app_handle {
                    let _ = handle.emit("agent-output", serde_json::json!({
                        "agent_id": config.agent_id,
                        "type": event_type,
                        "raw": safe_line,
                    }));
                }

                if event_type == "result" {
                    if let Some(sid) = parsed.get("session_id").and_then(|v| v.as_str()) {
                        session_id = Some(sid.to_string());
                    }
                    if let Some(result_text) = parsed.get("result").and_then(|v| v.as_str()) {
                        text_output.push_str(result_text);
                    }
                }

                if event_type == "assistant" {
                    if let Some(content) = parsed.get("content").and_then(|v| v.as_str()) {
                        text_output.push_str(content);
                        text_output.push('\n');
                    }
                }
            }

            let status = child.wait().map_err(|e| format!("Wait error: {e}"))?;
            if !status.success() {
                let stderr = child.stderr.take();
                let err_msg = if let Some(stderr) = stderr {
                    let reader = std::io::BufReader::new(stderr);
                    reader.lines().filter_map(|l| l.ok()).collect::<Vec<_>>().join("\n")
                } else {
                    format!("claude exited with status {status}")
                };
                if events.is_empty() {
                    return Err(format!("Claude CLI failed: {err_msg}"));
                }
            }

            Ok(TurnResult {
                events,
                session_id,
                text_output,
            })
        })();

        if let Some(pool) = process_pool {
            pool.unregister(&config.agent_id);
        }

        run_result
    }
}

pub fn detect_claude_path() -> Option<String> {
    let output = Command::new("which")
        .arg("claude")
        .output()
        .ok()?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Some(path);
        }
    }
    None
}

pub fn get_claude_version() -> Option<String> {
    let output = Command::new("claude")
        .arg("--version")
        .output()
        .ok()?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !version.is_empty() {
            return Some(version);
        }
    }
    None
}
