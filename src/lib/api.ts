import { invoke } from "@tauri-apps/api/core";
import type { Agent, AgentEnvVar, CreateAgentRequest, ImportAgentRequest, WorkSessionLog, GlobalSettings, WorkspaceHealth, Artifact, ToolManifestEntry } from "@/types";

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
