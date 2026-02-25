import { invoke } from "@tauri-apps/api/core";
import type { Agent, CreateAgentRequest, WorkSessionLog, GlobalSettings } from "@/types";

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

export async function deleteAgent(id: string): Promise<void> {
  return invoke("delete_agent", { id });
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
