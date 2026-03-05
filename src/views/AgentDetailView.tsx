import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Pause,
  Play,
  RotateCcw,
  Wrench,
  RefreshCw,
  Zap,
  FolderCheck,
  ShieldAlert,
  MessageCircle,
} from "lucide-react";
import type { Agent, AgentStatus, WorkSessionLog, WorkspaceHealth, Artifact, ToolManifestEntry, GitStatus, TaskBoard, ScheduleEntry, AgentEnvVar } from "@/types";
import {
  getWorkSessions,
  startAgent,
  pauseAgent,
  stopAgent,
  getAgentEnvVars,
  readTextFile,
  triggerManualSession,
  checkWorkspaceHealth,
  repairWorkspace,
  readArtifactsManifest,
  readToolsManifest,
  gitGetStatus,
  getTaskBoard,
  getSchedule,
  getDailyReports,
  clearAgentSessions,
} from "@/lib/api";
import type { DailyReport } from "@/lib/api";
import { formatRelativeTime } from "@/lib/formatTime";
import OverviewTab from "@/components/agent-detail/OverviewTab";
import InboxTab from "@/components/agent-detail/InboxTab";
import ScheduleTab from "@/components/agent-detail/ScheduleTab";
import BehaviorTab from "@/components/agent-detail/BehaviorTab";
import SettingsTab from "@/components/agent-detail/SettingsTab";
import ArtifactsTab from "@/components/agent-detail/ArtifactsTab";
import ToolsTab from "@/components/agent-detail/ToolsTab";
import ReportsTab from "@/components/agent-detail/ReportsTab";

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; color: string }
> = {
  idle: { label: "Sleeping", color: "var(--status-idle)" },
  running: { label: "Working", color: "var(--status-active)" },
  paused: { label: "Paused", color: "var(--status-paused)" },
  error: { label: "Stopped", color: "var(--status-error)" },
};

const ghostButton =
  "flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ease-out cursor-pointer";

function formatNextCheckIn(lastHeartbeat: string | null, intervalSecs: number): string {
  if (!lastHeartbeat) return "Soon";
  const last = new Date(lastHeartbeat).getTime();
  const next = last + intervalSecs * 1000;
  const now = Date.now();
  const diffMs = next - now;
  if (diffMs <= 0) return "Soon";
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "<1m";
  if (diffMins < 60) return `${diffMins}m`;
  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatLastActive(lastHeartbeat: string | null): string {
  if (!lastHeartbeat) return "Never";
  const last = new Date(lastHeartbeat).getTime();
  const now = Date.now();
  const diffMs = now - last;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export interface AgentDetailViewProps {
  agent: Agent;
  onRefetch: () => void;
  onShareJourney: (agent: Agent) => Promise<void> | void;
  onStartPair: (agent: Agent) => Promise<void> | void;
  onDeleted: () => void;
}

type TabKey = "overview" | "inbox" | "schedule" | "artifacts" | "behavior" | "settings" | "tools" | "reports";

export default function AgentDetailView({
  agent,
  onRefetch,
  onShareJourney,
  onStartPair,
  onDeleted,
}: AgentDetailViewProps) {
  const [sessions, setSessions] = useState<WorkSessionLog[]>([]);
  const [busy, setBusy] = useState(false);

  // Live output
  const [liveOutput, setLiveOutput] = useState<Array<{ type: string; message: string; timestamp: number }>>([]);
  const [showLive, setShowLive] = useState(false);
  const liveEndRef = useRef<HTMLDivElement>(null);
  const liveContainerRef = useRef<HTMLDivElement>(null);
  const [sessionProgress, setSessionProgress] = useState<{ turn: number; maxTurns: number; elapsedSecs: number; maxDurationSecs: number } | null>(null);
  const [activityVisible, setActivityVisible] = useState(false);
  const [activityFadingOut, setActivityFadingOut] = useState(false);

  const [showFullMission, setShowFullMission] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  // Tab state
  const [envVars, setEnvVars] = useState<AgentEnvVar[]>([]);
  const [soulContent, setSoulContent] = useState("");
  const [missionContent, setMissionContent] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [inboxContent, setInboxContent] = useState("");
  const [wsHealth, setWsHealth] = useState<WorkspaceHealth | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [tools, setTools] = useState<ToolManifestEntry[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [taskBoard, setTaskBoard] = useState<TaskBoard | null>(null);
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntry[]>([]);

  // Eagerly fetch core data
  useEffect(() => {
    getWorkSessions(agent.id).then(setSessions).catch(() => setSessions([]));
    checkWorkspaceHealth(agent.id).then(setWsHealth).catch(() => {});
    readArtifactsManifest(agent.id).then(setArtifacts).catch(() => setArtifacts([]));
    readToolsManifest(agent.id).then(setTools).catch(() => setTools([]));
    getDailyReports(agent.id).then(setReports).catch(() => setReports([]));
    getTaskBoard(agent.id).then(setTaskBoard).catch(() => {});
    gitGetStatus(agent.id).then(setGitStatus).catch(() => {});
    setLiveOutput([]);
    setSessionProgress(null);
  }, [agent.id]);

  // Lazy-load tab data
  useEffect(() => {
    const id = agent.id;
    const ws = agent.workspace;
    switch (activeTab) {
      case "inbox":
        readTextFile(id, `${ws}/.founder/INBOX.md`).then(setInboxContent).catch(() => setInboxContent(""));
        break;
      case "schedule":
        getSchedule(id).then(setScheduleEntries).catch(() => setScheduleEntries([]));
        break;
      case "behavior":
        readTextFile(id, `${ws}/.founder/SOUL.md`).then(setSoulContent).catch(() => setSoulContent(""));
        readTextFile(id, `${ws}/.founder/MISSION.md`).then(setMissionContent).catch(() => setMissionContent(""));
        readTextFile(id, `${ws}/.founder/MEMORY.md`).then(setMemoryContent).catch(() => setMemoryContent(""));
        break;
      case "settings":
        getAgentEnvVars(id).then(setEnvVars).catch(() => {});
        break;
    }
  }, [agent.id, agent.workspace, activeTab]);

  // Session completed listener
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    listen<WorkSessionLog>("session-completed", (event) => {
      if (!active || event.payload?.agent_id !== agent.id) return;
      getWorkSessions(agent.id).then(setSessions).catch(() => {});
      setSessionProgress(null);
      readArtifactsManifest(agent.id).then(setArtifacts).catch(() => {});
      readToolsManifest(agent.id).then(setTools).catch(() => {});
      onRefetch();
    }).then((fn) => { if (active) unlisten = fn; }).catch(() => {});
    return () => { active = false; if (unlisten) unlisten(); };
  }, [agent.id, onRefetch]);

  // Session start time for elapsed timer
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!sessionStartTime || agent.status !== "running") return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - sessionStartTime) / 1000)), 1000);
    return () => clearInterval(id);
  }, [sessionStartTime, agent.status]);

  // Live output listener
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    listen<{ agent_id: string; type: string; raw?: string; message?: string; attempt?: number; delay_secs?: number; turn?: number; max_turns?: number; elapsed_secs?: number; max_duration_secs?: number; interval_secs?: number }>(
      "agent-output",
      (event) => {
        if (!active || event.payload?.agent_id !== agent.id) return;
        const p = event.payload;

        if (p.type === "turn_progress") {
          setSessionProgress({
            turn: p.turn ?? 0,
            maxTurns: p.max_turns ?? 40,
            elapsedSecs: p.elapsed_secs ?? 0,
            maxDurationSecs: p.max_duration_secs ?? 1800,
          });
          return;
        }

        if (p.type === "tempo_change") {
          const secs = p.interval_secs ?? 0;
          const label = secs >= 3600 ? `${Math.floor(secs / 3600)}h` : `${Math.floor(secs / 60)}m`;
          setLiveOutput((prev) => [...prev, { type: "tempo_change", message: `Next check-in in ${label}`, timestamp: Date.now() }]);
          return;
        }

        if (p.type === "assistant") {
          try {
            const raw = JSON.parse(p.raw || "{}");
            const content = raw.content ?? raw.message?.content;
            let text = "";
            if (typeof content === "string") text = content;
            else if (Array.isArray(content)) {
              const thinking = content.find((b: Record<string, unknown>) => b.type === "thinking");
              const textBlock = content.find((b: Record<string, unknown>) => b.type === "text");
              if (thinking) text = `Thinking: ${(thinking.thinking as string || "").slice(0, 100)}`;
              else if (textBlock) text = ((textBlock.text as string) || "").slice(0, 100);
            }
            if (text) {
              setLiveOutput((prev) => [...prev, { type: "assistant", message: text.split("\n")[0].slice(0, 100), timestamp: Date.now() }].slice(-50));
            }
          } catch {}
          return;
        }

        let message = "";
        if (p.type === "session_start") {
          message = "Checking in...";
          setSessionStartTime(Date.now());
          setElapsed(0);
          setSessionProgress({ turn: 0, maxTurns: p.max_turns ?? 40, elapsedSecs: 0, maxDurationSecs: p.max_duration_secs ?? 1800 });
        } else if (p.type === "retry") {
          message = `Retrying (${p.attempt}/3)... waiting ${p.delay_secs}s`;
        } else if (p.type === "tool_call") {
          try {
            const raw = JSON.parse(p.raw || "{}");
            const tool = ((raw.tool as string) || (raw.name as string) || "").toLowerCase();
            const input = raw.input as Record<string, unknown> | undefined;
            const path = ((input?.file_path ?? input?.path ?? input?.file) as string) || "";
            const shortPath = path.split("/").slice(-2).join("/");

            if (tool.includes("write") || tool.includes("edit") || tool.includes("replace")) {
              message = `Editing ${shortPath || "file"}`;
            } else if (tool.includes("read")) {
              message = `Reading ${shortPath || "file"}`;
            } else if (tool.includes("bash") || tool.includes("shell") || tool.includes("command")) {
              const cmd = ((input?.command as string) || "command").slice(0, 80);
              message = `Running: ${cmd}`;
            } else if (tool.includes("search") || tool.includes("grep") || tool.includes("find")) {
              const query = (input?.pattern ?? input?.query ?? input?.search_term) as string;
              message = query ? `Searching: ${query.slice(0, 60)}` : "Searching codebase";
            } else if (tool.includes("list") || tool.includes("glob") || tool.includes("dir")) {
              message = `Browsing ${shortPath || "files"}`;
            } else if (tool.includes("web") || tool.includes("fetch") || tool.includes("curl")) {
              message = "Fetching from web";
            } else {
              message = `Working (${tool.split("_").pop() || "tool"})`;
            }
          } catch { message = "Working..."; }
        } else if (p.type === "result") {
          setSessionStartTime(null);
          setActivityFadingOut(true);
          setTimeout(() => {
            setLiveOutput([]);
            setSessionProgress(null);
            setActivityVisible(false);
            setActivityFadingOut(false);
            setShowLive(false);
          }, 600);
          return;
        } else { return; }

        setActivityVisible(true);
        setActivityFadingOut(false);
        setLiveOutput((prev) => [...prev, { type: p.type, message, timestamp: Date.now() }].slice(-50));
      },
    ).then((fn) => { if (active) unlisten = fn; }).catch(() => {});
    return () => { active = false; if (unlisten) unlisten(); };
  }, [agent.id]);

  useEffect(() => {
    const container = liveContainerRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }, [liveOutput]);

  // Reset activity state when agent stops
  useEffect(() => {
    if (agent.status !== "running") {
      setActivityFadingOut(false);
      setActivityVisible(false);
      setLiveOutput([]);
      setSessionProgress(null);
      setShowLive(false);
    }
  }, [agent.status]);

  const config = STATUS_CONFIG[agent.status];
  const nextCheckIn = formatNextCheckIn(agent.last_heartbeat_at, agent.checkin_interval_secs);
  const lastActive = formatLastActive(agent.last_heartbeat_at);
  const totalCost = sessions.reduce((sum, s) => sum + (s.cost_usd || 0), 0);

  const handlePause = async () => { setBusy(true); try { await pauseAgent(agent.id); onRefetch(); } finally { setBusy(false); } };
  const handleRestart = async () => { setBusy(true); try { await stopAgent(agent.id); await startAgent(agent.id); onRefetch(); } finally { setBusy(false); } };
  const handleRunNow = async () => { setBusy(true); try { await triggerManualSession(agent.id); onRefetch(); } finally { setBusy(false); } };
  const handleRepair = async () => {
    setRepairing(true);
    try { await repairWorkspace(agent.id); checkWorkspaceHealth(agent.id).then(setWsHealth).catch(() => {}); } finally { setRepairing(false); }
  };

  const canPause = agent.status === "running";
  const canStart = agent.status !== "running";

  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "inbox", label: "Inbox" },
    { key: "schedule", label: "Schedule" },
    ...(artifacts.length > 0 ? [{ key: "artifacts" as TabKey, label: "Artifacts", badge: artifacts.length }] : []),
    { key: "behavior", label: "Behavior" },
    { key: "settings", label: "Settings" },
    ...(tools.length > 0 ? [{ key: "tools" as TabKey, label: "Tools", badge: tools.length }] : []),
    ...(reports.length > 0 ? [{ key: "reports" as TabKey, label: "Reports" }] : []),
  ];

  return (
    <div className="max-w-[860px] mx-auto" style={{ paddingLeft: 32, paddingRight: 32, paddingTop: 40, paddingBottom: 48 }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-0">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold" style={{ color: "var(--text-primary)" }}>{agent.name}</h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 rounded-full text-[13px] font-medium"
            style={{ height: 22, background: `color-mix(in srgb, ${config.color} 10%, transparent)`, color: config.color }}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: config.color }} />
            {config.label}
          </span>
          {canPause && (
            <button onClick={handlePause} disabled={busy} className={ghostButton} style={{ color: "var(--text-secondary)", opacity: busy ? 0.6 : 1 }}>
              <Pause size={14} strokeWidth={2} /> Pause
            </button>
          )}
          {canStart && (
            <button onClick={handleRestart} disabled={busy} className={ghostButton} style={{ color: "var(--text-secondary)", opacity: busy ? 0.6 : 1 }}>
              {agent.status === "idle" ? <><Play size={14} strokeWidth={2} /> Start</> : <><RotateCcw size={14} strokeWidth={2} /> Restart</>}
            </button>
          )}
          <button onClick={handleRunNow} disabled={busy} className={ghostButton} style={{ color: "var(--text-secondary)", opacity: busy ? 0.6 : 1 }}>
            <Zap size={14} strokeWidth={2} /> Run Now
          </button>
          <button onClick={() => void onStartPair(agent)} className={ghostButton} style={{ color: "var(--text-secondary)" }}>
            <MessageCircle size={14} strokeWidth={2} /> Start Pair
          </button>
        </div>
      </div>
      {agent.mission && (() => {
        const long = agent.mission.length > 180;
        return (
          <div className="mb-4">
            <p
              className={`text-[15px] mt-0.5 w-full ${!showFullMission && long ? "line-clamp-2" : ""}`}
              style={{ color: "var(--text-secondary)" }}
            >
              {agent.mission}
            </p>
            {long && (
              <button
                onClick={() => setShowFullMission((v) => !v)}
                className="text-[13px] mt-1 cursor-pointer"
                style={{ color: "var(--text-tertiary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-tertiary)")}
              >
                {showFullMission ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        );
      })()}


      {/* Stats bar */}
      <div className="flex items-center gap-3 flex-wrap pb-4" style={{ paddingBottom: 16 }}>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-medium" style={{ background: `color-mix(in srgb, ${config.color} 10%, transparent)`, color: config.color }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: config.color }} />
          {config.label}
        </div>
        <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>Last active {lastActive}</span>
        {agent.status === "running" && nextCheckIn !== "Soon" && (
          <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>· Next in {nextCheckIn}</span>
        )}
        {totalCost > 0 && (
          <span className="text-[13px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>· ${totalCost.toFixed(2)} spent</span>
        )}
        {agent.total_sessions > 0 && (
          <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>· {agent.total_sessions} session{agent.total_sessions !== 1 ? "s" : ""}</span>
        )}
        {sessions.length > 0 && sessions[0].summary === "Nothing to do" && (
          <span className="text-[13px] italic" style={{ color: "var(--text-tertiary)" }}>· Last session: idle</span>
        )}
      </div>

      {/* Workspace health warning */}
      {wsHealth && !wsHealth.healthy && (
        <div className="rounded-xl p-4 border flex gap-3 mt-4" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)", borderLeftWidth: 3, borderLeftColor: "var(--status-working)" }}>
          <FolderCheck size={20} className="shrink-0 mt-0.5" style={{ color: "var(--status-working)" }} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
              {!wsHealth.workspace_exists ? "Workspace directory missing" : !wsHealth.founder_exists ? ".founder directory missing" : `Missing files: ${wsHealth.missing_files.join(", ")}`}
            </p>
            <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>Your co-founder may not work correctly without these files.</p>
          </div>
          <button onClick={handleRepair} disabled={repairing}
            className="shrink-0 px-3 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer disabled:opacity-50"
            style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}>
            {repairing ? "Repairing..." : "Auto-repair"}
          </button>
        </div>
      )}

      {/* Error recovery banner */}
      {agent.consecutive_errors > 0 && (
        <div className="rounded-xl p-4 border flex gap-3 mt-4" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)", borderLeftWidth: 3, borderLeftColor: agent.consecutive_errors >= 5 ? "var(--status-error)" : "var(--status-paused)" }}>
          {agent.consecutive_errors >= 5
            ? <ShieldAlert size={20} className="shrink-0 mt-0.5" style={{ color: "var(--status-error)" }} />
            : <RefreshCw size={20} className="shrink-0 mt-0.5" style={{ color: "var(--status-paused)" }} />}
          <div className="min-w-0">
            <p className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
              {agent.consecutive_errors >= 5 ? "Co-founder stopped after 5 consecutive errors" : `Auto-recovering (${agent.consecutive_errors}/5 errors)`}
            </p>
            <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
              {agent.consecutive_errors >= 5 ? "Click Start to reset the error counter and try again." : "Your co-founder will retry automatically with increasing delays."}
            </p>
            {agent.last_error_at && (
              <p className="text-[13px] mt-1" style={{ color: "var(--text-tertiary)" }}>Last error: {formatRelativeTime(agent.last_error_at)}</p>
            )}
          </div>
        </div>
      )}

      {/* Activity indicator */}
      {agent.status === "running" && activityVisible && (() => {
        const latest = liveOutput[liveOutput.length - 1];
        const elapsedLabel = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

        return (
          <div
            className="rounded-xl border mt-5 overflow-hidden"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-default)",
              opacity: activityFadingOut ? 0 : 1,
              transform: activityFadingOut ? "translateY(-4px)" : "translateY(0)",
              transition: "opacity 500ms ease-out, transform 500ms ease-out",
            }}
          >
            {/* Main indicator bar */}
            <div
              className="flex items-center gap-3 px-4 cursor-pointer select-none"
              onClick={() => setShowLive((v) => !v)}
              style={{ height: 44 }}
            >
              {/* Thinking dots animation */}
              <div className="flex items-center gap-[3px] shrink-0">
                <span className="thinking-dot" style={{ animationDelay: "0ms" }} />
                <span className="thinking-dot" style={{ animationDelay: "160ms" }} />
                <span className="thinking-dot" style={{ animationDelay: "320ms" }} />
              </div>

              <span
                className="text-[13px] flex-1 min-w-0 truncate"
                style={{ color: "var(--text-secondary)" }}
              >
                {latest?.message || "Thinking..."}
              </span>

              {sessionStartTime && (
                <span className="text-[12px] font-mono shrink-0 tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                  {elapsedLabel}
                </span>
              )}

              {sessionProgress && (
                <span className="text-[11px] font-mono shrink-0 flex items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
                  <span className="tabular-nums">turn {sessionProgress.turn}/{sessionProgress.maxTurns}</span>
                  <div className="w-12 h-1 rounded-full overflow-hidden" style={{ background: "var(--bg-inset)" }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ background: "var(--status-active)", width: `${Math.min(100, (sessionProgress.turn / sessionProgress.maxTurns) * 100)}%` }} />
                  </div>
                </span>
              )}

              <svg
                width="12" height="12" viewBox="0 0 12 12" fill="none"
                className="shrink-0 transition-transform duration-200"
                style={{ color: "var(--text-tertiary)", transform: showLive ? "rotate(180deg)" : "rotate(0deg)" }}
              >
                <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            {/* Expandable detail log */}
            <div
              style={{
                maxHeight: showLive ? 200 : 0,
                opacity: showLive ? 1 : 0,
                transition: "max-height 300ms ease-out, opacity 200ms ease-out",
                overflow: "hidden",
              }}
            >
              <div style={{ borderTop: "1px solid var(--border-default)" }}>
                <div ref={liveContainerRef} style={{ maxHeight: 200, overflowY: "auto" }}>
                  <div className="px-4 py-2 space-y-px">
                    {liveOutput.map((entry, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2.5 text-[12px]"
                        style={{ lineHeight: "24px" }}
                      >
                        <span className="w-1 h-1 rounded-full shrink-0" style={{ background: i === liveOutput.length - 1 ? "var(--status-active)" : "var(--text-tertiary)", opacity: i === liveOutput.length - 1 ? 1 : 0.5 }} />
                        <span className="truncate" style={{ color: i === liveOutput.length - 1 ? "var(--text-secondary)" : "var(--text-tertiary)" }}>
                          {entry.message}
                        </span>
                      </div>
                    ))}
                    <div ref={liveEndRef} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tab bar */}
      <div className="flex items-center gap-1 mt-6 mb-4 overflow-x-auto" style={{ borderBottom: "1px solid var(--border-default)" }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-3 py-2 text-[14px] font-medium cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5"
            style={{
              color: activeTab === tab.key ? "var(--text-primary)" : "var(--text-tertiary)",
              borderBottom: activeTab === tab.key ? "2px solid var(--text-primary)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {tab.label}
            {tab.badge !== undefined && (
              <span className="text-[11px] px-1.5 rounded-full font-semibold" style={{ background: "var(--bg-inset)", color: "var(--text-tertiary)" }}>{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <OverviewTab
          agent={agent}
          sessions={sessions}
          gitStatus={gitStatus}
          setGitStatus={setGitStatus}
          taskBoard={taskBoard}
          setTaskBoard={setTaskBoard}
          onShareJourney={onShareJourney}
        />
      )}
      {activeTab === "inbox" && (
        <InboxTab agent={agent} inboxContent={inboxContent} setInboxContent={setInboxContent} />
      )}
      {activeTab === "schedule" && (
        <ScheduleTab agent={agent} entries={scheduleEntries} setEntries={setScheduleEntries} />
      )}
      {activeTab === "behavior" && (
        <BehaviorTab
          agent={agent}
          onRefetch={onRefetch}
          soulContent={soulContent}
          setSoulContent={setSoulContent}
          missionContent={missionContent}
          setMissionContent={setMissionContent}
          memoryContent={memoryContent}
          setMemoryContent={setMemoryContent}
        />
      )}
      {activeTab === "settings" && (
        <SettingsTab
          agent={agent}
          onRefetch={onRefetch}
          onDeleted={onDeleted}
          envVars={envVars}
          setEnvVars={setEnvVars}
          gitStatus={gitStatus}
          setGitStatus={setGitStatus}
          sessionsCount={sessions.length}
          clearSessions={async () => { await clearAgentSessions(agent.id); setSessions([]); onRefetch(); }}
        />
      )}
      {activeTab === "artifacts" && (
        <ArtifactsTab
          artifacts={artifacts}
          agentId={agent.id}
          onArtifactsChanged={() => readArtifactsManifest(agent.id).then(setArtifacts).catch(() => {})}
        />
      )}
      {activeTab === "tools" && <ToolsTab tools={tools} />}
      {activeTab === "reports" && <ReportsTab agentId={agent.id} reports={reports} setReports={setReports} />}
    </div>
  );
}
