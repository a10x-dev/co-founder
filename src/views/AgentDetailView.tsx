import { useState, useEffect } from "react";
import {
  Pause,
  RotateCcw,
  Settings,
  FilePlus,
  Wrench,
  CheckCircle,
  AlertTriangle,
  Share2,
} from "lucide-react";
import type { Agent, AgentStatus, WorkSessionLog, ActivityEntry } from "@/types";
import {
  getWorkSessions,
  startAgent,
  pauseAgent,
  stopAgent,
} from "@/lib/api";

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; color: string }
> = {
  idle: { label: "Sleeping", color: "var(--status-idle)" },
  running: { label: "Working", color: "var(--status-active)" },
  paused: { label: "Paused", color: "var(--status-paused)" },
  error: { label: "Stopped", color: "var(--status-error)" },
};

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  "file-plus": FilePlus,
  wrench: Wrench,
  "check-circle": CheckCircle,
};

const OUTCOME_CONFIG: Record<
  WorkSessionLog["outcome"],
  { label: string; color: string }
> = {
  completed: { label: "Completed", color: "var(--status-active)" },
  blocked: { label: "Blocked", color: "var(--status-working)" },
  timeout: { label: "Timeout", color: "var(--status-paused)" },
  error: { label: "Error", color: "var(--status-error)" },
};

const MOCK_ACTIVITY: ActivityEntry[] = [
  {
    icon: "file-plus",
    title: "Created a new file",
    description:
      "Set up the payment processing module with Stripe integration.",
    timestamp: "2 minutes ago",
  },
  {
    icon: "wrench",
    title: "Made changes",
    description: "Updated the homepage layout to include pricing section.",
    timestamp: "5 minutes ago",
  },
  {
    icon: "check-circle",
    title: "Completed task",
    description: "Authentication system is now fully working.",
    timestamp: "12 minutes ago",
  },
  {
    icon: "file-plus",
    title: "Added tests",
    description: "Unit tests for the checkout flow.",
    timestamp: "18 minutes ago",
    details: 'describe("checkout", () => { ... })',
  },
];

function formatNextCheckIn(
  lastHeartbeat: string | null,
  intervalSecs: number
): string {
  if (!lastHeartbeat) return "Soon";
  const last = new Date(lastHeartbeat).getTime();
  const next = last + intervalSecs * 1000;
  const now = Date.now();
  const diffMs = next - now;
  if (diffMs <= 0) return "Soon";
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "in <1m";
  return `in ${diffMins}m`;
}

function formatRunningSince(createdAt: string): string {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const diffMs = now - created;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return `${diffDays}d`;
}

function formatSessionDate(isoString: string): string {
  const d = new Date(isoString);
  const day = d.toLocaleDateString("en-US", { weekday: "long" });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${day}, ${time}`;
}

function formatSessionDuration(started: string, ended: string | null): string {
  const end = ended ? new Date(ended).getTime() : Date.now();
  const start = new Date(started).getTime();
  const diffMins = Math.floor((end - start) / 60000);
  return `${diffMins} min`;
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len).trim() + "...";
}

export interface AgentDetailViewProps {
  agent: Agent;
  onRefetch: () => void;
}

const ghostButton =
  "flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ease-out cursor-pointer";

export default function AgentDetailView({ agent, onRefetch }: AgentDetailViewProps) {
  const [sessions, setSessions] = useState<WorkSessionLog[]>([]);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getWorkSessions(agent.id).then(setSessions);
  }, [agent.id]);

  const config = STATUS_CONFIG[agent.status];
  const nextCheckIn = formatNextCheckIn(
    agent.last_heartbeat_at,
    agent.checkin_interval_secs
  );
  const runningFor = formatRunningSince(agent.created_at);

  const handlePause = async () => {
    setBusy(true);
    try {
      await pauseAgent(agent.id);
      onRefetch();
    } finally {
      setBusy(false);
    }
  };

  const handleRestart = async () => {
    setBusy(true);
    try {
      await stopAgent(agent.id);
      await startAgent(agent.id);
      onRefetch();
    } finally {
      setBusy(false);
    }
  };

  const toggleDetails = (id: string) => {
    setExpandedDetails((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canPause = agent.status === "running";
  const canStart = agent.status !== "running";

  return (
    <div
      className="max-w-[860px] mx-auto"
      style={{ paddingLeft: 32, paddingRight: 32, paddingTop: 40 }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h1
            className="text-[28px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {agent.name}
          </h1>
          <p
            className="text-[15px] mt-0.5"
            style={{ color: "var(--text-secondary)" }}
          >
            {agent.mission}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 rounded-full text-[13px] font-medium"
            style={{
              height: 22,
              background: `color-mix(in srgb, ${config.color} 10%, transparent)`,
              color: config.color,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: config.color }}
            />
            {config.label}
          </span>
          {canPause && (
            <button
              onClick={handlePause}
              disabled={busy}
              className={ghostButton}
              style={{
                color: "var(--text-secondary)",
                opacity: busy ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!busy) e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <Pause size={14} strokeWidth={2} />
              Pause
            </button>
          )}
          {canStart && (
            <button
              onClick={handleRestart}
              disabled={busy}
              className={ghostButton}
              style={{
                color: "var(--text-secondary)",
                opacity: busy ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!busy) e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <RotateCcw size={14} strokeWidth={2} />
              Restart
            </button>
          )}
          <button
            className={ghostButton}
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Settings size={14} strokeWidth={2} />
            Settings
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div
        className="flex items-center gap-4 pb-4"
        style={{
          borderBottom: "1px solid var(--border-default)",
          paddingBottom: 16,
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: config.color }}
          />
          <span
            className="text-[14px]"
            style={{ color: "var(--text-primary)" }}
          >
            {config.label}
          </span>
        </div>
        <div
          className="w-px shrink-0"
          style={{
            height: 20,
            background: "var(--border-default)",
          }}
        />
        <div className="flex flex-col">
          <span
            className="text-[14px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            Next check-in
          </span>
          <span
            className="text-[14px]"
            style={{ color: "var(--text-primary)" }}
          >
            {nextCheckIn}
          </span>
        </div>
        <div
          className="w-px shrink-0"
          style={{
            height: 20,
            background: "var(--border-default)",
          }}
        />
        <div className="flex flex-col">
          <span
            className="text-[14px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            Sessions
          </span>
          <span
            className="text-[14px]"
            style={{ color: "var(--text-primary)" }}
          >
            {agent.total_sessions}
          </span>
        </div>
        <div
          className="w-px shrink-0"
          style={{
            height: 20,
            background: "var(--border-default)",
          }}
        />
        <div className="flex flex-col">
          <span
            className="text-[14px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            Running for
          </span>
          <span
            className="text-[14px]"
            style={{ color: "var(--text-primary)" }}
          >
            {runningFor}
          </span>
        </div>
      </div>

      {/* Activity feed */}
      <div style={{ marginTop: 24 }}>
        <h2
          className="text-[17px] font-semibold mb-4"
          style={{ color: "var(--text-primary)" }}
        >
          What's happening
        </h2>

        <div className="flex flex-col gap-3">
          {agent.autonomy_level === "semi" && (
            <div
              className="rounded-xl p-4 border flex gap-3"
              style={{
                background: "var(--bg-surface)",
                borderColor: "var(--border-default)",
                borderLeftWidth: 3,
                borderLeftColor: "var(--status-working)",
              }}
            >
              <AlertTriangle
                size={20}
                className="shrink-0 mt-0.5"
                style={{ color: "var(--status-working)" }}
              />
              <div className="flex-1 min-w-0">
                <p
                  className="text-[15px] font-medium mb-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  Your agent wants to deploy to production
                </p>
                <p
                  className="text-[14px] mb-4"
                  style={{ color: "var(--text-secondary)" }}
                >
                  The checkout flow is ready and your agent wants to make it live
                  for testing.
                </p>
                <div className="flex gap-2">
                  <button
                    className="px-4 rounded-lg font-medium text-[14px] transition-all duration-150 ease-out cursor-pointer"
                    style={{
                      height: 36,
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
                    Approve
                  </button>
                  <button
                    className={`${ghostButton} h-9`}
                    style={{ color: "var(--text-secondary)" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    Not now
                  </button>
                </div>
              </div>
            </div>
          )}

          {MOCK_ACTIVITY.map((entry, i) => {
            const Icon = ICON_MAP[entry.icon] ?? FilePlus;
            const entryId = `activity-${i}`;
            const showDetails = expandedDetails.has(entryId);

            return (
              <div
                key={entryId}
                className="rounded-xl p-4 border flex gap-3"
                style={{
                  background: "var(--bg-surface)",
                  borderColor: "var(--border-default)",
                  borderWidth: 1,
                }}
              >
                <Icon
                  size={20}
                  className="shrink-0 mt-0.5"
                  style={{ color: "var(--text-secondary)" }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p
                        className="text-[15px] font-medium"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {entry.title}
                      </p>
                      <p
                        className="text-[14px] mt-0.5"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {entry.description}
                      </p>
                    </div>
                    <span
                      className="text-[13px] shrink-0"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {entry.timestamp}
                    </span>
                  </div>
                  {entry.details && (
                    <>
                      <button
                        onClick={() => toggleDetails(entryId)}
                        className="text-[13px] mt-2 font-medium transition-all duration-150 ease-out cursor-pointer"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        [Details]
                      </button>
                      {showDetails && (
                        <pre
                          className="mt-2 rounded-lg p-3 text-[13px] font-mono overflow-x-auto"
                          style={{
                            background: "var(--bg-inset)",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {entry.details}
                        </pre>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Past work sessions */}
      <div style={{ marginTop: 32 }}>
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-[17px] font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            Past work sessions
          </h2>
          <button
            className={`${ghostButton}`}
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Share2 size={14} strokeWidth={2} />
            Share journey
          </button>
        </div>

        {sessions.length === 0 ? (
          <p
            className="text-[14px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            No work sessions yet. Your agent will start working at the next
            check-in.
          </p>
        ) : (
          <div
            className="rounded-xl border overflow-hidden"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-default)",
            }}
          >
            {sessions.map((session) => {
              const outcomeConfig = OUTCOME_CONFIG[session.outcome];
              const isExpanded = expandedSessionId === session.id;

              return (
                <div
                  key={session.id}
                  onClick={() =>
                    setExpandedSessionId((id) =>
                      id === session.id ? null : session.id
                    )
                  }
                  className="cursor-pointer transition-all duration-150 ease-out"
                  style={{
                    minHeight: 48,
                    padding: "12px 16px",
                    borderBottom:
                      sessions.indexOf(session) < sessions.length - 1
                        ? "1px solid var(--border-default)"
                        : "none",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--bg-surface)";
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0 flex items-center gap-3">
                      <span
                        className="text-[14px] shrink-0"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {formatSessionDate(session.started_at)}
                      </span>
                      <span
                        className="text-[14px] truncate"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        — {truncate(session.summary || "No summary", 60)}
                      </span>
                      <span
                        className="shrink-0 px-2 py-0.5 rounded text-[12px] font-medium"
                        style={{
                          background: "var(--bg-inset)",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        {formatSessionDuration(
                          session.started_at,
                          session.ended_at
                        )}
                      </span>
                      <span
                        className="shrink-0 px-2 py-0.5 rounded-full text-[12px] font-medium"
                        style={{
                          background: `color-mix(in srgb, ${outcomeConfig.color} 10%, transparent)`,
                          color: outcomeConfig.color,
                        }}
                      >
                        {outcomeConfig.label}
                      </span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div
                      className="mt-3 pt-3"
                      style={{
                        borderTop: "1px solid var(--border-default)",
                      }}
                    >
                      <p
                        className="text-[14px] mb-2"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {session.summary || "No summary"}
                      </p>
                      <p
                        className="text-[13px] mb-2"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {session.turns} turns completed
                      </p>
                      {session.events_json && (
                        <pre
                          className="rounded-lg p-3 text-[13px] font-mono overflow-x-auto"
                          style={{
                            background: "var(--bg-inset)",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {(() => {
                            try {
                              const parsed = JSON.parse(session.events_json);
                              return JSON.stringify(parsed, null, 2);
                            } catch {
                              return session.events_json;
                            }
                          })()}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
