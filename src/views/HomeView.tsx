import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Plus, Eye, Pause, Play, FolderOpen, AlertTriangle, RefreshCw, Zap, PauseCircle, PlayCircle } from "lucide-react";
import type { Agent, AgentStatus, WorkSessionLog } from "@/types";
import { startAgent, pauseAgent, getWorkSessions } from "@/lib/api";
import { formatRelativeTime } from "@/lib/formatTime";

function healthColor(agent: Agent): string {
  if (agent.consecutive_errors >= 5) return "var(--status-error)";
  if (agent.consecutive_errors > 0) return "var(--status-paused)";
  if (agent.status === "error") return "var(--status-error)";
  if (agent.status === "running") return "var(--status-active)";
  if (agent.status === "paused") return "var(--status-paused)";
  return "var(--status-idle)";
}

function healthLabel(agent: Agent): string {
  if (agent.consecutive_errors >= 5) return "Failed";
  if (agent.consecutive_errors > 0) return `Recovering (${agent.consecutive_errors}/5)`;
  if (agent.status === "error") return "Error";
  if (agent.status === "running") return "Working";
  if (agent.status === "paused") return "Paused";
  return "Idle";
}

const OUTCOME_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  completed: { label: "Completed", bg: "color-mix(in srgb, var(--status-active) 12%, transparent)", color: "var(--status-active)" },
  blocked: { label: "Blocked", bg: "color-mix(in srgb, var(--status-working) 12%, transparent)", color: "var(--status-working)" },
  timeout: { label: "Timeout", bg: "color-mix(in srgb, var(--status-paused) 12%, transparent)", color: "var(--status-paused)" },
  error: { label: "Error", bg: "color-mix(in srgb, var(--status-error) 12%, transparent)", color: "var(--status-error)" },
  rate_limited: { label: "Rate Limited", bg: "color-mix(in srgb, var(--status-paused) 12%, transparent)", color: "var(--status-paused)" },
  interrupted: { label: "Interrupted", bg: "color-mix(in srgb, var(--status-error) 12%, transparent)", color: "var(--status-error)" },
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
  const [lastSessions, setLastSessions] = useState<Record<string, WorkSessionLog | null>>({});

  const runningCount = agents.filter((a) => a.status === "running").length;
  const errorCount = agents.filter((a) => a.consecutive_errors > 0).length;
  const totalSessions = agents.reduce((acc, a) => acc + a.total_sessions, 0);

  useEffect(() => {
    for (const agent of agents) {
      if (!lastSessions[agent.id] && agent.total_sessions > 0) {
        getWorkSessions(agent.id).then((sessions) => {
          if (sessions.length > 0) {
            setLastSessions((prev) => ({ ...prev, [agent.id]: sessions[0] }));
          }
        }).catch(() => {});
      }
    }
  }, [agents]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    listen<WorkSessionLog>("session-completed", (event) => {
      if (!active) return;
      const p = event.payload;
      if (p?.agent_id) {
        setLastSessions((prev) => ({ ...prev, [p.agent_id]: p }));
      }
    }).then((fn) => { if (active) unlisten = fn; }).catch(() => {});

    return () => { active = false; if (unlisten) unlisten(); };
  }, []);

  const handleStart = async (id: string) => {
    setBusyId(id);
    try { await startAgent(id); onRefetch(); } finally { setBusyId(null); }
  };

  const handlePause = async (id: string) => {
    setBusyId(id);
    try { await pauseAgent(id); onRefetch(); } finally { setBusyId(null); }
  };

  const handlePauseAll = async () => {
    for (const a of agents.filter((a) => a.status === "running")) {
      try { await pauseAgent(a.id); } catch {}
    }
    onRefetch();
  };

  const handleStartAll = async () => {
    for (const a of agents.filter((a) => a.status !== "running")) {
      try { await startAgent(a.id); } catch {}
    }
    onRefetch();
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
          <h2 className="text-[22px] font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
            No co-founders yet
          </h2>
          <p className="text-[15px] mb-8 text-center" style={{ color: "var(--text-secondary)" }}>
            Create your first co-founder to get started
          </p>
          <div className="flex gap-3">
            <button
              onClick={onNewAgent}
              className="flex items-center gap-2 px-6 h-11 rounded-lg font-medium text-[15px] transition-all duration-150 ease-out cursor-pointer"
              style={{ background: "var(--accent)", color: "white" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent)"; }}
            >
              <Plus size={18} strokeWidth={2} />
              Create Co-Founder
            </button>
            <button
              onClick={onImportAgent}
              className="flex items-center gap-2 px-6 h-11 rounded-lg font-medium text-[15px] transition-all duration-150 ease-out cursor-pointer"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)", color: "var(--text-secondary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; }}
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
    <div className="max-w-[860px] mx-auto px-8 pt-10">
      <div className="flex items-start justify-between mb-1">
        <h1 className="text-[28px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Command Center
        </h1>
        <div className="flex gap-2 shrink-0">
          {runningCount > 0 && (
            <button onClick={handlePauseAll} className={ghostButton} style={{ color: "var(--text-secondary)" }}>
              <PauseCircle size={16} strokeWidth={2} />
              Pause All
            </button>
          )}
          {agents.length > runningCount && (
            <button onClick={handleStartAll} className={ghostButton} style={{ color: "var(--text-secondary)" }}>
              <PlayCircle size={16} strokeWidth={2} />
              Start All
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-6 mb-8">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: "var(--status-active)" }} />
          <span className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
            {runningCount} running
          </span>
        </div>
        {errorCount > 0 && (
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} style={{ color: "var(--status-error)" }} />
            <span className="text-[14px]" style={{ color: "var(--status-error)" }}>
              {errorCount} need attention
            </span>
          </div>
        )}
        <span className="text-[14px]" style={{ color: "var(--text-tertiary)" }}>
          {totalSessions} total sessions
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {agents.map((agent) => {
          const color = healthColor(agent);
          const label = healthLabel(agent);
          const isBusy = busyId === agent.id;
          const canPause = agent.status === "running";
          const canStart = agent.status !== "running";
          const lastSession = lastSessions[agent.id];
          const outcomeBadge = lastSession ? OUTCOME_BADGE[lastSession.outcome] : null;

          return (
            <div
              key={agent.id}
              className="rounded-xl p-5 border cursor-pointer transition-all duration-150"
              style={{
                background: "var(--bg-surface)",
                borderColor: agent.consecutive_errors > 0
                  ? (agent.consecutive_errors >= 5 ? "var(--status-error)" : "var(--status-paused)")
                  : "var(--border-default)",
                borderWidth: 1,
                borderLeftWidth: agent.consecutive_errors > 0 ? 3 : 1,
              }}
              onClick={() => onSelectAgent(agent.id)}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; }}
            >
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[17px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {agent.name}
                  </span>
                  {agent.consecutive_errors > 0 && agent.consecutive_errors < 5 && (
                    <RefreshCw size={14} className="shrink-0 animate-spin" style={{ color: "var(--status-paused)", animationDuration: "3s" }} />
                  )}
                  {agent.consecutive_errors >= 5 && (
                    <AlertTriangle size={14} className="shrink-0" style={{ color: "var(--status-error)" }} />
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {outcomeBadge && (
                    <span
                      className="px-2 py-0.5 rounded-full text-[12px] font-medium"
                      style={{ background: outcomeBadge.bg, color: outcomeBadge.color }}
                    >
                      {outcomeBadge.label}
                    </span>
                  )}
                  <span
                    className="px-2.5 py-1 rounded-full text-[13px] font-medium"
                    style={{
                      background: `color-mix(in srgb, ${color} 10%, transparent)`,
                      color,
                    }}
                  >
                    {label}
                  </span>
                </div>
              </div>

              <p className="text-[15px] mb-2 line-clamp-1" style={{ color: "var(--text-secondary)" }}>
                {agent.mission}
              </p>

              <div className="flex items-center gap-4 text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                <span>Last: {formatRelativeTime(agent.last_heartbeat_at)}</span>
                <span>{agent.total_sessions} sessions</span>
                {lastSession?.summary && lastSession.summary !== "Nothing to do" && (
                  <span className="truncate max-w-[280px]">{lastSession.summary}</span>
                )}
              </div>

              <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: "1px solid var(--border-default)" }}>
                <button
                  onClick={(e) => { e.stopPropagation(); onSelectAgent(agent.id); }}
                  className={`${ghostButton}`}
                  style={{ color: "var(--text-secondary)" }}
                >
                  <Eye size={16} strokeWidth={2} />
                  View
                </button>
                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                  {canPause && (
                    <button
                      onClick={() => handlePause(agent.id)}
                      disabled={isBusy}
                      className={ghostButton}
                      style={{ color: "var(--text-secondary)", opacity: isBusy ? 0.6 : 1 }}
                    >
                      <Pause size={16} strokeWidth={2} />
                      Pause
                    </button>
                  )}
                  {canStart && (
                    <button
                      onClick={() => handleStart(agent.id)}
                      disabled={isBusy}
                      className={ghostButton}
                      style={{ color: "var(--text-secondary)", opacity: isBusy ? 0.6 : 1 }}
                    >
                      <Zap size={16} strokeWidth={2} />
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
            style={{ background: "var(--bg-app)", borderColor: "var(--border-default)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.borderColor = "var(--text-tertiary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-app)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
          >
            <Plus size={24} strokeWidth={1.5} className="mb-2" style={{ color: "var(--text-tertiary)" }} />
            <span className="text-[14px] font-medium" style={{ color: "var(--text-secondary)" }}>
              New co-founder
            </span>
          </button>
          <button
            onClick={onImportAgent}
            className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-10 transition-all duration-150 ease-out cursor-pointer"
            style={{ background: "var(--bg-app)", borderColor: "var(--border-default)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.borderColor = "var(--text-tertiary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-app)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
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
