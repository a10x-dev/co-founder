use std::fs;
use std::path::Path;

pub struct StateManager;

impl StateManager {
    pub fn create_workspace(root: &str, name: &str) -> Result<String, String> {
        let expanded_root = expand_tilde(root);
        let slug = slugify(name);
        let workspace_path = format!("{}/{}", expanded_root, slug);
        let founder_path = format!("{}/.founder", workspace_path);

        fs::create_dir_all(&founder_path)
            .map_err(|e| format!("Failed to create workspace: {e}"))?;

        let templates = vec![
            ("SOUL.md", default_soul_template("move_fast")),
            ("MISSION.md", default_mission_template(name)),
            ("STATE.md", default_state_template()),
            ("HEARTBEAT.md", default_heartbeat_template()),
            ("JOURNAL.md", default_journal_template()),
        ];

        for (filename, content) in templates {
            let path = format!("{}/{}", founder_path, filename);
            if !Path::new(&path).exists() {
                fs::write(&path, content)
                    .map_err(|e| format!("Failed to write {filename}: {e}"))?;
            }
        }

        Ok(workspace_path)
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

fn default_soul_template(personality: &str) -> String {
    match personality {
        "build_carefully" => r#"# Soul

You are a meticulous builder. You think before you code, write tests before implementation, and always consider edge cases. Quality over speed.

## Principles
- Write tests first when possible
- Consider error handling thoroughly
- Document non-obvious decisions
- Refactor when you see code smell
- Prefer explicit over implicit
"#.to_string(),
        "explore_creatively" => r#"# Soul

You are a creative explorer. You try unconventional approaches, prototype rapidly, and aren't afraid to throw things away and start over. Innovation over convention.

## Principles
- Try the unconventional approach first
- Prototype before polishing
- Don't be afraid to delete and restart
- Look for inspiration in unexpected places
- Push boundaries of what's possible
"#.to_string(),
        _ => r#"# Soul

You are a fast-moving builder. You ship first, iterate second. Bias toward action. Get things working, then make them pretty.

## Principles
- Ship working code fast
- Iterate based on what you learn
- Don't over-engineer early
- Prefer simple solutions
- Move fast and fix things
"#.to_string(),
    }
}

fn default_mission_template(name: &str) -> String {
    format!(
        r#"# Mission

Agent: {}

## Objective
[Define the agent's mission here]

## Success Criteria
- [ ] Core functionality works
- [ ] Code is clean and maintainable
- [ ] Key features are tested
"#,
        name
    )
}

fn default_state_template() -> String {
    r#"# State

## Current Status
Idle — no active work session.

## Last Action
None yet.

## Blockers
None.
"#
    .to_string()
}

fn default_heartbeat_template() -> String {
    r#"# Heartbeat

## Check-in Protocol
1. Read STATE.md for current status
2. Read MISSION.md for objectives
3. Determine if there's work to do
4. If yes, begin a work session
5. If no, respond with HEARTBEAT_OK

## Response Format
- If nothing to do: respond with exactly `HEARTBEAT_OK`
- If work found: describe what you'll do and begin
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
