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
import type { Agent, AgentStatus, WorkSessionLog, WorkspaceHealth, Artifact, ToolManifestEntry, GitStatus, TaskBoard, SpendBreakdown, ScheduleEntry, AgentEnvVar } from "@/types";
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
  getSpendBreakdown,
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
  onStartLiveSession: (agent: Agent) => Promise<void> | void;
  onDeleted: () => void;
}

type TabKey = "overview" | "inbox" | "schedule" | "settings" | "artifacts" | "tools" | "reports";

export default function AgentDetailView({
  agent,
  onRefetch,
  onShareJourney,
  onStartLiveSession,
  onDeleted,
}: AgentDetailViewProps) {
  const [sessions, setSessions] = useState<WorkSessionLog[]>([]);
  const [busy, setBusy] = useState(false);

  // Live output
  const [liveOutput, setLiveOutput] = useState<Array<{ type: string; message: string; timestamp: number }>>([]);
  const [showLive, setShowLive] = useState(true);
  const liveEndRef = useRef<HTMLDivElement>(null);
  const liveContainerRef = useRef<HTMLDivElement>(null);
  const [sessionProgress, setSessionProgress] = useState<{ turn: number; maxTurns: number; elapsedSecs: number; maxDurationSecs: number } | null>(null);

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
  const [spend, setSpend] = useState<SpendBreakdown | null>(null);
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
    getSpendBreakdown(agent.id).then(setSpend).catch(() => {});
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
      case "settings":
        getAgentEnvVars(id).then(setEnvVars).catch(() => {});
        readTextFile(id, `${ws}/.founder/SOUL.md`).then(setSoulContent).catch(() => setSoulContent(""));
        readTextFile(id, `${ws}/.founder/MISSION.md`).then(setMissionContent).catch(() => setMissionContent(""));
        readTextFile(id, `${ws}/.founder/MEMORY.md`).then(setMemoryContent).catch(() => setMemoryContent(""));
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
      getSpendBreakdown(agent.id).then(setSpend).catch(() => {});
      onRefetch();
    }).then((fn) => { if (active) unlisten = fn; }).catch(() => {});
    return () => { active = false; if (unlisten) unlisten(); };
  }, [agent.id, onRefetch]);

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
          setLiveOutput((prev) => [...prev, { type: "tempo_change", message: `Tempo changed: next check-in in ${label}`, timestamp: Date.now() }]);
          return;
        }

        let message = "";
        if (p.type === "session_start") {
          message = p.message || "Co-founder checking in...";
          setSessionProgress({ turn: 0, maxTurns: p.max_turns ?? 40, elapsedSecs: 0, maxDurationSecs: p.max_duration_secs ?? 1800 });
        } else if (p.type === "retry") {
          message = `Retrying (${p.attempt}/${3})... waiting ${p.delay_secs}s`;
        } else if (p.type === "assistant") {
          try { const raw = JSON.parse(p.raw || "{}"); message = (raw.content as string)?.slice(0, 200) || "Thinking..."; } catch { message = "Thinking..."; }
        } else if (p.type === "tool_call") {
          try {
            const raw = JSON.parse(p.raw || "{}");
            const tool = (raw.tool as string) || "tool";
            const input = raw.input as Record<string, unknown> | undefined;
            if (tool.includes("write")) message = `Writing ${(input?.path as string) || "file"}...`;
            else if (tool.includes("read")) message = `Reading ${(input?.path as string) || "file"}...`;
            else if (tool.includes("bash")) message = `Running: ${((input?.command as string) || "command").slice(0, 100)}`;
            else message = `Using tool: ${tool}`;
          } catch { message = "Using a tool..."; }
        } else if (p.type === "result") {
          message = "Session turn complete.";
        } else { return; }

        setLiveOutput((prev) => {
          const isThinking = p.type === "assistant" && (message === "Thinking..." || message.startsWith("Thinking"));
          if (isThinking && prev.length > 0 && prev[prev.length - 1].type === "assistant" && prev[prev.length - 1].message.startsWith("Thinking")) {
            return prev;
          }
          return [...prev, { type: p.type, message, timestamp: Date.now() }].slice(-50);
        });
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
    { key: "settings", label: "Settings" },
    ...(artifacts.length > 0 ? [{ key: "artifacts" as TabKey, label: "Artifacts", badge: artifacts.length }] : []),
    ...(tools.length > 0 ? [{ key: "tools" as TabKey, label: "Tools", badge: tools.length }] : []),
    ...(reports.length > 0 ? [{ key: "reports" as TabKey, label: "Reports" }] : []),
  ];

  return (
    <div className="max-w-[860px] mx-auto" style={{ paddingLeft: 32, paddingRight: 32, paddingTop: 40, paddingBottom: 48 }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold" style={{ color: "var(--text-primary)" }}>{agent.name}</h1>
          <p className="text-[15px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{agent.mission}</p>
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
          <button onClick={() => void onStartLiveSession(agent)} className={ghostButton} style={{ color: "var(--text-secondary)" }}>
            <MessageCircle size={14} strokeWidth={2} /> Start Live Session
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3 flex-wrap pb-4" style={{ borderBottom: "1px solid var(--border-default)", paddingBottom: 16 }}>
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

      {/* Live output indicator */}
      {agent.status === "running" && liveOutput.length > 0 && (() => {
        const latest = liveOutput[liveOutput.length - 1];
        const latestMsg = latest.type === "session_start" ? "Checking in..."
          : latest.type === "tool_call" ? latest.message
          : latest.type === "assistant" ? latest.message
          : latest.type === "retry" ? "Taking a short break, will retry..."
          : latest.type === "tempo_change" ? latest.message
          : latest.type === "result" ? "Finished this step"
          : latest.message;
        return (
          <div style={{ marginTop: 20 }}>
            <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => setShowLive((v) => !v)} style={{ minHeight: 32 }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: "var(--status-active)" }} />
              <span className="text-[14px] truncate flex-1 min-w-0" style={{ color: "var(--text-secondary)" }}>{latestMsg}</span>
              {sessionProgress && (
                <span className="text-[12px] font-mono shrink-0 flex items-center gap-2" style={{ color: "var(--text-tertiary)" }}>
                  <span>{sessionProgress.turn}/{sessionProgress.maxTurns}</span>
                  <span>{Math.floor(sessionProgress.elapsedSecs / 60)}:{String(sessionProgress.elapsedSecs % 60).padStart(2, "0")}</span>
                  <div className="w-16 h-1 rounded-full overflow-hidden" style={{ background: "var(--bg-inset)" }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ background: "var(--status-active)", width: `${Math.min(100, (sessionProgress.turn / sessionProgress.maxTurns) * 100)}%` }} />
                  </div>
                </span>
              )}
            </div>
            {showLive && (
              <div ref={liveContainerRef} className="mt-2 rounded-lg overflow-hidden" style={{ maxHeight: 200, overflowY: "auto", overflowAnchor: "none" }}>
                <div className="space-y-0.5 pl-4">
                  {liveOutput.slice(0, -1).map((entry, i) => {
                    if (entry.type === "assistant" && entry.message.startsWith("Thinking")) return null;
                    const msg = entry.type === "session_start" ? "Checking in..."
                      : entry.type === "tool_call" ? entry.message
                      : entry.type === "assistant" ? entry.message
                      : entry.type === "retry" ? "Retrying..."
                      : entry.type === "tempo_change" ? entry.message
                      : entry.type === "result" ? "Finished this step"
                      : entry.message;
                    return (
                      <div key={i} className="text-[13px] truncate" style={{ color: "var(--text-tertiary)", lineHeight: "24px" }}>{msg}</div>
                    );
                  })}
                  <div ref={liveEndRef} />
                </div>
              </div>
            )}
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
          spend={spend}
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
      {activeTab === "settings" && (
        <SettingsTab
          agent={agent}
          onRefetch={onRefetch}
          onDeleted={onDeleted}
          envVars={envVars}
          setEnvVars={setEnvVars}
          soulContent={soulContent}
          setSoulContent={setSoulContent}
          missionContent={missionContent}
          setMissionContent={setMissionContent}
          memoryContent={memoryContent}
          setMemoryContent={setMemoryContent}
          gitStatus={gitStatus}
          setGitStatus={setGitStatus}
          sessionsCount={sessions.length}
          clearSessions={async () => { await clearAgentSessions(agent.id); setSessions([]); onRefetch(); }}
        />
      )}
      {activeTab === "artifacts" && <ArtifactsTab artifacts={artifacts} />}
      {activeTab === "tools" && <ToolsTab tools={tools} />}
      {activeTab === "reports" && <ReportsTab agentId={agent.id} reports={reports} setReports={setReports} />}
    </div>
  );
}
