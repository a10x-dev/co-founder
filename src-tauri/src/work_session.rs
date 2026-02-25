use chrono::Utc;
use uuid::Uuid;

use crate::cli_adapter::{CliAdapter, TurnConfig};
use crate::db::Database;
use crate::models::*;
use crate::process_pool::ProcessPool;
use crate::state_manager::StateManager;

pub struct WorkSessionEngine;

impl WorkSessionEngine {
    pub fn run_session(
        cli: &CliAdapter,
        agent: &Agent,
        _pool: &ProcessPool,
        db: &Database,
        _app_handle: tauri::AppHandle,
    ) -> Result<WorkSessionLog, String> {
        let session_uuid = Uuid::new_v4();
        let started_at = Utc::now().to_rfc3339();

        let soul_content = StateManager::get_soul_content(&agent.workspace, &agent.personality);
        let state_content = StateManager::read_state(&agent.workspace);

        let heartbeat_prompt = format!(
            "You are checking in on your project.\n\n\
             ## Current State\n{}\n\n\
             ## Your Mission\n{}\n\n\
             If there is nothing to do right now, respond with exactly: HEARTBEAT_OK\n\
             If there is work to do, describe what you'll do and begin working.",
            state_content, agent.mission
        );

        let config = TurnConfig {
            agent_id: agent.id.to_string(),
            workspace: agent.workspace.clone(),
            prompt: heartbeat_prompt,
            soul_content: Some(soul_content),
            resume_session_id: None,
            allowed_tools: agent.allowed_tools.clone(),
        };

        let result = cli.run_turn(config)?;

        let mut all_events = result.events.clone();
        let mut turns: u32 = 1;
        let mut final_session_id = result.session_id.clone();

        if result.text_output.contains("HEARTBEAT_OK") {
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
            return Ok(log);
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
                return Ok(log);
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
            };

            match cli.run_turn(resume_config) {
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
                        return Ok(log);
                    }
                }
                Err(e) => {
                    let log = WorkSessionLog {
                        id: session_uuid,
                        agent_id: agent.id,
                        session_id: final_session_id.unwrap_or_default(),
                        started_at: started_at.clone(),
                        ended_at: Some(Utc::now().to_rfc3339()),
                        turns,
                        trigger: SessionTrigger::Heartbeat,
                        outcome: SessionOutcome::Error,
                        summary: format!("Error during turn: {e}"),
                        events_json: serialize_events(&all_events),
                    };
                    db.log_work_session(&log)?;
                    return Ok(log);
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
        Ok(log)
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
