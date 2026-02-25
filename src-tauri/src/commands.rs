use chrono::Utc;
use uuid::Uuid;

use crate::models::*;
use crate::state_manager::StateManager;
use crate::AppState;

#[tauri::command]
pub async fn get_agents(state: tauri::State<'_, AppState>) -> Result<Vec<Agent>, String> {
    state.db.get_agents()
}

#[tauri::command]
pub async fn get_agent(id: String, state: tauri::State<'_, AppState>) -> Result<Agent, String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.get_agent(&uuid)
}

#[tauri::command]
pub async fn create_agent(
    req: CreateAgentRequest,
    state: tauri::State<'_, AppState>,
) -> Result<Agent, String> {
    let settings = state.db.get_global_settings()?;
    let workspace = StateManager::create_workspace(&settings.default_workspace_root, &req.name)?;

    let agent = Agent {
        id: Uuid::new_v4(),
        name: req.name,
        workspace: workspace.clone(),
        soul_path: format!("{}/.founder/SOUL.md", workspace),
        mission: req.mission,
        autonomy_level: AutonomyLevel::from_str(&req.autonomy_level),
        allowed_tools: String::new(),
        status: AgentStatus::Idle,
        current_session_id: None,
        max_session_duration_secs: 900,
        created_at: Utc::now().to_rfc3339(),
        last_heartbeat_at: None,
        total_sessions: 0,
        personality: req.personality,
        checkin_interval_secs: req.checkin_interval_secs,
    };

    state.db.create_agent(&agent)?;
    Ok(agent)
}

#[tauri::command]
pub async fn update_agent_status(
    id: String,
    status: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    let agent_status = AgentStatus::from_str(&status);
    state.db.update_agent_status(&uuid, &agent_status)
}

#[tauri::command]
pub async fn delete_agent(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.delete_agent(&uuid)
}

#[tauri::command]
pub async fn get_work_sessions(
    agent_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<WorkSessionLog>, String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.get_work_sessions(&uuid)
}

#[tauri::command]
pub async fn get_global_settings(
    state: tauri::State<'_, AppState>,
) -> Result<GlobalSettings, String> {
    state.db.get_global_settings()
}

#[tauri::command]
pub async fn update_global_settings(
    settings: GlobalSettings,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.db.update_global_settings(&settings)
}

#[tauri::command]
pub async fn start_agent(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.update_agent_status(&uuid, &AgentStatus::Running)
}

#[tauri::command]
pub async fn pause_agent(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.update_agent_status(&uuid, &AgentStatus::Paused)
}

#[tauri::command]
pub async fn stop_agent(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|e| format!("Invalid UUID: {e}"))?;
    state.db.update_agent_status(&uuid, &AgentStatus::Idle)
}
