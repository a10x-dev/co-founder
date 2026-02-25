use std::io::BufRead;
use std::process::{Command, Stdio};

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

impl CliAdapter {
    pub fn new(claude_path: String) -> Self {
        let path = if claude_path.is_empty() {
            detect_claude_path().unwrap_or_else(|| "claude".to_string())
        } else {
            claude_path
        };
        CliAdapter { claude_path: path }
    }

    pub fn run_turn(&self, config: TurnConfig) -> Result<TurnResult, String> {
        let mut cmd = Command::new(&self.claude_path);
        cmd.arg("-p").arg(&config.prompt);
        cmd.arg("--output-format").arg("stream-json");

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

        if let Some(ref soul) = config.soul_content {
            cmd.arg("--system-prompt").arg(soul);
        }

        cmd.current_dir(&config.workspace);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn claude: {e}"))?;

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

            events.push(StreamEvent {
                event_type: event_type.clone(),
                raw_json: line.clone(),
            });

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
