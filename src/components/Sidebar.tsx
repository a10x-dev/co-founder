import { Plus, FolderOpen, Settings } from "lucide-react";
import type { Agent, AgentStatus } from "@/types";

interface SidebarProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onNewAgent: () => void;
  onImportAgent: () => void;
  onSettings: () => void;
}

const statusColors: Record<AgentStatus, string> = {
  idle: "var(--status-idle)",
  running: "var(--status-active)",
  paused: "var(--status-paused)",
  error: "var(--status-error)",
};

const statusLabels: Record<AgentStatus, string> = {
  idle: "Idle",
  running: "Running",
  paused: "Paused",
  error: "Error",
};

export default function Sidebar({
  agents,
  selectedAgentId,
  onSelectAgent,
  onNewAgent,
  onImportAgent,
  onSettings,
}: SidebarProps) {
  return (
    <aside
      className="flex flex-col h-full shrink-0 min-h-0 border-r"
      style={{
        width: 260,
        background: "var(--bg-sidebar)",
        borderColor: "var(--border-default)",
      }}
    >
      <div
        className="px-5 pt-5 pb-4 text-[11px] font-semibold tracking-[0.12em] uppercase select-none"
        data-tauri-drag-region
        style={{ color: "var(--text-tertiary)" }}
      >
        Agent Founder
      </div>

      <div className="flex-1 overflow-y-auto px-2 min-h-0">
        {agents.length === 0 && (
          <div
            className="text-[13px] px-3 py-6 text-center select-none"
            style={{ color: "var(--text-tertiary)" }}
          >
            No agents yet
          </div>
        )}
        {agents.map((agent) => {
          const selected = agent.id === selectedAgentId;
          return (
            <button
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              className="w-full text-left rounded-lg px-3 py-2.5 mb-0.5 transition-all duration-100 ease-out cursor-pointer"
              style={{
                background: selected ? "var(--accent-subtle)" : "transparent",
                borderLeft: selected
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
              }}
              onMouseEnter={(e) => {
                if (!selected)
                  e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (!selected)
                  e.currentTarget.style.background = "transparent";
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="block w-2 h-2 rounded-full shrink-0"
                  style={{ background: statusColors[agent.status] }}
                />
                <span
                  className="text-[14px] font-medium truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {agent.name}
                </span>
              </div>
              <div
                className="text-[12px] mt-0.5 ml-4"
                style={{ color: "var(--text-tertiary)" }}
              >
                {statusLabels[agent.status]}
              </div>
            </button>
          );
        })}
      </div>

      <div
        className="px-3 py-3 border-t flex flex-col gap-1"
        style={{ borderColor: "var(--border-default)" }}
      >
        <button
          onClick={onNewAgent}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[14px] font-medium transition-all duration-100 ease-out cursor-pointer"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <Plus size={16} strokeWidth={2} />
          New Agent
        </button>
        <button
          onClick={onImportAgent}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[14px] font-medium transition-all duration-100 ease-out cursor-pointer"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <FolderOpen size={16} strokeWidth={2} />
          Import Project
        </button>
        <button
          onClick={onSettings}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[14px] font-medium transition-all duration-100 ease-out cursor-pointer"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <Settings size={16} strokeWidth={2} />
          Settings
        </button>
      </div>
    </aside>
  );
}
