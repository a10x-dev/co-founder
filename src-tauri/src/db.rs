use rusqlite::{params, Connection};
use std::sync::Mutex;
use uuid::Uuid;

use crate::models::*;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self, String> {
        let data_dir = dirs_data_dir().ok_or("Cannot determine home directory")?;
        std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {e}"))?;
        let db_path = format!("{}/data.db", data_dir);

        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database: {e}"))?;

        let db = Database {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;
        Ok(db)
    }

    fn run_migrations(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                workspace TEXT NOT NULL,
                soul_path TEXT NOT NULL DEFAULT '',
                mission TEXT NOT NULL DEFAULT '',
                autonomy_level TEXT NOT NULL DEFAULT 'semi',
                allowed_tools TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'idle',
                current_session_id TEXT,
                max_session_duration_secs INTEGER NOT NULL DEFAULT 900,
                created_at TEXT NOT NULL,
                last_heartbeat_at TEXT,
                total_sessions INTEGER NOT NULL DEFAULT 0,
                personality TEXT NOT NULL DEFAULT 'move_fast',
                checkin_interval_secs INTEGER NOT NULL DEFAULT 1800
            );

            CREATE TABLE IF NOT EXISTS work_sessions (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                turns INTEGER NOT NULL DEFAULT 0,
                trigger TEXT NOT NULL DEFAULT 'heartbeat',
                outcome TEXT NOT NULL DEFAULT 'completed',
                summary TEXT NOT NULL DEFAULT '',
                events_json TEXT NOT NULL DEFAULT '[]',
                FOREIGN KEY (agent_id) REFERENCES agents(id)
            );

            CREATE TABLE IF NOT EXISTS global_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                max_concurrent_agents INTEGER NOT NULL DEFAULT 3,
                default_workspace_root TEXT NOT NULL DEFAULT '~/agent-workspaces',
                claude_cli_path TEXT NOT NULL DEFAULT '',
                minimize_to_tray INTEGER NOT NULL DEFAULT 1
            );

            INSERT OR IGNORE INTO global_settings (id, max_concurrent_agents, default_workspace_root, claude_cli_path, minimize_to_tray)
            VALUES (1, 3, '~/agent-workspaces', '', 1);",
        )
        .map_err(|e| format!("Migration failed: {e}"))?;

        Ok(())
    }

    pub fn get_agents(&self) -> Result<Vec<Agent>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let mut stmt = conn
            .prepare("SELECT id, name, workspace, soul_path, mission, autonomy_level, allowed_tools, status, current_session_id, max_session_duration_secs, created_at, last_heartbeat_at, total_sessions, personality, checkin_interval_secs FROM agents ORDER BY created_at DESC")
            .map_err(|e| format!("Query error: {e}"))?;

        let agents = stmt
            .query_map([], |row| {
                Ok(Agent {
                    id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap_or_default(),
                    name: row.get(1)?,
                    workspace: row.get(2)?,
                    soul_path: row.get(3)?,
                    mission: row.get(4)?,
                    autonomy_level: AutonomyLevel::from_str(&row.get::<_, String>(5)?),
                    allowed_tools: row.get(6)?,
                    status: AgentStatus::from_str(&row.get::<_, String>(7)?),
                    current_session_id: row.get(8)?,
                    max_session_duration_secs: row.get::<_, i64>(9)? as u64,
                    created_at: row.get(10)?,
                    last_heartbeat_at: row.get(11)?,
                    total_sessions: row.get::<_, i32>(12)? as u32,
                    personality: row.get(13)?,
                    checkin_interval_secs: row.get::<_, i64>(14)? as u64,
                })
            })
            .map_err(|e| format!("Query error: {e}"))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(agents)
    }

    pub fn get_agent(&self, id: &Uuid) -> Result<Agent, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.query_row(
            "SELECT id, name, workspace, soul_path, mission, autonomy_level, allowed_tools, status, current_session_id, max_session_duration_secs, created_at, last_heartbeat_at, total_sessions, personality, checkin_interval_secs FROM agents WHERE id = ?1",
            params![id.to_string()],
            |row| {
                Ok(Agent {
                    id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap_or_default(),
                    name: row.get(1)?,
                    workspace: row.get(2)?,
                    soul_path: row.get(3)?,
                    mission: row.get(4)?,
                    autonomy_level: AutonomyLevel::from_str(&row.get::<_, String>(5)?),
                    allowed_tools: row.get(6)?,
                    status: AgentStatus::from_str(&row.get::<_, String>(7)?),
                    current_session_id: row.get(8)?,
                    max_session_duration_secs: row.get::<_, i64>(9)? as u64,
                    created_at: row.get(10)?,
                    last_heartbeat_at: row.get(11)?,
                    total_sessions: row.get::<_, i32>(12)? as u32,
                    personality: row.get(13)?,
                    checkin_interval_secs: row.get::<_, i64>(14)? as u64,
                })
            },
        )
        .map_err(|e| format!("Agent not found: {e}"))
    }

    pub fn create_agent(&self, agent: &Agent) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute(
            "INSERT INTO agents (id, name, workspace, soul_path, mission, autonomy_level, allowed_tools, status, current_session_id, max_session_duration_secs, created_at, last_heartbeat_at, total_sessions, personality, checkin_interval_secs) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                agent.id.to_string(),
                agent.name,
                agent.workspace,
                agent.soul_path,
                agent.mission,
                agent.autonomy_level.to_string(),
                agent.allowed_tools,
                agent.status.to_string(),
                agent.current_session_id,
                agent.max_session_duration_secs as i64,
                agent.created_at,
                agent.last_heartbeat_at,
                agent.total_sessions as i32,
                agent.personality,
                agent.checkin_interval_secs as i64,
            ],
        )
        .map_err(|e| format!("Insert error: {e}"))?;
        Ok(())
    }

    pub fn update_agent_status(&self, id: &Uuid, status: &AgentStatus) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute(
            "UPDATE agents SET status = ?1 WHERE id = ?2",
            params![status.to_string(), id.to_string()],
        )
        .map_err(|e| format!("Update error: {e}"))?;
        Ok(())
    }

    pub fn delete_agent(&self, id: &Uuid) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute("DELETE FROM work_sessions WHERE agent_id = ?1", params![id.to_string()])
            .map_err(|e| format!("Delete sessions error: {e}"))?;
        conn.execute("DELETE FROM agents WHERE id = ?1", params![id.to_string()])
            .map_err(|e| format!("Delete error: {e}"))?;
        Ok(())
    }

    pub fn get_work_sessions(&self, agent_id: &Uuid) -> Result<Vec<WorkSessionLog>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let mut stmt = conn
            .prepare("SELECT id, agent_id, session_id, started_at, ended_at, turns, trigger, outcome, summary, events_json FROM work_sessions WHERE agent_id = ?1 ORDER BY started_at DESC")
            .map_err(|e| format!("Query error: {e}"))?;

        let sessions = stmt
            .query_map(params![agent_id.to_string()], |row| {
                Ok(WorkSessionLog {
                    id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap_or_default(),
                    agent_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap_or_default(),
                    session_id: row.get(2)?,
                    started_at: row.get(3)?,
                    ended_at: row.get(4)?,
                    turns: row.get::<_, i32>(5)? as u32,
                    trigger: SessionTrigger::from_str(&row.get::<_, String>(6)?),
                    outcome: SessionOutcome::from_str(&row.get::<_, String>(7)?),
                    summary: row.get(8)?,
                    events_json: row.get(9)?,
                })
            })
            .map_err(|e| format!("Query error: {e}"))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(sessions)
    }

    pub fn log_work_session(&self, log: &WorkSessionLog) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute(
            "INSERT INTO work_sessions (id, agent_id, session_id, started_at, ended_at, turns, trigger, outcome, summary, events_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                log.id.to_string(),
                log.agent_id.to_string(),
                log.session_id,
                log.started_at,
                log.ended_at,
                log.turns as i32,
                log.trigger.to_string(),
                log.outcome.to_string(),
                log.summary,
                log.events_json,
            ],
        )
        .map_err(|e| format!("Insert session error: {e}"))?;

        // Increment total_sessions on the agent
        conn.execute(
            "UPDATE agents SET total_sessions = total_sessions + 1 WHERE id = ?1",
            params![log.agent_id.to_string()],
        )
        .map_err(|e| format!("Update sessions count error: {e}"))?;

        Ok(())
    }

    pub fn get_global_settings(&self) -> Result<GlobalSettings, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.query_row(
            "SELECT max_concurrent_agents, default_workspace_root, claude_cli_path, minimize_to_tray FROM global_settings WHERE id = 1",
            [],
            |row| {
                Ok(GlobalSettings {
                    max_concurrent_agents: row.get::<_, i32>(0)? as u8,
                    default_workspace_root: row.get(1)?,
                    claude_cli_path: row.get(2)?,
                    minimize_to_tray: row.get::<_, i32>(3)? != 0,
                })
            },
        )
        .map_err(|e| format!("Settings not found: {e}"))
    }

    pub fn update_global_settings(&self, settings: &GlobalSettings) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute(
            "UPDATE global_settings SET max_concurrent_agents = ?1, default_workspace_root = ?2, claude_cli_path = ?3, minimize_to_tray = ?4 WHERE id = 1",
            params![
                settings.max_concurrent_agents as i32,
                settings.default_workspace_root,
                settings.claude_cli_path,
                if settings.minimize_to_tray { 1i32 } else { 0i32 },
            ],
        )
        .map_err(|e| format!("Update settings error: {e}"))?;
        Ok(())
    }
}

fn dirs_data_dir() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    Some(format!("{}/.agent-founder", home))
}
