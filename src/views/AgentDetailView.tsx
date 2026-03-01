import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  Pause,
  Play,
  RotateCcw,
  FilePlus,
  Wrench,
  CheckCircle,
  Share2,
  Terminal,
  Search,
  MessageCircle,
  AlertTriangle,
  Trash2,
  ShieldAlert,
  RefreshCw,
} from "lucide-react";
import type { Agent, AgentStatus, WorkSessionLog, ActivityEntry } from "@/types";
import {
  deleteAgent,
  getWorkSessions,
  startAgent,
  pauseAgent,
  stopAgent,
  getAgentEnvVars,
  setAgentEnvVar,
  deleteAgentEnvVar,
  readTextFile,
  writeTextFile,
  triggerManualSession,
  sendMessageToAgent,
} from "@/lib/api";
import type { AgentEnvVar } from "@/types";
import { formatRelativeTime } from "@/lib/formatTime";

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; color: string }
> = {
  idle: { label: "Sleeping", color: "var(--status-idle)" },
  running: { label: "Working", color: "var(--status-active)" },
  paused: { label: "Paused", color: "var(--status-paused)" },
  error: { label: "Stopped", color: "var(--status-error)" },
};

const ICON_MAP: Record<
  string,
  React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
> = {
  "file-plus": FilePlus,
  "file-search": Search,
  terminal: Terminal,
  "message-circle": MessageCircle,
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
  rate_limited: { label: "Rate Limited", color: "var(--status-paused)" },
};

interface StoredEvent {
  type?: string;
  raw?: string;
}

function formatNextCheckIn(
  lastHeartbeat: string | null,
  intervalSecs: number,
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

function parseActivityEntries(session: WorkSessionLog | undefined): ActivityEntry[] {
  if (!session?.events_json) return [];

  let parsedEvents: StoredEvent[] = [];
  try {
    parsedEvents = JSON.parse(session.events_json) as StoredEvent[];
  } catch {
    return [];
  }

  return parsedEvents
    .slice(-20)
    .reverse()
    .map((event, i) => buildActivityEntry(event, session, i))
    .filter((entry): entry is ActivityEntry => entry !== null);
}

function buildActivityEntry(
  event: StoredEvent,
  session: WorkSessionLog,
  index: number,
): ActivityEntry | null {
  if (!event.raw) return null;

  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(event.raw) as Record<string, unknown>;
  } catch {
    return {
      icon: "wrench",
      title: "Event",
      description: truncate(event.raw, 180),
      timestamp: formatRelativeTime(session.started_at),
      details: event.raw,
    };
  }

  const eventType = (event.type || raw.type || "unknown") as string;

  if (eventType === "tool_call") {
    const toolName = (raw.tool as string | undefined) ?? "unknown";
    const input = (raw.input as Record<string, unknown> | undefined) ?? {};

    if (toolName.includes("write") || toolName === "writeToolCall") {
      const path = (input.path as string | undefined) ?? "unknown file";
      return {
        icon: "file-plus",
        title: "Created or edited a file",
        description: path,
        timestamp: formatRelativeTime(session.started_at),
        details: event.raw,
      };
    }

    if (toolName.includes("read") || toolName === "readToolCall") {
      const path = (input.path as string | undefined) ?? "unknown file";
      return {
        icon: "file-search",
        title: "Reviewed a file",
        description: path,
        timestamp: formatRelativeTime(session.started_at),
        details: event.raw,
      };
    }

    if (toolName.includes("bash") || toolName === "bashToolCall") {
      const command = (input.command as string | undefined) ?? "unknown command";
      return {
        icon: "terminal",
        title: "Ran a command",
        description: truncate(command, 120),
        timestamp: formatRelativeTime(session.started_at),
        details: event.raw,
      };
    }

    return {
      icon: "wrench",
      title: `Used tool: ${toolName}`,
      description: "",
      timestamp: formatRelativeTime(session.started_at),
      details: event.raw,
    };
  }

  if (eventType === "assistant") {
    const content = (raw.content as string | undefined) ?? "";
    return {
      icon: "message-circle",
      title: "Assistant output",
      description: truncate(content, 180),
      timestamp: formatRelativeTime(session.started_at),
      details: index < 3 ? content : undefined,
    };
  }

  if (eventType === "result") {
    const result = (raw.result as string | undefined) ?? "Session ended";
    return {
      icon: "check-circle",
      title: "Session result",
      description: truncate(result, 180),
      timestamp: formatRelativeTime(session.started_at),
      details: index < 3 ? result : undefined,
    };
  }

  return null;
}

export interface AgentDetailViewProps {
  agent: Agent;
  onRefetch: () => void;
  onShareJourney: (agent: Agent, sessions: WorkSessionLog[]) => void;
  onDeleted: () => void;
}

const ghostButton =
  "flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ease-out cursor-pointer";

export default function AgentDetailView({
  agent,
  onRefetch,
  onShareJourney,
  onDeleted,
}: AgentDetailViewProps) {
  const [sessions, setSessions] = useState<WorkSessionLog[]>([]);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removeFounderFiles, setRemoveFounderFiles] = useState(false);
  const [liveOutput, setLiveOutput] = useState<Array<{ type: string; message: string; timestamp: number }>>([]);
  const [showLive, setShowLive] = useState(true);
  const liveEndRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<"activity" | "secrets" | "files" | "messages">("activity");

  const [envVars, setEnvVars] = useState<AgentEnvVar[]>([]);
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const [soulContent, setSoulContent] = useState("");
  const [missionContent, setMissionContent] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [fileSaving, setFileSaving] = useState(false);

  const [messageText, setMessageText] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [inboxContent, setInboxContent] = useState("");

  useEffect(() => {
    getWorkSessions(agent.id).then(setSessions).catch(() => {
      setSessions([]);
    });
    getAgentEnvVars(agent.id).then(setEnvVars).catch(() => {});
    readTextFile(`${agent.workspace}/.founder/SOUL.md`).then(setSoulContent).catch(() => {});
    readTextFile(`${agent.workspace}/.founder/MISSION.md`).then(setMissionContent).catch(() => {});
    readTextFile(`${agent.workspace}/.founder/MEMORY.md`).then(setMemoryContent).catch(() => {});
    readTextFile(`${agent.workspace}/.founder/INBOX.md`).then(setInboxContent).catch(() => {});
  }, [agent.id, agent.workspace]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    listen<WorkSessionLog>("session-completed", (event) => {
      if (!active) return;
      if (event.payload?.agent_id !== agent.id) return;
      getWorkSessions(agent.id).then(setSessions).catch(() => {});
    }).then((fn) => {
      if (active) unlisten = fn;
    }).catch(() => {});

    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [agent.id]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    listen<{ agent_id: string; type: string; raw?: string; message?: string; attempt?: number; delay_secs?: number; error?: string }>(
      "agent-output",
      (event) => {
        if (!active) return;
        if (event.payload?.agent_id !== agent.id) return;
        const p = event.payload;

        let message = "";
        if (p.type === "session_start") {
          message = p.message || "Starting session...";
        } else if (p.type === "retry") {
          message = `Retrying (${p.attempt}/${3})... waiting ${p.delay_secs}s`;
        } else if (p.type === "assistant") {
          try {
            const raw = JSON.parse(p.raw || "{}");
            message = (raw.content as string)?.slice(0, 200) || "Thinking...";
          } catch {
            message = "Thinking...";
          }
        } else if (p.type === "tool_call") {
          try {
            const raw = JSON.parse(p.raw || "{}");
            const tool = (raw.tool as string) || "tool";
            const input = raw.input as Record<string, unknown> | undefined;
            if (tool.includes("write")) {
              message = `Writing ${(input?.path as string) || "file"}...`;
            } else if (tool.includes("read")) {
              message = `Reading ${(input?.path as string) || "file"}...`;
            } else if (tool.includes("bash")) {
              message = `Running: ${((input?.command as string) || "command").slice(0, 100)}`;
            } else {
              message = `Using tool: ${tool}`;
            }
          } catch {
            message = "Using a tool...";
          }
        } else if (p.type === "result") {
          message = "Session turn complete.";
        } else {
          return;
        }

        setLiveOutput((prev) => {
          const next = [...prev, { type: p.type, message, timestamp: Date.now() }];
          return next.slice(-50);
        });
      },
    )
      .then((fn) => {
        if (active) unlisten = fn;
      })
      .catch(() => {});

    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [agent.id]);

  useEffect(() => {
    liveEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveOutput]);

  const config = STATUS_CONFIG[agent.status];
  const nextCheckIn = formatNextCheckIn(
    agent.last_heartbeat_at,
    agent.checkin_interval_secs,
  );
  const runningFor = formatRunningSince(agent.created_at);

  const latestSession = sessions[0];
  const activity = useMemo(
    () => parseActivityEntries(latestSession),
    [latestSession],
  );

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

  const handleDelete = async () => {
    let confirmed = false;
    try {
      confirmed = await ask(
        "Delete this agent from Agent Founder? This cannot be undone.",
        { title: "Delete Agent", kind: "warning" },
      );
    } catch {
      confirmed = window.confirm(
        "Delete this agent from Agent Founder? This cannot be undone.",
      );
    }
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteAgent(agent.id, removeFounderFiles);
      onDeleted();
    } finally {
      setDeleting(false);
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

  const handleAddEnvVar = async () => {
    if (!newEnvKey.trim()) return;
    await setAgentEnvVar(agent.id, newEnvKey.trim(), newEnvValue);
    setNewEnvKey("");
    setNewEnvValue("");
    getAgentEnvVars(agent.id).then(setEnvVars).catch(() => {});
  };

  const handleDeleteEnvVar = async (key: string) => {
    await deleteAgentEnvVar(agent.id, key);
    getAgentEnvVars(agent.id).then(setEnvVars).catch(() => {});
  };

  const handleSaveFile = async (filename: string, content: string) => {
    setFileSaving(true);
    try {
      await writeTextFile(`${agent.workspace}/.founder/${filename}`, content);
    } finally {
      setFileSaving(false);
    }
  };

  const handleRunNow = async () => {
    setBusy(true);
    try {
      await triggerManualSession(agent.id);
      onRefetch();
    } finally {
      setBusy(false);
    }
  };

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    setMessageSending(true);
    try {
      await sendMessageToAgent(agent.id, messageText.trim());
      setMessageText("");
      readTextFile(`${agent.workspace}/.founder/INBOX.md`).then(setInboxContent).catch(() => {});
    } finally {
      setMessageSending(false);
    }
  };

  const canPause = agent.status === "running";
  const canStart = agent.status !== "running";

  return (
    <div
      className="max-w-[860px] mx-auto"
      style={{ paddingLeft: 32, paddingRight: 32, paddingTop: 40, paddingBottom: 48 }}
    >
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
            >
              {agent.status === "idle" ? (
                <>
                  <Play size={14} strokeWidth={2} />
                  Start
                </>
              ) : (
                <>
                  <RotateCcw size={14} strokeWidth={2} />
                  Restart
                </>
              )}
            </button>
          )}
          <button
            onClick={handleRunNow}
            disabled={busy}
            className={ghostButton}
            style={{
              color: "var(--text-secondary)",
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Play size={14} strokeWidth={2} />
            Run Now
          </button>
        </div>
      </div>

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
          <span className="text-[14px]" style={{ color: "var(--text-primary)" }}>
            {config.label}
          </span>
        </div>
        <div className="w-px shrink-0" style={{ height: 20, background: "var(--border-default)" }} />
        <div className="flex flex-col">
          <span className="text-[14px]" style={{ color: "var(--text-tertiary)" }}>
            Next check-in
          </span>
          <span className="text-[14px]" style={{ color: "var(--text-primary)" }}>
            {nextCheckIn}
          </span>
        </div>
        <div className="w-px shrink-0" style={{ height: 20, background: "var(--border-default)" }} />
        <div className="flex flex-col">
          <span className="text-[14px]" style={{ color: "var(--text-tertiary)" }}>
            Sessions
          </span>
          <span className="text-[14px]" style={{ color: "var(--text-primary)" }}>
            {agent.total_sessions}
          </span>
        </div>
        <div className="w-px shrink-0" style={{ height: 20, background: "var(--border-default)" }} />
        <div className="flex flex-col">
          <span className="text-[14px]" style={{ color: "var(--text-tertiary)" }}>
            Running for
          </span>
          <span className="text-[14px]" style={{ color: "var(--text-primary)" }}>
            {runningFor}
          </span>
        </div>
      </div>

      {agent.consecutive_errors > 0 && (
        <div
          className="rounded-xl p-4 border flex gap-3 mt-4"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border-default)",
            borderLeftWidth: 3,
            borderLeftColor:
              agent.consecutive_errors >= 5
                ? "var(--status-error)"
                : "var(--status-paused)",
          }}
        >
          {agent.consecutive_errors >= 5 ? (
            <ShieldAlert
              size={20}
              className="shrink-0 mt-0.5"
              style={{ color: "var(--status-error)" }}
            />
          ) : (
            <RefreshCw
              size={20}
              className="shrink-0 mt-0.5"
              style={{ color: "var(--status-paused)" }}
            />
          )}
          <div className="min-w-0">
            <p
              className="text-[15px] font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {agent.consecutive_errors >= 5
                ? "Agent permanently stopped after 5 consecutive errors"
                : `Auto-recovering (${agent.consecutive_errors}/5 errors)`}
            </p>
            <p
              className="text-[14px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {agent.consecutive_errors >= 5
                ? "Click Start to reset the error counter and try again."
                : "The agent will retry automatically with increasing backoff delays."}
            </p>
            {agent.last_error_at && (
              <p
                className="text-[13px] mt-1"
                style={{ color: "var(--text-tertiary)" }}
              >
                Last error: {formatRelativeTime(agent.last_error_at)}
              </p>
            )}
          </div>
        </div>
      )}

      {agent.status === "running" && liveOutput.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="flex items-center justify-between mb-2">
            <h2
              className="text-[17px] font-semibold flex items-center gap-2"
              style={{ color: "var(--text-primary)" }}
            >
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: "var(--status-active)" }}
              />
              Live
            </h2>
            <button
              onClick={() => setShowLive((v) => !v)}
              className="text-[13px] font-medium cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              {showLive ? "Hide" : "Show"}
            </button>
          </div>
          {showLive && (
            <div
              className="rounded-xl border overflow-hidden"
              style={{
                background: "var(--bg-inset)",
                borderColor: "var(--border-default)",
                maxHeight: 240,
                overflowY: "auto",
              }}
            >
              <div className="p-3 space-y-1 font-mono text-[13px]">
                {liveOutput.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2"
                    style={{ color: entry.type === "retry" ? "var(--status-paused)" : "var(--text-secondary)" }}
                  >
                    <span
                      className="shrink-0 text-[11px] tabular-nums"
                      style={{ color: "var(--text-tertiary)", minWidth: 48 }}
                    >
                      {new Date(entry.timestamp).toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        hour12: false,
                      })}
                    </span>
                    <span className="break-all">{entry.message}</span>
                  </div>
                ))}
                <div ref={liveEndRef} />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 mt-6 mb-4" style={{ borderBottom: "1px solid var(--border-default)" }}>
        {(["activity", "messages", "files", "secrets"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-3 py-2 text-[14px] font-medium cursor-pointer transition-colors"
            style={{
              color: activeTab === tab ? "var(--text-primary)" : "var(--text-tertiary)",
              borderBottom: activeTab === tab ? "2px solid var(--text-primary)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {tab === "activity" ? "Activity" : tab === "messages" ? "Messages" : tab === "files" ? "Files" : "Secrets"}
          </button>
        ))}
      </div>

      {activeTab === "activity" && (
      <>
        <div>
        <h2
          className="text-[17px] font-semibold mb-4"
          style={{ color: "var(--text-primary)" }}
        >
          What's happening
        </h2>

        {latestSession?.outcome === "blocked" && (
          <div
            className="rounded-xl p-4 border flex gap-3 mb-3"
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
            <div className="min-w-0">
              <p className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
                Agent is blocked
              </p>
              <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
                {latestSession.summary || "Review the latest session details for blocker context."}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {activity.length === 0 ? (
            <p className="text-[14px]" style={{ color: "var(--text-tertiary)" }}>
              No activity yet. Start the agent to generate session events.
            </p>
          ) : (
            activity.map((entry, i) => {
              const Icon = ICON_MAP[entry.icon] ?? Wrench;
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
                        <p className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
                          {entry.title}
                        </p>
                        <p className="text-[14px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                          {entry.description || "No details"}
                        </p>
                      </div>
                      <span className="text-[13px] shrink-0" style={{ color: "var(--text-tertiary)" }}>
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
            })
          )}
        </div>
      </div>

      <div style={{ marginTop: 32 }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Past work sessions
          </h2>
          <button
            className={ghostButton}
            style={{ color: "var(--text-secondary)" }}
            onClick={() => onShareJourney(agent, sessions)}
          >
            <Share2 size={14} strokeWidth={2} />
            Share journey
          </button>
        </div>

        {sessions.length === 0 ? (
          <p className="text-[14px]" style={{ color: "var(--text-tertiary)" }}>
            No work sessions yet. Your agent will start working at the next check-in.
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
                    setExpandedSessionId((id) => (id === session.id ? null : session.id))
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
                      <span className="text-[14px] shrink-0" style={{ color: "var(--text-primary)" }}>
                        {formatSessionDate(session.started_at)}
                      </span>
                      <span className="text-[14px] truncate" style={{ color: "var(--text-secondary)" }}>
                        - {truncate(session.summary || "No summary", 60)}
                      </span>
                      <span
                        className="shrink-0 px-2 py-0.5 rounded text-[12px] font-medium"
                        style={{ background: "var(--bg-inset)", color: "var(--text-tertiary)" }}
                      >
                        {formatSessionDuration(session.started_at, session.ended_at)}
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
                    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-default)" }}>
                      <p className="text-[14px] mb-2" style={{ color: "var(--text-secondary)" }}>
                        {session.summary || "No summary"}
                      </p>
                      <p className="text-[13px] mb-2" style={{ color: "var(--text-tertiary)" }}>
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

      {/* end activity tab */}
      </>
      )}

      {activeTab === "messages" && (
        <div className="space-y-4">
          <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Message your agent
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Type a message for the agent..."
              className="flex-1 h-10 px-3 rounded-lg text-[14px]"
              style={{
                background: "var(--bg-inset)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-default)",
                outline: "none",
              }}
            />
            <button
              onClick={handleSendMessage}
              disabled={messageSending || !messageText.trim()}
              className="h-10 px-4 rounded-lg text-[14px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--text-primary)", color: "var(--bg-base)" }}
            >
              {messageSending ? "Sending..." : "Send"}
            </button>
          </div>
          <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Messages are written to .founder/INBOX.md and read by the agent on the next heartbeat.
          </p>
          {inboxContent && inboxContent.includes("---") && (
            <div
              className="rounded-xl border p-4"
              style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
            >
              <h3 className="text-[15px] font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                Pending messages
              </h3>
              <pre
                className="text-[13px] font-mono whitespace-pre-wrap"
                style={{ color: "var(--text-secondary)" }}
              >
                {inboxContent}
              </pre>
            </div>
          )}
        </div>
      )}

      {activeTab === "files" && (
        <div className="space-y-6">
          {[
            { label: "SOUL.md", value: soulContent, setter: setSoulContent, filename: "SOUL.md" },
            { label: "MISSION.md", value: missionContent, setter: setMissionContent, filename: "MISSION.md" },
            { label: "MEMORY.md", value: memoryContent, setter: setMemoryContent, filename: "MEMORY.md" },
          ].map(({ label, value, setter, filename }) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
                  {label}
                </h3>
                <button
                  onClick={() => handleSaveFile(filename, value)}
                  disabled={fileSaving}
                  className="text-[13px] font-medium px-3 py-1 rounded-lg cursor-pointer disabled:opacity-50"
                  style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
                >
                  {fileSaving ? "Saving..." : "Save"}
                </button>
              </div>
              <textarea
                value={value}
                onChange={(e) => setter(e.target.value)}
                rows={8}
                className="w-full rounded-xl p-3 text-[14px] font-mono resize-y"
                style={{
                  background: "var(--bg-inset)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-default)",
                  outline: "none",
                  minHeight: 120,
                }}
              />
            </div>
          ))}
        </div>
      )}

      {activeTab === "secrets" && (
        <div className="space-y-4">
          <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Environment Variables
          </h2>
          <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            These are injected into the Claude CLI process. Use them for API keys, tokens, and other secrets.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newEnvKey}
              onChange={(e) => setNewEnvKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
              placeholder="KEY_NAME"
              className="w-48 h-10 px-3 rounded-lg text-[14px] font-mono"
              style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none" }}
            />
            <input
              type="password"
              value={newEnvValue}
              onChange={(e) => setNewEnvValue(e.target.value)}
              placeholder="value"
              className="flex-1 h-10 px-3 rounded-lg text-[14px] font-mono"
              style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none" }}
            />
            <button
              onClick={handleAddEnvVar}
              disabled={!newEnvKey.trim()}
              className="h-10 px-4 rounded-lg text-[14px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--text-primary)", color: "var(--bg-base)" }}
            >
              Add
            </button>
          </div>
          {envVars.length > 0 && (
            <div
              className="rounded-xl border overflow-hidden"
              style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
            >
              {envVars.map((envVar, i) => (
                <div
                  key={envVar.key}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{ borderBottom: i < envVars.length - 1 ? "1px solid var(--border-default)" : "none" }}
                >
                  <span className="font-mono text-[14px] font-medium shrink-0" style={{ color: "var(--text-primary)", minWidth: 160 }}>
                    {envVar.key}
                  </span>
                  <span
                    className="flex-1 font-mono text-[14px] truncate cursor-pointer"
                    style={{ color: "var(--text-secondary)" }}
                    onClick={() => setRevealedKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has(envVar.key)) next.delete(envVar.key);
                      else next.add(envVar.key);
                      return next;
                    })}
                  >
                    {revealedKeys.has(envVar.key) ? envVar.value : "••••••••"}
                  </span>
                  <button
                    onClick={() => handleDeleteEnvVar(envVar.key)}
                    className="text-[13px] cursor-pointer shrink-0"
                    style={{ color: "var(--status-error)" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 32 }}>
        <h2 className="text-[17px] font-semibold mb-3" style={{ color: "var(--status-error)" }}>
          Danger zone
        </h2>
        <div
          className="rounded-xl border p-4"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
        >
          <label className="flex items-center gap-2 mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={removeFounderFiles}
              onChange={(e) => setRemoveFounderFiles(e.target.checked)}
            />
            <span className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
              Also remove `.founder` files from workspace
            </span>
          </label>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-[14px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--status-error)", color: "white" }}
          >
            <Trash2 size={15} strokeWidth={2} />
            {deleting ? "Deleting..." : "Delete agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
