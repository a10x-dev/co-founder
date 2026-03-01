use chrono::Utc;
use uuid::Uuid;

use crate::cli_adapter::{CliAdapter, TurnConfig, TurnError};
use crate::db::Database;
use crate::models::*;
use crate::process_pool::ProcessPool;
use crate::state_manager::StateManager;
use tauri::{AppHandle, Emitter};

pub struct WorkSessionEngine;

pub struct SessionResult {
    pub log: WorkSessionLog,
    pub is_rate_limited: bool,
}

impl WorkSessionEngine {
    pub fn run_session(
        cli: &CliAdapter,
        agent: &Agent,
        pool: &ProcessPool,
        db: &Database,
        app_handle: AppHandle,
    ) -> Result<SessionResult, String> {
        let session_uuid = Uuid::new_v4();
        let started_at = Utc::now().to_rfc3339();

        let soul_content = StateManager::get_soul_content(&agent.workspace, &agent.personality);
        let state_content = StateManager::read_state(&agent.workspace);
        let memory_content = StateManager::read_memory(&agent.workspace);
        let inbox_content = StateManager::read_inbox(&agent.workspace);
        let tasks_content = StateManager::read_tasks(&agent.workspace);
        let env_vars = db.get_agent_env_vars_as_pairs(&agent.id).unwrap_or_default();

        let mut prompt_parts = vec![
            "You are checking in on your project.".to_string(),
            format!("\n## Your Mission\n{}", agent.mission),
            format!("\n## Current State\n{}", state_content),
        ];

        if !tasks_content.trim().is_empty()
            && tasks_content.trim() != default_empty_tasks()
        {
            prompt_parts.push(format!("\n## Tasks\n{}", tasks_content));
        }

        if !memory_content.trim().is_empty() {
            let mem_lines: Vec<&str> = memory_content.lines().collect();
            let mem_tail = if mem_lines.len() > 60 {
                mem_lines[mem_lines.len() - 60..].join("\n")
            } else {
                memory_content.clone()
            };
            prompt_parts.push(format!("\n## Your Memory\n{}", mem_tail));
        }

        let has_inbox = !inbox_content.trim().is_empty()
            && inbox_content.contains("---");
        if has_inbox {
            prompt_parts.push(format!(
                "\n## Pending Messages from User (INBOX)\n{}\n\nIMPORTANT: Address these messages. After handling, remove them from .founder/INBOX.md.",
                inbox_content
            ));
        }

        if has_inbox {
            prompt_parts.push(
                "\nYou have pending messages — you MUST address them. Do NOT respond with HEARTBEAT_OK when there are messages.".to_string()
            );
        } else {
            prompt_parts.push(
                "\nIf there is nothing to do right now, respond with exactly: HEARTBEAT_OK\nIf there is work to do, describe what you'll do and begin working.".to_string()
            );
        }

        prompt_parts.push(
            "\nAfter completing work, update .founder/STATE.md with your current status and .founder/MEMORY.md with any new important facts or decisions.".to_string()
        );

        let heartbeat_prompt = prompt_parts.join("\n");

        let config = TurnConfig {
            agent_id: agent.id.to_string(),
            workspace: agent.workspace.clone(),
            prompt: heartbeat_prompt,
            soul_content: Some(soul_content),
            resume_session_id: None,
            allowed_tools: agent.allowed_tools.clone(),
            env_vars: env_vars.clone(),
        };

        let _ = app_handle.emit("agent-output", serde_json::json!({
            "agent_id": agent.id.to_string(),
            "type": "session_start",
            "message": "Starting work session...",
        }));

        let result = match cli.run_turn_with_retry(config, Some(pool), Some(&app_handle), 2) {
            Ok(result) => result,
            Err(turn_err) => {
                let (outcome, is_rate_limited) = match &turn_err {
                    TurnError::RateLimited(_) => (SessionOutcome::RateLimited, true),
                    _ => (SessionOutcome::Error, false),
                };
                let log = WorkSessionLog {
                    id: session_uuid,
                    agent_id: agent.id,
                    session_id: String::new(),
                    started_at,
                    ended_at: Some(Utc::now().to_rfc3339()),
                    turns: 0,
                    trigger: SessionTrigger::Heartbeat,
                    outcome,
                    summary: format!("Failed to start session: {turn_err}"),
                    events_json: "[]".to_string(),
                };
                db.log_work_session(&log)?;
                return Ok(SessionResult { log, is_rate_limited });
            }
        };

        let text_output = result.text_output;
        let mut all_events = result.events;
        let mut turns: u32 = 1;
        let mut final_session_id = result.session_id;

        if text_output.contains("HEARTBEAT_OK") {
            let log = WorkSessionLog {
                id: session_uuid,
                agent_id: agent.id,
                session_id: final_session_id.unwrap_or_default(),
                started_at,
                ended_at: Some(Utc::now().to_rfc3339()),
                turns,
                trigger: SessionTrigger::Heartbeat,
                outcome: SessionOutcome::Completed,
                summary: "Nothing to do".to_string(),
                events_json: serialize_events(&all_events),
            };
            db.log_work_session(&log)?;
            return Ok(SessionResult { log, is_rate_limited: false });
        }

        let max_turns = 20u32;
        let session_start = std::time::Instant::now();

        while turns < max_turns {
            if session_start.elapsed().as_secs() > agent.max_session_duration_secs {
                let log = WorkSessionLog {
                    id: session_uuid,
                    agent_id: agent.id,
                    session_id: final_session_id.clone().unwrap_or_default(),
                    started_at: started_at.clone(),
                    ended_at: Some(Utc::now().to_rfc3339()),
                    turns,
                    trigger: SessionTrigger::Heartbeat,
                    outcome: SessionOutcome::Timeout,
                    summary: "Session timed out".to_string(),
                    events_json: serialize_events(&all_events),
                };
                db.log_work_session(&log)?;
                return Ok(SessionResult { log, is_rate_limited: false });
            }

            let sid = match &final_session_id {
                Some(s) => s.clone(),
                None => break,
            };

            let resume_config = TurnConfig {
                agent_id: agent.id.to_string(),
                workspace: agent.workspace.clone(),
                prompt: "Continue working on the task. If you're done or blocked, say so clearly.".to_string(),
                soul_content: None,
                resume_session_id: Some(sid),
                allowed_tools: agent.allowed_tools.clone(),
                env_vars: env_vars.clone(),
            };

            match cli.run_turn_with_retry(resume_config, Some(pool), Some(&app_handle), 2) {
                Ok(turn_result) => {
                    turns += 1;
                    if let Some(ref sid) = turn_result.session_id {
                        final_session_id = Some(sid.clone());
                    }
                    all_events.extend(turn_result.events);

                    let output_lower = turn_result.text_output.to_lowercase();
                    if output_lower.contains("done") || output_lower.contains("complete") || output_lower.contains("finished") {
                        break;
                    }
                    if output_lower.contains("blocked") || output_lower.contains("stuck") || output_lower.contains("cannot proceed") {
                        let log = WorkSessionLog {
                            id: session_uuid,
                            agent_id: agent.id,
                            session_id: final_session_id.unwrap_or_default(),
                            started_at: started_at.clone(),
                            ended_at: Some(Utc::now().to_rfc3339()),
                            turns,
                            trigger: SessionTrigger::Heartbeat,
                            outcome: SessionOutcome::Blocked,
                            summary: truncate(&turn_result.text_output, 500),
                            events_json: serialize_events(&all_events),
                        };
                        db.log_work_session(&log)?;
                        return Ok(SessionResult { log, is_rate_limited: false });
                    }
                }
                Err(turn_err) => {
                    let (outcome, is_rate_limited) = match &turn_err {
                        TurnError::RateLimited(_) => (SessionOutcome::RateLimited, true),
                        _ => (SessionOutcome::Error, false),
                    };
                    let log = WorkSessionLog {
                        id: session_uuid,
                        agent_id: agent.id,
                        session_id: final_session_id.unwrap_or_default(),
                        started_at: started_at.clone(),
                        ended_at: Some(Utc::now().to_rfc3339()),
                        turns,
                        trigger: SessionTrigger::Heartbeat,
                        outcome,
                        summary: format!("Error during turn: {turn_err}"),
                        events_json: serialize_events(&all_events),
                    };
                    db.log_work_session(&log)?;
                    return Ok(SessionResult { log, is_rate_limited });
                }
            }
        }

        let log = WorkSessionLog {
            id: session_uuid,
            agent_id: agent.id,
            session_id: final_session_id.unwrap_or_default(),
            started_at,
            ended_at: Some(Utc::now().to_rfc3339()),
            turns,
            trigger: SessionTrigger::Heartbeat,
            outcome: SessionOutcome::Completed,
            summary: "Work session completed".to_string(),
            events_json: serialize_events(&all_events),
        };
        db.log_work_session(&log)?;
        Ok(SessionResult { log, is_rate_limited: false })
    }
}

fn serialize_events(events: &[crate::cli_adapter::StreamEvent]) -> String {
    let json_events: Vec<serde_json::Value> = events
        .iter()
        .map(|e| {
            serde_json::json!({
                "type": e.event_type,
                "raw": e.raw_json,
            })
        })
        .collect();
    serde_json::to_string(&json_events).unwrap_or_else(|_| "[]".to_string())
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}

fn default_empty_tasks() -> &'static str {
    "# Tasks\n\n## In Progress\n\n\n## To Do\n\n\n## Done\n\n\n## Blocked"
}
