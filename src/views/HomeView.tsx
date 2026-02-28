import { useState } from "react";
import { Plus, Eye, Pause, Play, FolderOpen } from "lucide-react";
import type { Agent, AgentStatus } from "@/types";
import { startAgent, pauseAgent } from "@/lib/api";
import { formatRelativeTime } from "@/lib/formatTime";

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; dotColor: string }
> = {
  idle: { label: "Sleeping", dotColor: "var(--status-idle)" },
  running: { label: "Working", dotColor: "var(--status-active)" },
  paused: { label: "Paused", dotColor: "var(--status-paused)" },
  error: { label: "Stopped", dotColor: "var(--status-error)" },
};

interface HomeViewProps {
  agents: Agent[];
  onSelectAgent: (id: string) => void;
  onNewAgent: () => void;
  onImportAgent: () => void;
  onRefetch: () => void;
}

export default function HomeView({
  agents,
  onSelectAgent,
  onNewAgent,
  onImportAgent,
  onRefetch,
}: HomeViewProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const runningCount = agents.filter((a) => a.status === "running").length;
  const sleepingCount = agents.length - runningCount;

  const handleStart = async (id: string) => {
    setBusyId(id);
    try {
      await startAgent(id);
      onRefetch();
    } finally {
      setBusyId(null);
    }
  };

  const handlePause = async (id: string) => {
    setBusyId(id);
    try {
      await pauseAgent(id);
      onRefetch();
    } finally {
      setBusyId(null);
    }
  };

  const ghostButton =
    "flex items-center gap-1.5 px-3 py-2 rounded-lg text-[14px] font-medium transition-all duration-150 ease-out cursor-pointer";

  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center justify-center" style={{ marginTop: -32 }}>
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
            style={{ background: "var(--bg-inset)" }}
          >
            <Plus size={28} strokeWidth={1.5} style={{ color: "var(--text-tertiary)" }} />
          </div>
          <h2
            className="text-[22px] font-semibold mb-2"
            style={{ color: "var(--text-primary)" }}
          >
            No agents yet
          </h2>
          <p
            className="text-[15px] mb-8 text-center"
            style={{ color: "var(--text-secondary)" }}
          >
            Create your first agent to get started
          </p>
          <div className="flex gap-3">
            <button
              onClick={onNewAgent}
              className="flex items-center gap-2 px-6 h-11 rounded-lg font-medium text-[15px] transition-all duration-150 ease-out cursor-pointer"
              style={{
                background: "var(--accent)",
                color: "white",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--accent-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--accent)";
              }}
            >
              <Plus size={18} strokeWidth={2} />
              Create Agent
            </button>
            <button
              onClick={onImportAgent}
              className="flex items-center gap-2 px-6 h-11 rounded-lg font-medium text-[15px] transition-all duration-150 ease-out cursor-pointer"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-default)",
                color: "var(--text-secondary)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-surface)";
              }}
            >
              <FolderOpen size={18} strokeWidth={2} />
              Import Project
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="max-w-[860px] mx-auto px-8 pt-10"
    >
      <h1
        className="text-[28px] font-semibold mb-1"
        style={{ color: "var(--text-primary)" }}
      >
        Your Agents
      </h1>
      <p
        className="text-[15px] mb-8"
        style={{ color: "var(--text-secondary)" }}
      >
        {runningCount} agents running, {sleepingCount} sleeping
      </p>

      <div className="flex flex-col gap-3">
        {agents.map((agent) => {
          const config = STATUS_CONFIG[agent.status];
          const isBusy = busyId === agent.id;
          const canPause = agent.status === "running";
          const canStart = agent.status !== "running";

          return (
            <div
              key={agent.id}
              className="rounded-xl p-5 border"
              style={{
                background: "var(--bg-surface)",
                borderColor: "var(--border-default)",
                borderWidth: 1,
              }}
            >
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0 mt-0.5"
                    style={{ background: config.dotColor }}
                  />
                  <span
                    className="text-[17px] font-semibold truncate"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {agent.name}
                  </span>
                </div>
                <span
                  className="shrink-0 px-2.5 py-1 rounded-full text-[13px] font-medium"
                  style={{
                    background: "var(--bg-inset)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {config.label}
                </span>
              </div>

              <p
                className="text-[15px] mb-2"
                style={{ color: "var(--text-secondary)" }}
              >
                {agent.mission}
              </p>

              <p
                className="text-[14px] mb-1"
                style={{ color: "var(--text-secondary)" }}
              >
                Currently:{" "}
                {agent.status === "idle"
                  ? "Waiting for next check-in"
                  : "Working on tasks"}
              </p>

              <p
                className="text-[13px] mb-0.5"
                style={{ color: "var(--text-tertiary)" }}
              >
                Last activity: {formatRelativeTime(agent.last_heartbeat_at)}
              </p>

              <p
                className="text-[13px] mb-4"
                style={{ color: "var(--text-tertiary)" }}
              >
                {agent.total_sessions} work sessions completed
              </p>

              <div className="flex items-center justify-between">
                <button
                  onClick={() => onSelectAgent(agent.id)}
                  className={`${ghostButton}`}
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <Eye size={16} strokeWidth={2} />
                  View
                </button>
                <div className="flex gap-2">
                  {canPause && (
                    <button
                      onClick={() => handlePause(agent.id)}
                      disabled={isBusy}
                      className={`${ghostButton}`}
                      style={{
                        color: "var(--text-secondary)",
                        opacity: isBusy ? 0.6 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!isBusy)
                          e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <Pause size={16} strokeWidth={2} />
                      Pause
                    </button>
                  )}
                  {canStart && (
                    <button
                      onClick={() => handleStart(agent.id)}
                      disabled={isBusy}
                      className={`${ghostButton}`}
                      style={{
                        color: "var(--text-secondary)",
                        opacity: isBusy ? 0.6 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!isBusy)
                          e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <Play size={16} strokeWidth={2} />
                      Start
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onNewAgent}
            className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-10 transition-all duration-150 ease-out cursor-pointer"
            style={{
              background: "var(--bg-app)",
              borderColor: "var(--border-default)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.borderColor = "var(--text-tertiary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--bg-app)";
              e.currentTarget.style.borderColor = "var(--border-default)";
            }}
          >
            <Plus size={24} strokeWidth={1.5} className="mb-2" style={{ color: "var(--text-tertiary)" }} />
            <span className="text-[14px] font-medium" style={{ color: "var(--text-secondary)" }}>
              New agent
            </span>
          </button>
          <button
            onClick={onImportAgent}
            className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-10 transition-all duration-150 ease-out cursor-pointer"
            style={{
              background: "var(--bg-app)",
              borderColor: "var(--border-default)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.borderColor = "var(--text-tertiary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--bg-app)";
              e.currentTarget.style.borderColor = "var(--border-default)";
            }}
          >
            <FolderOpen size={24} strokeWidth={1.5} className="mb-2" style={{ color: "var(--text-tertiary)" }} />
            <span className="text-[14px] font-medium" style={{ color: "var(--text-secondary)" }}>
              Import project
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
