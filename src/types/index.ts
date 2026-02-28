export type AgentStatus = "idle" | "running" | "paused" | "error";
export type AutonomyLevel = "semi" | "yolo";
export type SessionTrigger = "heartbeat" | "manual" | "continued";
export type SessionOutcome = "completed" | "blocked" | "timeout" | "error";

export interface Agent {
  id: string;
  name: string;
  workspace: string;
  soul_path: string;
  mission: string;
  autonomy_level: AutonomyLevel;
  allowed_tools: string;
  status: AgentStatus;
  current_session_id: string | null;
  max_session_duration_secs: number;
  created_at: string;
  last_heartbeat_at: string | null;
  total_sessions: number;
  personality: string;
  checkin_interval_secs: number;
}

export interface CreateAgentRequest {
  name: string;
  mission: string;
  personality: string;
  checkin_interval_secs: number;
  autonomy_level: string;
}

export interface ImportAgentRequest {
  workspace_path: string;
  name: string;
  mission: string;
  personality: string;
  checkin_interval_secs: number;
  autonomy_level: string;
}

export interface WorkSessionLog {
  id: string;
  agent_id: string;
  session_id: string;
  started_at: string;
  ended_at: string | null;
  turns: number;
  trigger: SessionTrigger;
  outcome: SessionOutcome;
  summary: string;
  events_json: string;
}

export interface GlobalSettings {
  max_concurrent_agents: number;
  default_workspace_root: string;
  claude_cli_path: string;
  minimize_to_tray: boolean;
}

export interface ActivityEntry {
  icon: string;
  title: string;
  description: string;
  timestamp: string;
  details?: string;
}
