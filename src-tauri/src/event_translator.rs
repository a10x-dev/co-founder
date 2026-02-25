use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ActivityEntry {
    pub icon: String,
    pub title: String,
    pub description: String,
    pub timestamp: String,
    pub details: Option<String>,
}

pub fn translate_event(raw_json: &str) -> Option<ActivityEntry> {
    let parsed: serde_json::Value = serde_json::from_str(raw_json).ok()?;
    let event_type = parsed.get("type")?.as_str()?;
    let timestamp = chrono::Utc::now().to_rfc3339();

    match event_type {
        "tool_call" => {
            let tool_name = parsed
                .get("tool")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let input = parsed.get("input").cloned().unwrap_or(serde_json::Value::Null);

            if tool_name.contains("write") || tool_name == "writeToolCall" {
                let path = input
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown file");
                Some(ActivityEntry {
                    icon: "file-plus".to_string(),
                    title: "Created a new file".to_string(),
                    description: path.to_string(),
                    timestamp,
                    details: Some(raw_json.to_string()),
                })
            } else if tool_name.contains("read") || tool_name == "readToolCall" {
                let path = input
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown file");
                Some(ActivityEntry {
                    icon: "file-search".to_string(),
                    title: "Reviewed a file".to_string(),
                    description: path.to_string(),
                    timestamp,
                    details: Some(raw_json.to_string()),
                })
            } else if tool_name.contains("bash") || tool_name == "bashToolCall" {
                let command = input
                    .get("command")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown command");
                let truncated = if command.len() > 100 {
                    format!("{}...", &command[..100])
                } else {
                    command.to_string()
                };
                Some(ActivityEntry {
                    icon: "terminal".to_string(),
                    title: "Ran a command".to_string(),
                    description: truncated,
                    timestamp,
                    details: Some(raw_json.to_string()),
                })
            } else {
                Some(ActivityEntry {
                    icon: "wrench".to_string(),
                    title: format!("Used tool: {}", tool_name),
                    description: String::new(),
                    timestamp,
                    details: Some(raw_json.to_string()),
                })
            }
        }
        "assistant" => {
            let content = parsed
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let truncated = if content.len() > 200 {
                format!("{}...", &content[..200])
            } else {
                content.to_string()
            };
            Some(ActivityEntry {
                icon: "message-circle".to_string(),
                title: "Thinking...".to_string(),
                description: truncated,
                timestamp,
                details: None,
            })
        }
        "result" => {
            let result_text = parsed
                .get("result")
                .and_then(|v| v.as_str())
                .unwrap_or("Session ended");
            let truncated = if result_text.len() > 200 {
                format!("{}...", &result_text[..200])
            } else {
                result_text.to_string()
            };
            Some(ActivityEntry {
                icon: "check-circle".to_string(),
                title: "Finished".to_string(),
                description: truncated,
                timestamp,
                details: None,
            })
        }
        _ => None,
    }
}
