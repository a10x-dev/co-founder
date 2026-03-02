import { invoke } from "@tauri-apps/api/core";
import type { Agent, AgentEnvVar, CreateAgentRequest, ImportAgentRequest, WorkSessionLog, GlobalSettings, WorkspaceHealth, Artifact, ToolManifestEntry, McpJson, GitStatus, TaskBoard, SpendBreakdown, ScheduleEntry } from "@/types";

export async function getAgents(): Promise<Agent[]> {
  return invoke("get_agents");
}

export async function getAgent(id: string): Promise<Agent> {
  return invoke("get_agent", { id });
}

export async function createAgent(req: CreateAgentRequest): Promise<Agent> {
  return invoke("create_agent", { req });
}

export async function updateAgentStatus(id: string, status: string): Promise<void> {
  return invoke("update_agent_status", { id, status });
}

export async function deleteAgent(id: string, removeFounderFiles = false): Promise<void> {
  return invoke("delete_agent", { id, remove_founder_files: removeFounderFiles });
}

export async function getWorkSessions(agentId: string): Promise<WorkSessionLog[]> {
  return invoke("get_work_sessions", { agentId });
}

export async function getGlobalSettings(): Promise<GlobalSettings> {
  return invoke("get_global_settings");
}

export async function updateGlobalSettings(settings: GlobalSettings): Promise<void> {
  return invoke("update_global_settings", { settings });
}

export async function startAgent(id: string): Promise<void> {
  return invoke("start_agent", { id });
}

export async function pauseAgent(id: string): Promise<void> {
  return invoke("pause_agent", { id });
}

export async function stopAgent(id: string): Promise<void> {
  return invoke("stop_agent", { id });
}

export async function importAgent(req: ImportAgentRequest): Promise<Agent> {
  return invoke("import_agent", { req });
}

export async function readTextFile(path: string): Promise<string> {
  return invoke("read_text_file", { path });
}

export async function detectClaudeCli(): Promise<string | null> {
  return invoke("detect_claude_cli");
}

export async function getAgentEnvVars(agentId: string): Promise<AgentEnvVar[]> {
  return invoke("get_agent_env_vars", { agentId });
}

export async function setAgentEnvVar(agentId: string, key: string, value: string): Promise<void> {
  return invoke("set_agent_env_var", { agentId, key, value });
}

export async function deleteAgentEnvVar(agentId: string, key: string): Promise<void> {
  return invoke("delete_agent_env_var", { agentId, key });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  return invoke("write_text_file", { path, content });
}

export async function triggerManualSession(id: string): Promise<void> {
  return invoke("trigger_manual_session", { id });
}

export async function sendMessageToAgent(agentId: string, message: string): Promise<void> {
  return invoke("send_message_to_agent", { agentId, message });
}

export async function updateAutonomyLevel(id: string, level: string): Promise<void> {
  return invoke("update_autonomy_level", { id, level });
}

export async function checkWorkspaceHealth(agentId: string): Promise<WorkspaceHealth> {
  return invoke("check_workspace_health", { agentId });
}

export async function repairWorkspace(agentId: string): Promise<string[]> {
  return invoke("repair_workspace", { agentId });
}

export async function readArtifactsManifest(agentId: string): Promise<Artifact[]> {
  return invoke<string>("read_artifacts_manifest", { agentId }).then((raw) => {
    try { return JSON.parse(raw) as Artifact[]; } catch { return []; }
  });
}

export async function readToolsManifest(agentId: string): Promise<ToolManifestEntry[]> {
  return invoke<string>("read_tools_manifest", { agentId }).then((raw) => {
    try { return JSON.parse(raw) as ToolManifestEntry[]; } catch { return []; }
  });
}

export async function getIntegrations(agentId: string): Promise<McpJson> {
  return invoke<string>("get_integrations", { agentId }).then((raw) => {
    try { return JSON.parse(raw) as McpJson; } catch { return { mcpServers: {} }; }
  });
}

export async function saveIntegration(agentId: string, serverKey: string, command: string, args: string[], env: Record<string, string>): Promise<void> {
  return invoke("save_integration", { agentId, serverKey, command, args, env });
}

export async function removeIntegration(agentId: string, serverKey: string): Promise<void> {
  return invoke("remove_integration", { agentId, serverKey });
}

export async function clearAgentSessions(id: string): Promise<void> {
  return invoke("clear_agent_sessions", { id });
}

export async function cloneAgent(id: string, newName: string): Promise<Agent> {
  return invoke("clone_agent", { id, newName });
}

export async function generateDailyReport(agentId: string): Promise<string> {
  return invoke("generate_daily_report", { agentId });
}

export interface DailyReport {
  date: string;
  content: string;
}

export async function getDailyReports(agentId: string): Promise<DailyReport[]> {
  return invoke("get_daily_reports", { agentId });
}

export async function getDbSize(): Promise<number> {
  return invoke("get_db_size");
}

export async function getClaudeVersion(): Promise<string> {
  return invoke("get_claude_version_cmd");
}

export async function updateDailyBudget(id: string, budget: number): Promise<void> {
  return invoke("update_daily_budget", { id, budget });
}

export async function getSpendBreakdown(agentId: string): Promise<SpendBreakdown> {
  return invoke("get_spend_breakdown", { agentId });
}

export async function gitCreateBranch(agentId: string): Promise<string> {
  return invoke("git_create_branch", { agentId });
}

export async function gitGetStatus(agentId: string): Promise<GitStatus> {
  return invoke("git_get_status", { agentId });
}

export async function gitGetDiff(agentId: string): Promise<string> {
  return invoke("git_get_diff", { agentId });
}

export async function gitRollback(agentId: string, commitHash: string): Promise<void> {
  return invoke("git_rollback", { agentId, commitHash });
}

export async function gitUndoLastSession(agentId: string): Promise<string> {
  return invoke("git_undo_last_session", { agentId });
}

export async function getTaskBoard(agentId: string): Promise<TaskBoard> {
  return invoke("get_task_board", { agentId });
}

export async function moveTask(agentId: string, task: string, fromColumn: string, toColumn: string): Promise<void> {
  return invoke("move_task", { agentId, task, fromColumn, toColumn });
}

export async function getSchedule(agentId: string): Promise<ScheduleEntry[]> {
  return invoke("get_schedule", { agentId });
}

export async function saveScheduleEntry(agentId: string, entry: ScheduleEntry): Promise<void> {
  return invoke("save_schedule_entry", { agentId, entry });
}

export async function deleteScheduleEntry(agentId: string, entryId: string): Promise<void> {
  return invoke("delete_schedule_entry", { agentId, entryId });
}

export async function toggleScheduleEntry(agentId: string, entryId: string, enabled: boolean): Promise<void> {
  return invoke("toggle_schedule_entry", { agentId, entryId, enabled });
}
