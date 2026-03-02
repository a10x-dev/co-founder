export type AgentStatus = "idle" | "running" | "paused" | "error";
export type AutonomyLevel = "semi" | "yolo";
export type SessionTrigger = "heartbeat" | "manual" | "continued";
export type SessionOutcome = "completed" | "blocked" | "timeout" | "error" | "rate_limited";

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
  consecutive_errors: number;
  last_error_at: string | null;
  daily_budget_usd: number;
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
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
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

export interface AgentEnvVar {
  id: string;
  agent_id: string;
  key: string;
  value: string;
  created_at: string;
}

export interface WorkspaceHealth {
  healthy: boolean;
  missing_files: string[];
  workspace_exists: boolean;
  founder_exists: boolean;
}

export interface Artifact {
  id: string;
  title: string;
  type: "metric" | "table" | "checklist" | "markdown" | "chart" | "log";
  description?: string;
  data: unknown;
  updated_at: string;
}

export interface ToolManifestEntry {
  name: string;
  description: string;
  language: string;
  path: string;
  use_count: number;
  created_at: string;
  approved: boolean;
}

export interface GitStatus {
  is_repo: boolean;
  branch?: string;
  head?: string;
  changes?: { status: string; file: string }[];
  changed_files?: number;
}

export interface TaskColumn {
  column: string;
  tasks: string[];
}

export interface TaskBoard {
  columns: TaskColumn[];
}

export interface SpendBreakdown {
  daily: number;
  weekly: number;
  monthly: number;
  total: number;
}

export type ScheduleEntrySource = "user" | "cofounder";
export type ScheduleRecurrence = "once" | "daily" | "weekdays" | "weekly";

export interface ScheduleEntry {
  id: string;
  time: string; // HH:mm
  action: string;
  recurrence: ScheduleRecurrence;
  source: ScheduleEntrySource;
  enabled: boolean;
  last_run?: string;
  day_of_week?: number; // 0=Sun for "weekly"
}

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpJson {
  mcpServers: Record<string, McpServerConfig>;
}
