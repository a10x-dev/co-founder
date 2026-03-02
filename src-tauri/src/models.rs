use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::fmt;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Idle,
    Running,
    Paused,
    Error,
}

impl fmt::Display for AgentStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AgentStatus::Idle => write!(f, "idle"),
            AgentStatus::Running => write!(f, "running"),
            AgentStatus::Paused => write!(f, "paused"),
            AgentStatus::Error => write!(f, "error"),
        }
    }
}

impl AgentStatus {
    pub fn from_str(s: &str) -> Self {
        match s {
            "running" => AgentStatus::Running,
            "paused" => AgentStatus::Paused,
            "error" => AgentStatus::Error,
            _ => AgentStatus::Idle,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AutonomyLevel {
    Semi,
    Yolo,
}

impl fmt::Display for AutonomyLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AutonomyLevel::Semi => write!(f, "semi"),
            AutonomyLevel::Yolo => write!(f, "yolo"),
        }
    }
}

impl AutonomyLevel {
    pub fn from_str(s: &str) -> Self {
        match s {
            "yolo" => AutonomyLevel::Yolo,
            _ => AutonomyLevel::Semi,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionTrigger {
    Heartbeat,
    Manual,
    Continued,
}

impl fmt::Display for SessionTrigger {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SessionTrigger::Heartbeat => write!(f, "heartbeat"),
            SessionTrigger::Manual => write!(f, "manual"),
            SessionTrigger::Continued => write!(f, "continued"),
        }
    }
}

impl SessionTrigger {
    pub fn from_str(s: &str) -> Self {
        match s {
            "manual" => SessionTrigger::Manual,
            "continued" => SessionTrigger::Continued,
            _ => SessionTrigger::Heartbeat,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionOutcome {
    Completed,
    Blocked,
    Timeout,
    Error,
    RateLimited,
    Interrupted,
}

impl fmt::Display for SessionOutcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SessionOutcome::Completed => write!(f, "completed"),
            SessionOutcome::Blocked => write!(f, "blocked"),
            SessionOutcome::Timeout => write!(f, "timeout"),
            SessionOutcome::Error => write!(f, "error"),
            SessionOutcome::RateLimited => write!(f, "rate_limited"),
            SessionOutcome::Interrupted => write!(f, "interrupted"),
        }
    }
}

impl SessionOutcome {
    pub fn from_str(s: &str) -> Self {
        match s {
            "blocked" => SessionOutcome::Blocked,
            "timeout" => SessionOutcome::Timeout,
            "error" => SessionOutcome::Error,
            "rate_limited" => SessionOutcome::RateLimited,
            "interrupted" => SessionOutcome::Interrupted,
            _ => SessionOutcome::Completed,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WorkSessionMode {
    Autonomous,
    Live,
}

impl fmt::Display for WorkSessionMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WorkSessionMode::Autonomous => write!(f, "autonomous"),
            WorkSessionMode::Live => write!(f, "live"),
        }
    }
}

impl WorkSessionMode {
    pub fn from_str(s: &str) -> Self {
        match s {
            "live" => WorkSessionMode::Live,
            _ => WorkSessionMode::Autonomous,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Agent {
    pub id: Uuid,
    pub name: String,
    pub workspace: String,
    pub soul_path: String,
    pub mission: String,
    pub autonomy_level: AutonomyLevel,
    pub allowed_tools: String,
    pub status: AgentStatus,
    pub current_session_id: Option<String>,
    pub max_session_duration_secs: u64,
    pub created_at: String,
    pub last_heartbeat_at: Option<String>,
    pub total_sessions: u32,
    pub personality: String,
    pub checkin_interval_secs: u64,
    pub consecutive_errors: u32,
    pub last_error_at: Option<String>,
    pub daily_budget_usd: f64,
}

pub const MAX_CONSECUTIVE_ERRORS: u32 = 5;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentEnvVar {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub key: String,
    pub value: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkSessionLog {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub session_id: String,
    pub mode: WorkSessionMode,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub turns: u32,
    pub trigger: SessionTrigger,
    pub outcome: SessionOutcome,
    pub summary: String,
    pub events_json: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GlobalSettings {
    pub max_concurrent_agents: u8,
    pub default_workspace_root: String,
    pub claude_cli_path: String,
    pub minimize_to_tray: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateAgentRequest {
    pub name: String,
    pub mission: String,
    pub personality: String,
    pub checkin_interval_secs: u64,
    pub autonomy_level: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ImportAgentRequest {
    pub workspace_path: String,
    pub name: String,
    pub mission: String,
    pub personality: String,
    pub checkin_interval_secs: u64,
    pub autonomy_level: String,
}
