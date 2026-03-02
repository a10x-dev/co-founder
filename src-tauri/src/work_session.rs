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
    pub requested_next_checkin_secs: Option<u64>,
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

        // Auto-commit any pending changes before session starts (for rollback safety)
        let is_git_repo = std::process::Command::new("git")
            .args(["rev-parse", "--is-inside-work-tree"])
            .current_dir(&agent.workspace)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if is_git_repo {
            let _ = std::process::Command::new("git")
                .args(["add", "-A"])
                .current_dir(&agent.workspace)
                .output();
            let _ = std::process::Command::new("git")
                .args(["commit", "-m", &format!("pre-session snapshot {}", &session_uuid.to_string()[..8]), "--allow-empty"])
                .current_dir(&agent.workspace)
                .output();
        }

        let soul_content = StateManager::get_soul_content(&agent.workspace, &agent.personality);
        let mission_file = StateManager::read_mission(&agent.workspace);
        let mission_content = if mission_file.trim().is_empty() { &agent.mission } else { &mission_file };
        let state_content = StateManager::read_state(&agent.workspace);
        let memory_content = StateManager::read_memory(&agent.workspace);
        let inbox_content = StateManager::read_inbox(&agent.workspace);
        let tasks_content = StateManager::read_tasks(&agent.workspace);
        let schedule_content = StateManager::read_schedule(&agent.workspace);
        let artifacts_summary = StateManager::read_artifacts_summary(&agent.workspace);
        let tools_summary = StateManager::read_tools_summary(&agent.workspace);
        let env_vars = db.get_agent_env_vars_as_pairs(&agent.id).unwrap_or_default();
        let skip_perms = agent.autonomy_level == crate::models::AutonomyLevel::Yolo;

        let now = Utc::now();
        let created = chrono::DateTime::parse_from_rfc3339(&agent.created_at)
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now);
        let age_hours = now.signed_duration_since(created).num_hours();
        let age_days = age_hours / 24;

        let hours_since_last_session = agent
            .last_heartbeat_at
            .as_ref()
            .and_then(|ts| chrono::DateTime::parse_from_rfc3339(ts).ok())
            .map(|last| now.signed_duration_since(last.with_timezone(&chrono::Utc)).num_hours())
            .unwrap_or(0);

        let is_review_time = hours_since_last_session >= 20 || agent.total_sessions == 0;

        let mut prompt_parts = vec![];

        if is_review_time {
            prompt_parts.push(format!(
                "You are the co-founder of this project. It's time for your STRATEGIC REVIEW.\n\
                 You've been running for {} days ({} hours). You've completed {} work sessions.\n\
                 It's been {} hours since your last session.\n\n\
                 ## Strategic Review Protocol\n\
                 1. Review your MISSION — are you on track?\n\
                 2. Review your MEMORY — what have you learned?\n\
                 3. Analyze results — what worked, what didn't?\n\
                 4. Decide priorities for the next cycle\n\
                 5. Update your TASKS.md with revised priorities\n\
                 6. Review and update your SCHEDULE.md — add recurring tasks you need\n\
                 7. Update artifacts with current metrics\n\
                 8. Begin executing on your top priority\n\n\
                 Think like a CEO doing a daily standup with yourself.",
                age_days, age_hours, agent.total_sessions, hours_since_last_session
            ));
        } else {
            prompt_parts.push(format!(
                "You are the co-founder of this project. You own this. What needs to happen next?\n\
                 Running for {} days. {} sessions completed. Last active {} hours ago.",
                age_days, agent.total_sessions, hours_since_last_session
            ));
        }

        prompt_parts.push(format!("\n## Your Mission\n{}", mission_content));
        prompt_parts.push(format!("\n## Current State\n{}", state_content));

        if !tasks_content.trim().is_empty()
            && tasks_content.trim() != default_empty_tasks()
        {
            prompt_parts.push(format!("\n## Tasks\n{}", tasks_content));
        }

        if !schedule_content.trim().is_empty() {
            let local_now = chrono::Local::now();
            let current_time = local_now.format("%H:%M").to_string();
            let current_day = local_now.format("%A").to_string();

            let mut due_items = Vec::new();
            let mut upcoming_items = Vec::new();
            for line in schedule_content.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with("- ") { continue; }
                let parts: Vec<&str> = trimmed[2..].split('|').map(|s| s.trim()).collect();
                if parts.len() < 5 { continue; }
                if parts.len() > 4 && parts[4] == "false" { continue; }
                let entry_time = parts[0];
                let action = parts[1];
                if entry_time <= current_time.as_str() {
                    due_items.push(format!("- **{}** — {} (DUE NOW)", entry_time, action));
                } else {
                    upcoming_items.push(format!("- {} — {}", entry_time, action));
                }
            }

            let mut schedule_section = format!("\n## Today's Schedule ({})\nCurrent time: {}\n", current_day, current_time);
            if !due_items.is_empty() {
                schedule_section.push_str("\n### Due / Overdue\n");
                schedule_section.push_str(&due_items.join("\n"));
                schedule_section.push('\n');
            }
            if !upcoming_items.is_empty() {
                schedule_section.push_str("\n### Coming Up\n");
                schedule_section.push_str(&upcoming_items.join("\n"));
                schedule_section.push('\n');
            }
            if !due_items.is_empty() {
                schedule_section.push_str("\nIMPORTANT: Handle DUE items before regular tasks. They are commitments.\n");
            }
            schedule_section.push_str("\nYou can add your own schedule entries by writing to `.founder/SCHEDULE.md`.\nFormat: `- HH:MM | action | recurrence | cofounder | true`\n");
            prompt_parts.push(schedule_section);
        }

        if !artifacts_summary.is_empty() {
            prompt_parts.push(format!("\n## Your Artifacts\n{}", artifacts_summary));
        }

        if !tools_summary.is_empty() {
            prompt_parts.push(format!("\n## Your Tools\n{}", tools_summary));
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
                "\n## Pending Messages from Your Human Partner (INBOX)\n{}\n\nIMPORTANT: Address these messages first. After handling, remove them from .founder/INBOX.md.",
                inbox_content
            ));
        }

        if has_inbox {
            prompt_parts.push(
                "\nYou have pending messages from your human partner — address them FIRST. Do NOT respond with HEARTBEAT_OK when there are messages.".to_string()
            );
        } else {
            prompt_parts.push(
                "\nBefore responding HEARTBEAT_OK, ask yourself: is there ANYTHING I could build, improve, refactor, test, document, or optimize? Check TASKS.md, SCHEDULE.md, and your MISSION. A great co-founder always finds leverage. Only if you've genuinely exhausted every angle, respond with exactly: HEARTBEAT_OK".to_string()
            );
        }

        prompt_parts.push(
            "\nAfter completing work, update .founder/STATE.md with your current status and .founder/MEMORY.md with any new important facts or decisions.".to_string()
        );

        prompt_parts.push(r#"
## Scheduling — You Control Your Own Tempo

At the END of your response, you MUST include a scheduling directive:
- `NEXT_CHECKIN: 5m` — you're mid-task and need to continue immediately
- `NEXT_CHECKIN: 15m` — you just shipped something, quick breather then back at it
- `NEXT_CHECKIN: 30m` — you finished a chunk, regroup and look for next opportunity
- `NEXT_CHECKIN: 1h` — genuinely nothing actionable right now

Bias toward ACTION. A great co-founder always finds the next thing to build, fix, or improve. Only use 1h if you've exhausted every possible avenue. Default to 15m."#.to_string());

        prompt_parts.push(r#"
## Artifacts & Tools (use these to track your progress)

Create artifacts to track key metrics. Write to `.founder/artifacts/manifest.json` — a JSON array where each item has:
- `id` (string, unique), `title` (string), `type` ("metric"|"table"|"checklist"|"markdown"|"chart"|"log")
- `description` (string, optional), `data` (any — for metric: `{"value":N,"unit":"..."}`, for checklist: `[{"label":"...","done":bool}]`, for markdown: a string)
- `updated_at` (ISO 8601 timestamp)

Create reusable tools/scripts in `.founder/tools/`. Save the script, then register in `.founder/tools/manifest.json` — a JSON array where each item has:
- `name`, `description`, `language` (e.g. "python","bash","node"), `path` (relative to .founder/tools/)
- `use_count` (number, increment when used), `created_at` (ISO 8601), `approved` (bool, set to true)

Track everything relevant to your mission: revenue, users, deployments, test coverage, whatever matters."#.to_string());

        let heartbeat_prompt = prompt_parts.join("\n");

        let max_turns = 40u32;

        let config = TurnConfig {
            agent_id: agent.id.to_string(),
            workspace: agent.workspace.clone(),
            prompt: heartbeat_prompt,
            soul_content: Some(soul_content),
            resume_session_id: None,
            allowed_tools: agent.allowed_tools.clone(),
            env_vars: env_vars.clone(),
            skip_permissions: skip_perms,
        };

        let _ = app_handle.emit("agent-output", serde_json::json!({
            "agent_id": agent.id.to_string(),
            "type": "session_start",
            "message": if is_review_time { "Starting strategic review..." } else { "Co-founder checking in..." },
            "max_turns": max_turns,
            "max_duration_secs": agent.max_session_duration_secs,
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
                    input_tokens: 0,
                    output_tokens: 0,
                    cost_usd: 0.0,
                };
                db.log_work_session(&log)?;
                return Ok(SessionResult { log, is_rate_limited, requested_next_checkin_secs: None });
            }
        };

        let text_output = result.text_output;
        let mut all_events = result.events;
        let mut turns: u32 = 1;
        let mut final_session_id = result.session_id;
        let mut all_text = text_output.clone();

        if text_output.contains("HEARTBEAT_OK") {
            let requested = parse_next_checkin(&text_output);
            let (it, ot, cost) = parse_token_usage(&all_events);
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
                input_tokens: it,
                output_tokens: ot,
                cost_usd: cost,
            };
            db.log_work_session(&log)?;
            return Ok(SessionResult { log, is_rate_limited: false, requested_next_checkin_secs: requested });
        }

        let session_start = std::time::Instant::now();

        while turns < max_turns {
            let _ = app_handle.emit("agent-output", serde_json::json!({
                "agent_id": agent.id.to_string(),
                "type": "turn_progress",
                "turn": turns,
                "max_turns": max_turns,
                "elapsed_secs": session_start.elapsed().as_secs(),
                "max_duration_secs": agent.max_session_duration_secs,
            }));

            if session_start.elapsed().as_secs() > agent.max_session_duration_secs {
                let requested = parse_next_checkin(&all_text);
                let (it, ot, cost) = parse_token_usage(&all_events);
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
                    input_tokens: it,
                    output_tokens: ot,
                    cost_usd: cost,
                };
                db.log_work_session(&log)?;
                return Ok(SessionResult { log, is_rate_limited: false, requested_next_checkin_secs: requested });
            }

            let sid = match &final_session_id {
                Some(s) => s.clone(),
                None => break,
            };

            let resume_config = TurnConfig {
                agent_id: agent.id.to_string(),
                workspace: agent.workspace.clone(),
                prompt: "Continue working. If done, say so and include your NEXT_CHECKIN directive.".to_string(),
                soul_content: None,
                resume_session_id: Some(sid),
                allowed_tools: agent.allowed_tools.clone(),
                env_vars: env_vars.clone(),
                skip_permissions: skip_perms,
            };

            match cli.run_turn_with_retry(resume_config, Some(pool), Some(&app_handle), 2) {
                Ok(turn_result) => {
                    turns += 1;
                    if let Some(ref sid) = turn_result.session_id {
                        final_session_id = Some(sid.clone());
                    }
                    all_events.extend(turn_result.events);
                    all_text.push_str(&turn_result.text_output);

                    let output_lower = turn_result.text_output.to_lowercase();
                    if output_lower.contains("done") || output_lower.contains("complete") || output_lower.contains("finished") {
                        break;
                    }
                    if output_lower.contains("blocked") || output_lower.contains("stuck") || output_lower.contains("cannot proceed") {
                        let requested = parse_next_checkin(&all_text);
                        let (it, ot, cost) = parse_token_usage(&all_events);
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
                            input_tokens: it,
                            output_tokens: ot,
                            cost_usd: cost,
                        };
                        db.log_work_session(&log)?;
                        return Ok(SessionResult { log, is_rate_limited: false, requested_next_checkin_secs: requested });
                    }
                }
                Err(turn_err) => {
                    let (outcome, is_rate_limited) = match &turn_err {
                        TurnError::RateLimited(_) => (SessionOutcome::RateLimited, true),
                        _ => (SessionOutcome::Error, false),
                    };
                    let (it, ot, cost) = parse_token_usage(&all_events);
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
                        input_tokens: it,
                        output_tokens: ot,
                        cost_usd: cost,
                    };
                    db.log_work_session(&log)?;
                    return Ok(SessionResult { log, is_rate_limited, requested_next_checkin_secs: None });
                }
            }
        }

        let requested = parse_next_checkin(&all_text);
        let (it, ot, cost) = parse_token_usage(&all_events);
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
            input_tokens: it,
            output_tokens: ot,
            cost_usd: cost,
        };
        db.log_work_session(&log)?;
        Ok(SessionResult { log, is_rate_limited: false, requested_next_checkin_secs: requested })
    }
}

/// Parse `NEXT_CHECKIN: Xm` or `NEXT_CHECKIN: Xh` from agent output
fn parse_next_checkin(text: &str) -> Option<u64> {
    for line in text.lines().rev() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("NEXT_CHECKIN:") {
            let val = rest.trim().to_lowercase();
            if let Some(mins) = val.strip_suffix('m') {
                if let Ok(n) = mins.trim().parse::<u64>() {
                    return Some(n.max(1) * 60);
                }
            }
            if let Some(hours) = val.strip_suffix('h') {
                if let Ok(n) = hours.trim().parse::<u64>() {
                    return Some(n.max(1) * 3600);
                }
            }
        }
    }
    None
}

fn parse_token_usage(events: &[crate::cli_adapter::StreamEvent]) -> (u64, u64, f64) {
    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;
    for event in events {
        if event.event_type == "result" || event.event_type == "usage" {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&event.raw_json) {
                let usage = parsed.get("usage").unwrap_or(&parsed);
                if let Some(input) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                    input_tokens += input;
                }
                if let Some(output) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
                    output_tokens += output;
                }
            }
        }
    }
    let cost = (input_tokens as f64 * 3.0 / 1_000_000.0) + (output_tokens as f64 * 15.0 / 1_000_000.0);
    (input_tokens, output_tokens, (cost * 10000.0).round() / 10000.0)
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
