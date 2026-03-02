use rusqlite::{params, Connection};
use std::sync::Mutex;
use uuid::Uuid;

use crate::crypto;
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
                max_session_duration_secs INTEGER NOT NULL DEFAULT 1800,
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

        Self::migrate_add_reliability_columns(&conn)?;
        Self::migrate_add_env_vars_table(&conn)?;
        Self::migrate_add_active_hours(&conn)?;
        Self::migrate_add_cost_tracking(&conn)?;
        Self::migrate_add_budget_and_teams(&conn)?;

        Ok(())
    }

    fn migrate_add_env_vars_table(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_env_vars (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (agent_id) REFERENCES agents(id),
                UNIQUE(agent_id, key)
            );",
        )
        .map_err(|e| format!("Env vars migration failed: {e}"))?;
        Ok(())
    }

    fn migrate_add_cost_tracking(conn: &Connection) -> Result<(), String> {
        let has_col: bool = conn
            .prepare("SELECT input_tokens FROM work_sessions LIMIT 0")
            .is_ok();
        if !has_col {
            conn.execute_batch(
                "ALTER TABLE work_sessions ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE work_sessions ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE work_sessions ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0.0;",
            )
            .map_err(|e| format!("Cost tracking migration failed: {e}"))?;
        }
        Ok(())
    }

    fn migrate_add_active_hours(conn: &Connection) -> Result<(), String> {
        let has_col: bool = conn
            .prepare("SELECT active_hours_enabled FROM agents LIMIT 0")
            .is_ok();
        if !has_col {
            conn.execute_batch(
                "ALTER TABLE agents ADD COLUMN active_hours_enabled INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE agents ADD COLUMN active_hours_start INTEGER NOT NULL DEFAULT 9;
                 ALTER TABLE agents ADD COLUMN active_hours_end INTEGER NOT NULL DEFAULT 22;",
            )
            .map_err(|e| format!("Active hours migration failed: {e}"))?;
        }
        Ok(())
    }

    fn migrate_add_budget_and_teams(conn: &Connection) -> Result<(), String> {
        let has_budget: bool = conn
            .prepare("SELECT daily_budget_usd FROM agents LIMIT 0")
            .is_ok();
        if !has_budget {
            conn.execute_batch(
                "ALTER TABLE agents ADD COLUMN daily_budget_usd REAL NOT NULL DEFAULT 0.0;
                 ALTER TABLE agents ADD COLUMN team_id TEXT;",
            )
            .map_err(|e| format!("Budget/teams migration failed: {e}"))?;
        }

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS teams (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("Teams table migration failed: {e}"))?;

        Ok(())
    }

    fn migrate_add_reliability_columns(conn: &Connection) -> Result<(), String> {
        let has_col: bool = conn
            .prepare("SELECT consecutive_errors FROM agents LIMIT 0")
            .is_ok();
        if !has_col {
            conn.execute_batch(
                "ALTER TABLE agents ADD COLUMN consecutive_errors INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE agents ADD COLUMN last_error_at TEXT;",
            )
            .map_err(|e| format!("Reliability migration failed: {e}"))?;
        }
        Ok(())
    }

    pub fn get_agents(&self) -> Result<Vec<Agent>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let mut stmt = conn
            .prepare("SELECT id, name, workspace, soul_path, mission, autonomy_level, allowed_tools, status, current_session_id, max_session_duration_secs, created_at, last_heartbeat_at, total_sessions, personality, checkin_interval_secs, consecutive_errors, last_error_at, daily_budget_usd FROM agents ORDER BY created_at DESC")
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
                    consecutive_errors: row.get::<_, i32>(15)? as u32,
                    last_error_at: row.get(16)?,
                    daily_budget_usd: row.get::<_, f64>(17).unwrap_or(0.0),
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
            "SELECT id, name, workspace, soul_path, mission, autonomy_level, allowed_tools, status, current_session_id, max_session_duration_secs, created_at, last_heartbeat_at, total_sessions, personality, checkin_interval_secs, consecutive_errors, last_error_at, daily_budget_usd FROM agents WHERE id = ?1",
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
                    consecutive_errors: row.get::<_, i32>(15)? as u32,
                    last_error_at: row.get(16)?,
                    daily_budget_usd: row.get::<_, f64>(17).unwrap_or(0.0),
                })
            },
        )
        .map_err(|e| format!("Agent not found: {e}"))
    }

    pub fn create_agent(&self, agent: &Agent) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute(
            "INSERT INTO agents (id, name, workspace, soul_path, mission, autonomy_level, allowed_tools, status, current_session_id, max_session_duration_secs, created_at, last_heartbeat_at, total_sessions, personality, checkin_interval_secs, consecutive_errors, last_error_at, daily_budget_usd) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
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
                agent.consecutive_errors as i32,
                agent.last_error_at,
                agent.daily_budget_usd,
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

    pub fn update_autonomy_level(&self, id: &Uuid, level: &AutonomyLevel) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute(
            "UPDATE agents SET autonomy_level = ?1 WHERE id = ?2",
            params![level.to_string(), id.to_string()],
        )
        .map_err(|e| format!("Update error: {e}"))?;
        Ok(())
    }

    pub fn update_checkin_interval(&self, id: &Uuid, interval_secs: u64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute(
            "UPDATE agents SET checkin_interval_secs = ?1 WHERE id = ?2",
            params![interval_secs as i64, id.to_string()],
        )
        .map_err(|e| format!("Update interval error: {e}"))?;
        Ok(())
    }

    pub fn update_last_heartbeat(&self, id: &Uuid, timestamp: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute(
            "UPDATE agents SET last_heartbeat_at = ?1 WHERE id = ?2",
            params![timestamp, id.to_string()],
        )
        .map_err(|e| format!("Update heartbeat error: {e}"))?;
        Ok(())
    }

    pub fn increment_consecutive_errors(&self, id: &Uuid) -> Result<u32, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE agents SET consecutive_errors = consecutive_errors + 1, last_error_at = ?1 WHERE id = ?2",
            params![now, id.to_string()],
        )
        .map_err(|e| format!("Update error: {e}"))?;

        conn.query_row(
            "SELECT consecutive_errors FROM agents WHERE id = ?1",
            params![id.to_string()],
            |row| row.get::<_, i32>(0),
        )
        .map(|v| v as u32)
        .map_err(|e| format!("Query error: {e}"))
    }

    pub fn reset_consecutive_errors(&self, id: &Uuid) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute(
            "UPDATE agents SET consecutive_errors = 0, last_error_at = NULL WHERE id = ?1",
            params![id.to_string()],
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
        self.get_work_sessions_with_limit(agent_id, 50)
    }

    pub fn get_work_sessions_export(&self, agent_id: &Uuid) -> Result<Vec<WorkSessionLog>, String> {
        self.get_work_sessions_with_limit(agent_id, 1000)
    }

    fn get_work_sessions_with_limit(&self, agent_id: &Uuid, limit: u32) -> Result<Vec<WorkSessionLog>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let mut stmt = conn
            .prepare(&format!("SELECT id, agent_id, session_id, started_at, ended_at, turns, trigger, outcome, summary, events_json, input_tokens, output_tokens, cost_usd FROM work_sessions WHERE agent_id = ?1 ORDER BY started_at DESC LIMIT {limit}"))
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
                    input_tokens: row.get::<_, i64>(10)? as u64,
                    output_tokens: row.get::<_, i64>(11)? as u64,
                    cost_usd: row.get(12)?,
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
            "INSERT INTO work_sessions (id, agent_id, session_id, started_at, ended_at, turns, trigger, outcome, summary, events_json, input_tokens, output_tokens, cost_usd) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
                log.input_tokens as i64,
                log.output_tokens as i64,
                log.cost_usd,
            ],
        )
        .map_err(|e| format!("Insert session error: {e}"))?;

        // Increment total_sessions on the agent
        conn.execute(
            "UPDATE agents SET total_sessions = total_sessions + 1 WHERE id = ?1",
            params![log.agent_id.to_string()],
        )
        .map_err(|e| format!("Update sessions count error: {e}"))?;

        // Auto-purge: keep at most 200 sessions per agent
        let _ = conn.execute(
            "DELETE FROM work_sessions WHERE agent_id = ?1 AND id NOT IN (SELECT id FROM work_sessions WHERE agent_id = ?1 ORDER BY started_at DESC LIMIT 200)",
            params![log.agent_id.to_string()],
        );

        Ok(())
    }

    pub fn get_agent_env_vars(&self, agent_id: &Uuid) -> Result<Vec<AgentEnvVar>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let mut stmt = conn
            .prepare("SELECT id, agent_id, key, value, created_at FROM agent_env_vars WHERE agent_id = ?1 ORDER BY key ASC")
            .map_err(|e| format!("Query error: {e}"))?;

        let vars = stmt
            .query_map(params![agent_id.to_string()], |row| {
                let raw_value: String = row.get(3)?;
                let decrypted = crypto::decrypt(&raw_value).unwrap_or(raw_value);
                Ok(AgentEnvVar {
                    id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap_or_default(),
                    agent_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap_or_default(),
                    key: row.get(2)?,
                    value: decrypted,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| format!("Query error: {e}"))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(vars)
    }

    pub fn set_agent_env_var(&self, agent_id: &Uuid, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let id = Uuid::new_v4();
        let now = chrono::Utc::now().to_rfc3339();
        let encrypted = crypto::encrypt(value)?;
        conn.execute(
            "INSERT INTO agent_env_vars (id, agent_id, key, value, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(agent_id, key) DO UPDATE SET value = ?4",
            params![id.to_string(), agent_id.to_string(), key, encrypted, now],
        )
        .map_err(|e| format!("Insert env var error: {e}"))?;
        Ok(())
    }

    pub fn delete_agent_env_var(&self, agent_id: &Uuid, key: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute(
            "DELETE FROM agent_env_vars WHERE agent_id = ?1 AND key = ?2",
            params![agent_id.to_string(), key],
        )
        .map_err(|e| format!("Delete env var error: {e}"))?;
        Ok(())
    }

    pub fn get_agent_env_vars_as_pairs(&self, agent_id: &Uuid) -> Result<Vec<(String, String)>, String> {
        let vars = self.get_agent_env_vars(agent_id)?;
        Ok(vars.into_iter().map(|v| (v.key, v.value)).collect())
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

    pub fn purge_old_sessions(&self, agent_id: &Uuid, keep: usize) -> Result<u64, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM work_sessions WHERE agent_id = ?1",
            params![agent_id.to_string()],
            |row| row.get(0),
        ).map_err(|e| format!("Count error: {e}"))?;

        if count as usize <= keep {
            return Ok(0);
        }

        let deleted = conn.execute(
            "DELETE FROM work_sessions WHERE agent_id = ?1 AND id NOT IN (SELECT id FROM work_sessions WHERE agent_id = ?1 ORDER BY started_at DESC LIMIT ?2)",
            params![agent_id.to_string(), keep as i64],
        ).map_err(|e| format!("Purge error: {e}"))? as u64;

        Ok(deleted)
    }

    pub fn clear_agent_sessions(&self, agent_id: &Uuid) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute(
            "DELETE FROM work_sessions WHERE agent_id = ?1",
            params![agent_id.to_string()],
        ).map_err(|e| format!("Clear sessions error: {e}"))?;
        conn.execute(
            "UPDATE agents SET total_sessions = 0 WHERE id = ?1",
            params![agent_id.to_string()],
        ).map_err(|e| format!("Reset count error: {e}"))?;
        Ok(())
    }

    pub fn get_db_size_bytes(&self) -> Result<u64, String> {
        let data_dir = dirs_data_dir().ok_or("Cannot determine home directory")?;
        let db_path = format!("{}/data.db", data_dir);
        let metadata = std::fs::metadata(&db_path).map_err(|e| format!("Metadata error: {e}"))?;
        Ok(metadata.len())
    }

    pub fn get_daily_spend(&self, agent_id: &Uuid) -> Result<f64, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let spend: f64 = conn.query_row(
            "SELECT COALESCE(SUM(cost_usd), 0.0) FROM work_sessions WHERE agent_id = ?1 AND started_at >= ?2",
            params![agent_id.to_string(), format!("{}T00:00:00", today)],
            |row| row.get(0),
        ).map_err(|e| format!("Spend query error: {e}"))?;
        Ok(spend)
    }

    pub fn get_spend_breakdown(&self, agent_id: &Uuid) -> Result<serde_json::Value, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let now = chrono::Utc::now();
        let today = now.format("%Y-%m-%dT00:00:00").to_string();
        let week_ago = (now - chrono::Duration::days(7)).format("%Y-%m-%dT00:00:00").to_string();
        let month_ago = (now - chrono::Duration::days(30)).format("%Y-%m-%dT00:00:00").to_string();

        let daily: f64 = conn.query_row(
            "SELECT COALESCE(SUM(cost_usd), 0.0) FROM work_sessions WHERE agent_id = ?1 AND started_at >= ?2",
            params![agent_id.to_string(), today],
            |row| row.get(0),
        ).unwrap_or(0.0);

        let weekly: f64 = conn.query_row(
            "SELECT COALESCE(SUM(cost_usd), 0.0) FROM work_sessions WHERE agent_id = ?1 AND started_at >= ?2",
            params![agent_id.to_string(), week_ago],
            |row| row.get(0),
        ).unwrap_or(0.0);

        let monthly: f64 = conn.query_row(
            "SELECT COALESCE(SUM(cost_usd), 0.0) FROM work_sessions WHERE agent_id = ?1 AND started_at >= ?2",
            params![agent_id.to_string(), month_ago],
            |row| row.get(0),
        ).unwrap_or(0.0);

        let total: f64 = conn.query_row(
            "SELECT COALESCE(SUM(cost_usd), 0.0) FROM work_sessions WHERE agent_id = ?1",
            params![agent_id.to_string()],
            |row| row.get(0),
        ).unwrap_or(0.0);

        Ok(serde_json::json!({
            "daily": (daily * 100.0).round() / 100.0,
            "weekly": (weekly * 100.0).round() / 100.0,
            "monthly": (monthly * 100.0).round() / 100.0,
            "total": (total * 100.0).round() / 100.0,
        }))
    }

    pub fn update_daily_budget(&self, id: &Uuid, budget: f64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute(
            "UPDATE agents SET daily_budget_usd = ?1 WHERE id = ?2",
            params![budget, id.to_string()],
        )
        .map_err(|e| format!("Update budget error: {e}"))?;
        Ok(())
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
