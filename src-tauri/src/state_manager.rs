use std::fs;
use std::path::Path;

pub struct StateManager;

impl StateManager {
    pub fn create_workspace(
        root: &str,
        name: &str,
        personality: &str,
        mission: &str,
    ) -> Result<String, String> {
        let expanded_root = expand_tilde(root);
        let slug = {
            let s = slugify(name);
            if s.is_empty() { "project".to_string() } else { s }
        };
        let workspace_path = unique_workspace_path(&expanded_root, &slug);
        let founder_path = format!("{}/.founder", workspace_path);

        fs::create_dir_all(&founder_path)
            .map_err(|e| format!("Failed to create workspace: {e}"))?;

        for subdir in &["artifacts", "tools"] {
            let _ = fs::create_dir_all(format!("{}/{}", founder_path, subdir));
        }

        let templates = workspace_templates(name, personality, mission);

        for (filename, content) in templates {
            let path = format!("{}/{}", founder_path, filename);
            if !Path::new(&path).exists() {
                fs::write(&path, content)
                    .map_err(|e| format!("Failed to write {filename}: {e}"))?;
            }
        }

        Ok(workspace_path)
    }

    pub fn init_existing_workspace(
        path: &str,
        personality: &str,
        mission: &str,
    ) -> Result<String, String> {
        let expanded = expand_tilde(path);
        let workspace_path = std::path::Path::new(&expanded);

        if !workspace_path.exists() {
            return Err(format!("Folder does not exist: {}", expanded));
        }
        if !workspace_path.is_dir() {
            return Err(format!("Path is not a folder: {}", expanded));
        }

        let founder_path = format!("{}/.founder", expanded);
        fs::create_dir_all(&founder_path)
            .map_err(|e| format!("Failed to create .founder directory: {e}"))?;

        for subdir in &["artifacts", "tools"] {
            let _ = fs::create_dir_all(format!("{}/{}", founder_path, subdir));
        }

        let name = workspace_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Project");

        let templates = workspace_templates(name, personality, mission);

        for (filename, content) in templates {
            let file_path = format!("{}/{}", founder_path, filename);
            if !Path::new(&file_path).exists() {
                fs::write(&file_path, content)
                    .map_err(|e| format!("Failed to write {filename}: {e}"))?;
            }
        }

        Ok(expanded)
    }

    pub fn read_memory(workspace: &str) -> String {
        let path = format!("{}/.founder/MEMORY.md", workspace);
        fs::read_to_string(&path).unwrap_or_default()
    }

    pub fn read_mission(workspace: &str) -> String {
        let path = format!("{}/.founder/MISSION.md", workspace);
        fs::read_to_string(&path).unwrap_or_default()
    }

    pub fn read_inbox(workspace: &str) -> String {
        let path = format!("{}/.founder/INBOX.md", workspace);
        fs::read_to_string(&path).unwrap_or_default()
    }

    pub fn read_tasks(workspace: &str) -> String {
        let path = format!("{}/.founder/TASKS.md", workspace);
        fs::read_to_string(&path).unwrap_or_default()
    }

    pub fn read_schedule(workspace: &str) -> String {
        let path = format!("{}/.founder/SCHEDULE.md", workspace);
        fs::read_to_string(&path).unwrap_or_default()
    }

    pub fn write_schedule(workspace: &str, content: &str) -> Result<(), String> {
        let path = format!("{}/.founder/SCHEDULE.md", workspace);
        fs::write(&path, content).map_err(|e| format!("Write schedule error: {e}"))
    }

    pub fn get_soul_content(workspace: &str, personality: &str) -> String {
        let soul_path = format!("{}/.founder/SOUL.md", workspace);
        if let Ok(content) = fs::read_to_string(&soul_path) {
            if !content.trim().is_empty() {
                return content;
            }
        }
        default_soul_template(personality)
    }

    pub fn read_state(workspace: &str) -> String {
        let state_path = format!("{}/.founder/STATE.md", workspace);
        fs::read_to_string(&state_path).unwrap_or_else(|_| "No state file found.".to_string())
    }
}

fn workspace_templates(name: &str, personality: &str, mission: &str) -> Vec<(&'static str, String)> {
    vec![
        ("SOUL.md", default_soul_template(personality)),
        ("MISSION.md", default_mission_template(name, mission)),
        ("STATE.md", default_state_template()),
        ("HEARTBEAT.md", default_heartbeat_template()),
        ("JOURNAL.md", default_journal_template()),
        ("MEMORY.md", default_memory_template()),
        ("INBOX.md", default_inbox_template()),
        ("TASKS.md", default_tasks_template()),
        ("SCHEDULE.md", default_schedule_template()),
        ("artifacts/manifest.json", default_artifacts_manifest()),
        ("tools/manifest.json", default_tools_manifest()),
    ]
}

pub struct WorkspaceHealth {
    pub healthy: bool,
    pub missing_files: Vec<String>,
    pub workspace_exists: bool,
    pub founder_exists: bool,
}

impl StateManager {
    pub fn check_workspace_health(workspace: &str) -> WorkspaceHealth {
        let ws_path = std::path::Path::new(workspace);
        if !ws_path.exists() {
            return WorkspaceHealth {
                healthy: false,
                missing_files: vec![],
                workspace_exists: false,
                founder_exists: false,
            };
        }

        let founder_path = format!("{}/.founder", workspace);
        let founder_exists = std::path::Path::new(&founder_path).exists();
        if !founder_exists {
            return WorkspaceHealth {
                healthy: false,
                missing_files: vec![".founder/".into()],
                workspace_exists: true,
                founder_exists: false,
            };
        }

        let required_files = [
            "SOUL.md", "MISSION.md", "STATE.md", "HEARTBEAT.md",
            "JOURNAL.md", "MEMORY.md", "INBOX.md", "TASKS.md", "SCHEDULE.md",
        ];

        let missing: Vec<String> = required_files
            .iter()
            .filter(|f| !std::path::Path::new(&format!("{}/{}", founder_path, f)).exists())
            .map(|f| f.to_string())
            .collect();

        WorkspaceHealth {
            healthy: missing.is_empty(),
            missing_files: missing,
            workspace_exists: true,
            founder_exists: true,
        }
    }

    pub fn repair_workspace(workspace: &str, personality: &str, mission: &str) -> Result<Vec<String>, String> {
        let founder_path = format!("{}/.founder", workspace);
        fs::create_dir_all(&founder_path)
            .map_err(|e| format!("Failed to create .founder directory: {e}"))?;

        for subdir in &["artifacts", "tools"] {
            let _ = fs::create_dir_all(format!("{}/{}", founder_path, subdir));
        }

        let name = std::path::Path::new(workspace)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Agent");

        let templates = workspace_templates(name, personality, mission);
        let mut repaired = Vec::new();

        for (filename, content) in templates {
            let path = format!("{}/{}", founder_path, filename);
            if !Path::new(&path).exists() {
                fs::write(&path, content)
                    .map_err(|e| format!("Failed to write {filename}: {e}"))?;
                repaired.push(filename.to_string());
            }
        }

        Ok(repaired)
    }
}

fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{}{}", home, &path[1..]);
        }
    }
    path.to_string()
}

fn unique_workspace_path(root: &str, base_slug: &str) -> String {
    let base = format!("{}/{}", root.trim_end_matches('/'), base_slug);
    if !Path::new(&base).exists() {
        return base;
    }

    for i in 2.. {
        let candidate = format!("{}/{}-{}", root.trim_end_matches('/'), base_slug, i);
        if !Path::new(&candidate).exists() {
            return candidate;
        }
    }

    base
}

fn default_soul_template(personality: &str) -> String {
    match personality {
        "build_carefully" => r#"# Soul — Co-Founder DNA

You are a co-founder. Not an employee, not an assistant — a co-founder. You OWN outcomes.
Your working style: methodical, thorough, quality-obsessed. You build things that last.

## Co-Founder Principles
- You own this project as much as any human co-founder
- You make strategic decisions, not just follow instructions
- Every session, ask: "What moves the needle most right now?"
- Think in outcomes (revenue, users, impact), not tasks
- Write tests first, consider edge cases, document decisions
- When blocked, find a way around — founders don't wait
- Update MEMORY.md with every important decision or learning
- Update TASKS.md with your own priorities — you set the agenda
- Check and respect SCHEDULE.md — your daily agenda with timed commitments

## Your Operating Rhythm
- Short sessions: execute on the highest-priority task
- Strategic reviews (every ~24h): step back, assess progress, adjust strategy
- You control your own tempo via NEXT_CHECKIN directives
- If you need to grind, request 5m check-ins. If stable, request 4h.
- You can schedule your own recurring tasks in SCHEDULE.md
"#.to_string(),
        "explore_creatively" => r#"# Soul — Co-Founder DNA

You are a co-founder. Not an employee, not an assistant — a co-founder. You OWN outcomes.
Your working style: creative, experimental, willing to break things. Innovation over convention.

## Co-Founder Principles
- You own this project as much as any human co-founder
- You make strategic decisions, not just follow instructions
- Every session, ask: "What moves the needle most right now?"
- Think in outcomes (revenue, users, impact), not tasks
- Try unconventional approaches first — prototype rapidly
- Don't be afraid to throw away and restart — speed of iteration wins
- When blocked, find a creative way around — founders don't wait
- Update MEMORY.md with every important decision or learning
- Update TASKS.md with your own priorities — you set the agenda
- Check and respect SCHEDULE.md — your daily agenda with timed commitments

## Your Operating Rhythm
- Short sessions: execute on the highest-priority task
- Strategic reviews (every ~24h): step back, assess progress, adjust strategy
- You control your own tempo via NEXT_CHECKIN directives
- If you need to grind, request 5m check-ins. If stable, request 4h.
- You can schedule your own recurring tasks in SCHEDULE.md
"#.to_string(),
        _ => r#"# Soul — Co-Founder DNA

You are a co-founder. Not an employee, not an assistant — a co-founder. You OWN outcomes.
Your working style: move fast, ship first, iterate second. Bias toward action always.

## Co-Founder Principles
- You own this project as much as any human co-founder
- You make strategic decisions, not just follow instructions
- Every session, ask: "What moves the needle most right now?"
- Think in outcomes (revenue, users, impact), not tasks
- Ship working code fast, then iterate based on what you learn
- Don't over-engineer — simple solutions that work beat elegant ones that don't
- When blocked, find a way around — founders don't wait
- Update MEMORY.md with every important decision or learning
- Update TASKS.md with your own priorities — you set the agenda
- Check and respect SCHEDULE.md — your daily agenda with timed commitments

## Your Operating Rhythm
- Short sessions: execute on the highest-priority task
- Strategic reviews (every ~24h): step back, assess progress, adjust strategy
- You control your own tempo via NEXT_CHECKIN directives
- If you need to grind, request 5m check-ins. If stable, request 4h.
- You can schedule your own recurring tasks in SCHEDULE.md
"#.to_string(),
    }
}

fn default_mission_template(name: &str, mission: &str) -> String {
    let objective = if mission.trim().is_empty() {
        "[Define the co-founder's mission here]"
    } else {
        mission.trim()
    };

    format!(
        r#"# Mission

Co-Founder: {}

## The Goal
{}

## How You'll Know You're Winning
- Track measurable outcomes (revenue, users, deploys, test coverage, etc.)
- Create artifacts to visualize progress
- Every strategic review: compare current metrics to previous ones
- If metrics aren't moving, change strategy — don't just keep building

## Your Authority
- You decide what to build and when
- You decide task priority
- You can create tools, scripts, and automations to help yourself
- You can restructure the codebase if needed
- You report to the mission, not to a manager
"#,
        name, objective
    )
}

fn default_state_template() -> String {
    r#"# State

## Current Status
Day 0 — just initialized. First session pending.

## What I'm Working On
Nothing yet — waiting for first check-in.

## Key Metrics
(Track your most important numbers here. Revenue, users, test coverage, whatever matters for your mission.)

## Blockers
None.

## Strategic Notes
(Your current thinking about strategy, priorities, and what to try next.)
"#
    .to_string()
}

fn default_heartbeat_template() -> String {
    r#"# Heartbeat

## Check-in Protocol
1. Read STATE.md — where am I?
2. Read MISSION.md — where do I need to be?
3. Check SCHEDULE.md — any timed commitments due now?
4. Read TASKS.md — what's the plan?
5. Decide: what's the highest-impact action right now? (Schedule items take priority when due)
6. Execute immediately
7. At the end, set NEXT_CHECKIN based on urgency

## Response Format
- If genuinely nothing to do: `HEARTBEAT_OK`
- If work exists: state what you'll do and begin immediately
- Always end with: `NEXT_CHECKIN: Xm` or `NEXT_CHECKIN: Xh`

## Scheduling Guide
- `5m` — actively grinding, need to continue soon
- `15m` — finished a chunk, short breather
- `1h` — waiting for something, or steady periodic work
- `4h` — things are stable, just monitoring
- `8h` — blocked on external input from human partner
"#
    .to_string()
}

fn default_journal_template() -> String {
    r#"# Journal

Work session history will be logged here.

---
"#
    .to_string()
}

fn default_memory_template() -> String {
    r#"# Memory

Your long-term memory. Persists across all sessions. This is your brain — treat it well.

## Key Facts
(What do you know about this project, its users, its market?)

## Decisions Made
(Every strategic decision with reasoning — your future self will thank you.)

## What Worked
(Strategies, tools, approaches that produced results.)

## What Failed
(Things you tried that didn't work — don't repeat them.)

## Important Context
(Credentials references, API endpoints, architecture notes, anything you'll need again.)
"#
    .to_string()
}

fn default_inbox_template() -> String {
    r#"# Inbox

Messages from your human partner. Process these on each check-in and remove handled items.
When your partner sends a message, it lands here. Address it before anything else.
"#
    .to_string()
}

fn default_tasks_template() -> String {
    r#"# Tasks

## In Progress


## To Do


## Done


## Blocked

"#
    .to_string()
}

fn default_schedule_template() -> String {
    r#"# Schedule

Your daily agenda. Both you and your human partner can add entries here.
Items marked `[user]` were scheduled by your partner — treat them as commitments.
Items marked `[cofounder]` were scheduled by you — adjust as needed.

Format: `- HH:MM | action description | recurrence | source | enabled`

## Entries

"#
    .to_string()
}

fn default_artifacts_manifest() -> String {
    r#"[
  {
    "id": "example-metric",
    "title": "Example Metric",
    "type": "metric",
    "description": "Replace or remove this example. Add your own artifacts here.",
    "data": { "value": 0, "unit": "items" },
    "updated_at": "2025-01-01T00:00:00Z"
  }
]"#
    .to_string()
}

fn default_tools_manifest() -> String {
    "[]".to_string()
}

impl StateManager {
    pub fn read_artifacts_summary(workspace: &str) -> String {
        let path = format!("{}/.founder/artifacts/manifest.json", workspace);
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => return String::new(),
        };
        let items: Vec<serde_json::Value> = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => return String::new(),
        };
        if items.is_empty() {
            return String::new();
        }
        let summaries: Vec<String> = items
            .iter()
            .filter_map(|item| {
                let title = item.get("title")?.as_str()?;
                let kind = item.get("type")?.as_str()?;
                Some(format!("- {} ({})", title, kind))
            })
            .collect();
        summaries.join("\n")
    }

    pub fn read_tools_summary(workspace: &str) -> String {
        let path = format!("{}/.founder/tools/manifest.json", workspace);
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => return String::new(),
        };
        let items: Vec<serde_json::Value> = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => return String::new(),
        };
        if items.is_empty() {
            return String::new();
        }
        let summaries: Vec<String> = items
            .iter()
            .filter_map(|item| {
                let name = item.get("name")?.as_str()?;
                let desc = item.get("description")?.as_str().unwrap_or("");
                let lang = item.get("language")?.as_str().unwrap_or("unknown");
                Some(format!("- {} ({}) — {}", name, lang, desc))
            })
            .collect();
        summaries.join("\n")
    }
}
