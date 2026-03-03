use chrono::{Datelike, Timelike, Utc};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
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
    pub requested_next_checkin_secs: Option<u64>,
}

impl WorkSessionEngine {
    pub fn run_session(
        cli: &CliAdapter,
        agent: &Agent,
        trigger: SessionTrigger,
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
                .args([
                    "commit",
                    "-m",
                    &format!("pre-session snapshot {}", &session_uuid.to_string()[..8]),
                    "--allow-empty",
                ])
                .current_dir(&agent.workspace)
                .output();
        }

        let soul_content = StateManager::get_soul_content(&agent.workspace, &agent.personality);
        let mission_file = StateManager::read_mission(&agent.workspace);
        let mission_content = if mission_file.trim().is_empty() {
            &agent.mission
        } else {
            &mission_file
        };
        let state_content = StateManager::read_state(&agent.workspace);
        let memory_content = StateManager::read_memory(&agent.workspace);
        let inbox_content = StateManager::read_inbox(&agent.workspace);
        let tasks_content = StateManager::read_tasks(&agent.workspace);
        let schedule_content = StateManager::read_schedule(&agent.workspace);
        let artifacts_summary = StateManager::read_artifacts_summary(&agent.workspace);
        let tools_summary = StateManager::read_tools_summary(&agent.workspace);
        let env_vars = db
            .get_agent_env_vars_as_pairs(&agent.id)
            .unwrap_or_default();
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
            .map(|last| {
                now.signed_duration_since(last.with_timezone(&chrono::Utc))
                    .num_hours()
            })
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

        if !tasks_content.trim().is_empty() && tasks_content.trim() != default_empty_tasks() {
            prompt_parts.push(format!("\n## Tasks\n{}", tasks_content));
        }

        if !schedule_content.trim().is_empty() {
            let local_now = chrono::Local::now();
            let current_time = local_now.format("%H:%M").to_string();
            let current_day = local_now.format("%A").to_string();
            let current_minutes = (local_now.hour() * 60 + local_now.minute()) as u16;

            let mut due_items = Vec::new();
            let mut upcoming_items = Vec::new();
            let mut fired_once_ids: Vec<String> = Vec::new();
            for line in schedule_content.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with("- ") {
                    continue;
                }

                let parts: Vec<&str> = trimmed[2..].split('|').map(|s| s.trim()).collect();
                if parts.len() < 5 {
                    continue;
                }

                let enabled = parts[4] != "false";
                if !enabled {
                    continue;
                }

                let entry_time = parts[0];
                let action = parts[1];
                let recurrence = parts[2];
                let entry_id = if parts.len() > 5 { parts[5] } else { "" };
                let last_run = if parts.len() > 6 && !parts[6].is_empty() {
                    Some(parts[6])
                } else {
                    None
                };
                let day_of_week = if parts.len() > 7 {
                    parts[7].parse::<u8>().ok()
                } else {
                    None
                };

                if !is_schedule_entry_active_today(recurrence, day_of_week, last_run, &local_now) {
                    continue;
                }

                let Some(entry_minutes) = parse_hhmm_minutes(entry_time) else {
                    continue;
                };

                let recurrence_label = recurrence_label(recurrence);
                if entry_minutes <= current_minutes {
                    due_items.push(format!(
                        "- **{}** — {} ({}, DUE NOW)",
                        entry_time, action, recurrence_label
                    ));
                    if recurrence == "once" && !entry_id.is_empty() {
                        fired_once_ids.push(entry_id.to_string());
                    }
                } else {
                    upcoming_items.push(format!(
                        "- {} — {} ({})",
                        entry_time, action, recurrence_label
                    ));
                }
            }

            if !fired_once_ids.is_empty() {
                mark_once_entries_as_run(&agent.workspace, &fired_once_ids);
            }

            let mut schedule_section = format!(
                "\n## Today's Schedule ({})\nCurrent time: {}\n",
                current_day, current_time
            );
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
                schedule_section.push_str(
                    "\nIMPORTANT: Handle DUE items before regular tasks. They are commitments.\n",
                );
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

        let has_inbox = !inbox_content.trim().is_empty() && inbox_content.contains("---");
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
            pair_session_id: None,
        };

        let _ = app_handle.emit("agent-output", serde_json::json!({
            "agent_id": agent.id.to_string(),
            "type": "session_start",
            "message": if is_review_time { "Starting strategic review..." } else { "Co-founder checking in..." },
            "max_turns": max_turns,
            "max_duration_secs": agent.max_session_duration_secs,
        }));

        let result = match cli.run_turn_with_retry(config, Some(pool), Some(&app_handle), 2, None) {
            Ok(result) => result,
            Err(turn_err) => {
                let outcome = match &turn_err {
                    TurnError::RateLimited(_) => SessionOutcome::RateLimited,
                    _ => SessionOutcome::Error,
                };
                let log = WorkSessionLog {
                    id: session_uuid,
                    agent_id: agent.id,
                    session_id: String::new(),
                    mode: WorkSessionMode::Autonomous,
                    started_at,
                    ended_at: Some(Utc::now().to_rfc3339()),
                    turns: 0,
                    trigger: trigger.clone(),
                    outcome,
                    summary: format!("Failed to start session: {turn_err}"),
                    events_json: "[]".to_string(),
                    input_tokens: 0,
                    output_tokens: 0,
                    cost_usd: 0.0,
                };
                db.log_work_session(&log)?;
                return Ok(SessionResult {
                    log,
                    requested_next_checkin_secs: None,
                });
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
                mode: WorkSessionMode::Autonomous,
                started_at,
                ended_at: Some(Utc::now().to_rfc3339()),
                turns,
                trigger: trigger.clone(),
                outcome: SessionOutcome::Completed,
                summary: "Nothing to do".to_string(),
                events_json: serialize_events(&all_events),
                input_tokens: it,
                output_tokens: ot,
                cost_usd: cost,
            };
            db.log_work_session(&log)?;
            return Ok(SessionResult {
                log,
                requested_next_checkin_secs: requested,
            });
        }

        let session_start = std::time::Instant::now();

        while turns < max_turns {
            let _ = app_handle.emit(
                "agent-output",
                serde_json::json!({
                    "agent_id": agent.id.to_string(),
                    "type": "turn_progress",
                    "turn": turns,
                    "max_turns": max_turns,
                    "elapsed_secs": session_start.elapsed().as_secs(),
                    "max_duration_secs": agent.max_session_duration_secs,
                }),
            );

            if session_start.elapsed().as_secs() > agent.max_session_duration_secs {
                let requested = parse_next_checkin(&all_text);
                let (it, ot, cost) = parse_token_usage(&all_events);
                let log = WorkSessionLog {
                    id: session_uuid,
                    agent_id: agent.id,
                    session_id: final_session_id.clone().unwrap_or_default(),
                    mode: WorkSessionMode::Autonomous,
                    started_at: started_at.clone(),
                    ended_at: Some(Utc::now().to_rfc3339()),
                    turns,
                    trigger: trigger.clone(),
                    outcome: SessionOutcome::Timeout,
                    summary: "Session timed out".to_string(),
                    events_json: serialize_events(&all_events),
                    input_tokens: it,
                    output_tokens: ot,
                    cost_usd: cost,
                };
                db.log_work_session(&log)?;
                return Ok(SessionResult {
                    log,
                    requested_next_checkin_secs: requested,
                });
            }

            let sid = match &final_session_id {
                Some(s) => s.clone(),
                None => break,
            };

            let resume_config = TurnConfig {
                agent_id: agent.id.to_string(),
                workspace: agent.workspace.clone(),
                prompt: "Continue working on the highest-impact task. Start your response with exactly one line: `SESSION_STATUS: CONTINUE`, `SESSION_STATUS: DONE`, or `SESSION_STATUS: BLOCKED`. Use `DONE` only when this work session should end now. Use `BLOCKED` only when you genuinely cannot proceed without human input. Include your NEXT_CHECKIN directive at the end.".to_string(),
                soul_content: None,
                resume_session_id: Some(sid),
                allowed_tools: agent.allowed_tools.clone(),
                env_vars: env_vars.clone(),
                skip_permissions: skip_perms,
                pair_session_id: None,
            };

            match cli.run_turn_with_retry(resume_config, Some(pool), Some(&app_handle), 2, None) {
                Ok(turn_result) => {
                    turns += 1;
                    if let Some(ref sid) = turn_result.session_id {
                        final_session_id = Some(sid.clone());
                    }
                    all_events.extend(turn_result.events);
                    all_text.push_str(&turn_result.text_output);

                    if parse_session_status(&turn_result.text_output) == Some(SessionStatus::Blocked) {
                        let requested = parse_next_checkin(&all_text);
                        let (it, ot, cost) = parse_token_usage(&all_events);
                        let log = WorkSessionLog {
                            id: session_uuid,
                            agent_id: agent.id,
                            session_id: final_session_id.unwrap_or_default(),
                            mode: WorkSessionMode::Autonomous,
                            started_at: started_at.clone(),
                            ended_at: Some(Utc::now().to_rfc3339()),
                            turns,
                            trigger: trigger.clone(),
                            outcome: SessionOutcome::Blocked,
                            summary: truncate(&turn_result.text_output, 2000),
                            events_json: serialize_events(&all_events),
                            input_tokens: it,
                            output_tokens: ot,
                            cost_usd: cost,
                        };
                        db.log_work_session(&log)?;
                        return Ok(SessionResult {
                            log,
                            requested_next_checkin_secs: requested,
                        });
                    }
                    if parse_session_status(&turn_result.text_output) == Some(SessionStatus::Done) {
                        break;
                    }
                }
                Err(turn_err) => {
                    let outcome = match &turn_err {
                        TurnError::RateLimited(_) => SessionOutcome::RateLimited,
                        _ => SessionOutcome::Error,
                    };
                    let (it, ot, cost) = parse_token_usage(&all_events);
                    let log = WorkSessionLog {
                        id: session_uuid,
                        agent_id: agent.id,
                        session_id: final_session_id.unwrap_or_default(),
                        mode: WorkSessionMode::Autonomous,
                        started_at: started_at.clone(),
                        ended_at: Some(Utc::now().to_rfc3339()),
                        turns,
                        trigger: trigger.clone(),
                        outcome,
                        summary: format!("Error during turn: {turn_err}"),
                        events_json: serialize_events(&all_events),
                        input_tokens: it,
                        output_tokens: ot,
                        cost_usd: cost,
                    };
                    db.log_work_session(&log)?;
                    return Ok(SessionResult {
                        log,
                        requested_next_checkin_secs: None,
                    });
                }
            }
        }

        let requested = parse_next_checkin(&all_text);
        let (it, ot, cost) = parse_token_usage(&all_events);
        let log = WorkSessionLog {
            id: session_uuid,
            agent_id: agent.id,
            session_id: final_session_id.unwrap_or_default(),
            mode: WorkSessionMode::Autonomous,
            started_at,
            ended_at: Some(Utc::now().to_rfc3339()),
            turns,
            trigger,
            outcome: SessionOutcome::Completed,
            summary: if all_text.trim().is_empty() { "Work session completed".to_string() } else { truncate(&all_text, 2000) },
            events_json: serialize_events(&all_events),
            input_tokens: it,
            output_tokens: ot,
            cost_usd: cost,
        };
        db.log_work_session(&log)?;
        Ok(SessionResult {
            log,
            requested_next_checkin_secs: requested,
        })
    }

    pub async fn run_pair_session(
        cli: CliAdapter,
        agent: Agent,
        initial_message: String,
        mut receiver: tokio::sync::mpsc::Receiver<crate::LiveMessage>,
        pool: Arc<ProcessPool>,
        db: Arc<Database>,
        app_handle: AppHandle,
        pair_session_id: String,
        cancel: Arc<AtomicBool>,
    ) -> Result<WorkSessionLog, String> {
        let log_id = Uuid::new_v4();
        let started_at = Utc::now().to_rfc3339();
        let session_start = std::time::Instant::now();

        let soul_content = StateManager::get_soul_content(&agent.workspace, &agent.personality);
        let mission_file = StateManager::read_mission(&agent.workspace);
        let mission_content = if mission_file.trim().is_empty() {
            agent.mission.clone()
        } else {
            mission_file
        };
        let state_content = StateManager::read_state(&agent.workspace);
        let memory_content = StateManager::read_memory(&agent.workspace);
        let env_vars = db.get_agent_env_vars_as_pairs(&agent.id).unwrap_or_default();
        let skip_perms = agent.autonomy_level == crate::models::AutonomyLevel::Yolo;

        // Layer 2: Load recent pair history for context injection
        let pair_history = db
            .get_recent_pair_messages(&agent.id, 50)
            .unwrap_or_default();

        let mut claude_session_id: Option<String> = None;
        let mut turns: u32 = 0;
        let mut all_events: Vec<crate::cli_adapter::StreamEvent> = Vec::new();

        let mut outcome = SessionOutcome::Completed;
        let mut prompt = build_pair_kickoff_prompt(
            &mission_content,
            &state_content,
            &memory_content,
            &initial_message,
            &pair_history,
        );

        // Layer 1: Persist initial user message if non-empty
        if !initial_message.trim().is_empty() {
            let _ = db.save_pair_message(
                &agent.id,
                &pair_session_id,
                "user",
                &initial_message,
            );
        }

        let in_progress_log = WorkSessionLog {
            id: log_id,
            agent_id: agent.id,
            session_id: pair_session_id.clone(),
            mode: WorkSessionMode::Pair,
            started_at: started_at.clone(),
            ended_at: None,
            turns: 0,
            trigger: SessionTrigger::Manual,
            outcome: SessionOutcome::Completed,
            summary: "Pair session started".to_string(),
            events_json: "[]".to_string(),
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0.0,
        };
        db.log_work_session(&in_progress_log)?;

        let _ = app_handle.emit(
            "agent-output",
            serde_json::json!({
                "agent_id": agent.id.to_string(),
                "session_id": pair_session_id,
                "type": "session_start",
                "message": "Pair session started.",
                "max_turns": 9999,
                "max_duration_secs": agent.max_session_duration_secs,
            }),
        );

        let mut user_ended = false;

        let summary = loop {
            if session_start.elapsed().as_secs() > agent.max_session_duration_secs {
                outcome = SessionOutcome::Timeout;
                break "Pair session timed out".to_string();
            }

            let config = TurnConfig {
                agent_id: agent.id.to_string(),
                workspace: agent.workspace.clone(),
                prompt,
                soul_content: if claude_session_id.is_none() {
                    Some(soul_content.clone())
                } else {
                    None
                },
                resume_session_id: claude_session_id.clone(),
                allowed_tools: agent.allowed_tools.clone(),
                env_vars: env_vars.clone(),
                skip_permissions: skip_perms,
                pair_session_id: Some(pair_session_id.clone()),
            };

            let cli_for_turn = cli.clone();
            let pool_for_turn = pool.clone();
            let app_for_turn = app_handle.clone();
            let cancel_for_turn = cancel.clone();
            let turn_result = match tauri::async_runtime::spawn_blocking(move || {
                cli_for_turn.run_turn_with_retry(
                    config,
                    Some(pool_for_turn.as_ref()),
                    Some(&app_for_turn),
                    2,
                    Some(&cancel_for_turn),
                )
            })
            .await
            {
                Ok(result) => result,
                Err(err) => {
                    outcome = SessionOutcome::Interrupted;
                    break format!("Pair session interrupted: {err}");
                }
            };

            match turn_result {
                Ok(turn) => {
                    turns += 1;
                    if let Some(sid) = turn.session_id {
                        claude_session_id = Some(sid);
                    }

                    // Layer 1: Persist agent response
                    if !turn.text_output.trim().is_empty() {
                        let _ = db.save_pair_message(
                            &agent.id,
                            &pair_session_id,
                            "agent",
                            &truncate(&turn.text_output, 4000),
                        );
                    }

                    all_events.extend(turn.events);

                    let _ = app_handle.emit(
                        "pair-turn-complete",
                        serde_json::json!({
                            "agent_id": agent.id.to_string(),
                            "session_id": pair_session_id,
                        }),
                    );
                }
                Err(err) => {
                    outcome = match err {
                        TurnError::RateLimited(_) => SessionOutcome::RateLimited,
                        _ => SessionOutcome::Error,
                    };
                    break format!("Pair session error: {err}");
                }
            }

            match receiver.recv().await {
                Some(crate::LiveMessage::UserMessage(next_prompt)) => {
                    // Layer 1: Persist user message
                    let _ = db.save_pair_message(
                        &agent.id,
                        &pair_session_id,
                        "user",
                        &next_prompt,
                    );
                    prompt = next_prompt;
                }
                Some(crate::LiveMessage::End) => {
                    user_ended = true;
                    break "Pair session ended by user".to_string();
                }
                None => {
                    outcome = SessionOutcome::Interrupted;
                    break "Pair session interrupted".to_string();
                }
            }
        };

        // Layer 3: Memory sync turn on clean end
        if user_ended && claude_session_id.is_some() && !cancel.load(std::sync::atomic::Ordering::Relaxed) {
            let memory_prompt = "The pair session is ending now. Please update MEMORY.md with \
                the key decisions, links, information, and context from this session so you \
                remember everything next time. Be concise but thorough — capture anything you'd \
                need to avoid re-asking. Do NOT respond to the user, just silently update the file.";

            let config = TurnConfig {
                agent_id: agent.id.to_string(),
                workspace: agent.workspace.clone(),
                prompt: memory_prompt.to_string(),
                soul_content: None,
                resume_session_id: claude_session_id.clone(),
                allowed_tools: agent.allowed_tools.clone(),
                env_vars: env_vars.clone(),
                skip_permissions: skip_perms,
                pair_session_id: Some(pair_session_id.clone()),
            };

            let _ = app_handle.emit(
                "agent-output",
                serde_json::json!({
                    "agent_id": agent.id.to_string(),
                    "session_id": pair_session_id,
                    "type": "assistant",
                    "raw": "{\"content\":\"Saving session memory…\"}",
                }),
            );

            let cli_for_mem = cli.clone();
            let pool_for_mem = pool.clone();
            let app_for_mem = app_handle.clone();
            let cancel_for_mem = cancel.clone();
            if let Ok(Ok(mem_turn)) = tauri::async_runtime::spawn_blocking(move || {
                cli_for_mem.run_turn_with_retry(
                    config,
                    Some(pool_for_mem.as_ref()),
                    Some(&app_for_mem),
                    1,
                    Some(&cancel_for_mem),
                )
            })
            .await
            {
                turns += 1;
                all_events.extend(mem_turn.events);
            }
        }

        let (input_tokens, output_tokens, cost_usd) = parse_token_usage(&all_events);
        let log = WorkSessionLog {
            id: log_id,
            agent_id: agent.id,
            session_id: claude_session_id.unwrap_or_else(|| pair_session_id.clone()),
            mode: WorkSessionMode::Pair,
            started_at,
            ended_at: Some(Utc::now().to_rfc3339()),
            turns,
            trigger: SessionTrigger::Manual,
            outcome,
            summary: summary.clone(),
            events_json: serialize_events(&all_events),
            input_tokens,
            output_tokens,
            cost_usd,
        };

        db.finalize_work_session(&log)?;
        crate::cli_adapter::clear_pair_preview_urls(&pair_session_id);

        let _ = app_handle.emit("session-completed", &log);
        let _ = app_handle.emit(
            "pair-session-ended",
            serde_json::json!({
                "agent_id": agent.id.to_string(),
                "session_id": pair_session_id,
                "summary": summary,
            }),
        );

        Ok(log)
    }
}

fn build_pair_kickoff_prompt(
    mission: &str,
    state: &str,
    memory: &str,
    user_message: &str,
    pair_history: &[(String, String, String)],
) -> String {
    let memory_tail = {
        let lines: Vec<&str> = memory.lines().collect();
        if lines.len() > 40 {
            lines[lines.len() - 40..].join("\n")
        } else {
            memory.to_string()
        }
    };

    let history_section = if pair_history.is_empty() {
        String::new()
    } else {
        let mut buf = String::from("## Recent Pair Conversations\n");
        buf.push_str("(These are messages from your recent pair sessions with your co-founder. Use this context to avoid re-asking questions.)\n\n");
        for (role, content, timestamp) in pair_history {
            let label = if role == "user" { "Co-Founder" } else { "You" };
            let short_time = timestamp.get(..16).unwrap_or(timestamp);
            buf.push_str(&format!("[{short_time}] **{label}**: {}\n", truncate(content, 500)));
        }
        buf.push('\n');
        buf
    };

    let request_section = if user_message.trim().is_empty() {
        "Your co-founder just started a pair session. Greet them briefly, summarize where things \
         stand right now, and ask what they'd like to work on together. Keep it concise and direct."
            .to_string()
    } else {
        format!(
            "## Co-Founder Request\n{user_message}\n\nRespond with what you'll do now, then execute. Keep momentum high."
        )
    };

    format!(
        "You are in PAIR MODE with your human co-founder.\n\
         Collaborate directly and execute immediately.\n\n\
         ## Mission\n{mission}\n\n\
         ## Current State\n{state}\n\n\
         ## Recent Memory\n{memory_tail}\n\n\
         {history_section}\
         {request_section}"
    )
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum SessionStatus {
    Continue,
    Done,
    Blocked,
}

fn parse_session_status(text: &str) -> Option<SessionStatus> {
    for line in text.lines() {
        let trimmed = line.trim();
        let upper = trimmed.to_ascii_uppercase();
        let Some(rest) = upper.strip_prefix("SESSION_STATUS:") else {
            continue;
        };
        let status = rest.trim();
        if status == "DONE" {
            return Some(SessionStatus::Done);
        }
        if status == "CONTINUE" {
            return Some(SessionStatus::Continue);
        }
        if status == "BLOCKED" {
            return Some(SessionStatus::Blocked);
        }
    }
    None
}

fn parse_hhmm_minutes(time_str: &str) -> Option<u16> {
    let mut parts = time_str.split(':');
    let hour = parts.next()?.parse::<u16>().ok()?;
    let minute = parts.next()?.parse::<u16>().ok()?;
    if parts.next().is_some() || hour > 23 || minute > 59 {
        return None;
    }
    Some(hour * 60 + minute)
}

fn recurrence_label(recurrence: &str) -> &'static str {
    match recurrence {
        "once" => "one-time",
        "daily" => "daily",
        "weekdays" => "weekdays",
        "weekly" => "weekly",
        _ => "custom",
    }
}

fn is_schedule_entry_active_today(
    recurrence: &str,
    day_of_week: Option<u8>,
    last_run: Option<&str>,
    now: &chrono::DateTime<chrono::Local>,
) -> bool {
    match recurrence {
        "once" => last_run.is_none(),
        "daily" => true,
        "weekdays" => matches!(
            now.weekday(),
            chrono::Weekday::Mon
                | chrono::Weekday::Tue
                | chrono::Weekday::Wed
                | chrono::Weekday::Thu
                | chrono::Weekday::Fri
        ),
        "weekly" => {
            let today = now.weekday().num_days_from_sunday() as u8;
            day_of_week.map(|d| d == today).unwrap_or(true)
        }
        _ => true,
    }
}

fn mark_once_entries_as_run(workspace: &str, ids: &[String]) {
    let schedule = StateManager::read_schedule(workspace);
    let now_stamp = Utc::now().to_rfc3339();
    let mut updated_lines = Vec::new();
    for line in schedule.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("- ") {
            let parts: Vec<&str> = trimmed[2..].split('|').map(|s| s.trim()).collect();
            if parts.len() > 5 && ids.contains(&parts[5].to_string()) {
                let mut new_parts: Vec<String> = parts.iter().map(|p| p.to_string()).collect();
                while new_parts.len() < 7 {
                    new_parts.push(String::new());
                }
                new_parts[6] = now_stamp.clone();
                updated_lines.push(format!("- {}", new_parts.join(" | ")));
                continue;
            }
        }
        updated_lines.push(line.to_string());
    }
    let _ = StateManager::write_schedule(workspace, &updated_lines.join("\n"));
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
    let cost =
        (input_tokens as f64 * 3.0 / 1_000_000.0) + (output_tokens as f64 * 15.0 / 1_000_000.0);
    (
        input_tokens,
        output_tokens,
        (cost * 10000.0).round() / 10000.0,
    )
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
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let end: String = s.chars().take(max - 3).collect();
        format!("{end}...")
    }
}

fn default_empty_tasks() -> &'static str {
    "# Tasks\n\n## In Progress\n\n\n## To Do\n\n\n## Done\n\n\n## Blocked"
}
