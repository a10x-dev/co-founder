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
  Zap,
  FolderCheck,
  Hammer,
  Clock,
  Eye,
  EyeOff,
  GitBranch,
  Undo2,
  ArrowRight,
  CalendarClock,
  Plus,
  Trash,
  ChevronDown,
} from "lucide-react";
import type { Agent, AgentStatus, WorkSessionLog, ActivityEntry, WorkspaceHealth, Artifact, ToolManifestEntry, GitStatus, TaskBoard, SpendBreakdown, ScheduleEntry } from "@/types";
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
  updateAutonomyLevel,
  clearAgentSessions,
  getDailyReports,
  generateDailyReport,
  checkWorkspaceHealth,
  repairWorkspace,
  readArtifactsManifest,
  readToolsManifest,
  getSpendBreakdown,
  updateDailyBudget,
  gitGetStatus,
  gitGetDiff,
  gitUndoLastSession,
  getTaskBoard,
  moveTask,
  getSchedule,
  saveScheduleEntry,
  deleteScheduleEntry,
  toggleScheduleEntry,
} from "@/lib/api";
import type { AgentEnvVar } from "@/types";
import type { DailyReport } from "@/lib/api";
import { formatRelativeTime } from "@/lib/formatTime";
import IntegrationsPanel from "@/components/IntegrationsPanel";

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

function formatSessionDate(isoString: string): string {
  const d = new Date(isoString);
  const day = d.toLocaleDateString("en-US", { weekday: "long" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
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
  try { parsedEvents = JSON.parse(session.events_json) as StoredEvent[]; } catch { return []; }
  return parsedEvents.slice(-20).reverse()
    .map((event, i) => buildActivityEntry(event, session, i))
    .filter((entry): entry is ActivityEntry => entry !== null);
}

function extractAssistantText(raw: Record<string, unknown>): string {
  const msg = raw.message as Record<string, unknown> | undefined;
  const contentBlocks = (msg?.content ?? raw.content) as Array<Record<string, unknown>> | string | undefined;
  if (typeof contentBlocks === "string") return contentBlocks;
  if (!Array.isArray(contentBlocks)) return "";
  return contentBlocks
    .filter((b) => b.type === "text")
    .map((b) => (b.text as string) ?? "")
    .join("\n")
    .trim();
}

function extractToolUse(raw: Record<string, unknown>): { name: string; input: Record<string, unknown> } | null {
  if (raw.tool) return { name: raw.tool as string, input: (raw.input as Record<string, unknown>) ?? {} };
  const msg = raw.message as Record<string, unknown> | undefined;
  const blocks = (msg?.content ?? raw.content) as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(blocks)) return null;
  const toolBlock = blocks.find((b) => b.type === "tool_use");
  if (!toolBlock) return null;
  return { name: (toolBlock.name as string) ?? "unknown", input: (toolBlock.input as Record<string, unknown>) ?? {} };
}

interface ClassifiedEvent {
  icon: string;
  title: string;
  description: string;
  detail?: string;
}

function classifyEvent(event: StoredEvent): ClassifiedEvent | null {
  if (!event.raw) return null;
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(event.raw) as Record<string, unknown>; } catch { return null; }
  const t = (event.type || raw.type || "unknown") as string;

  if (t === "system" || t === "user" || t === "rate_limit_event") return null;

  const classifyTool = (name: string, input: Record<string, unknown>): ClassifiedEvent | null => {
    const lname = name.toLowerCase();
    if (lname.includes("write") || name === "Edit")
      return { icon: "file", title: "Edited a file", description: (input.path as string || input.file_path as string) ?? "" };
    if (lname.includes("read") || name === "Glob" || name === "Grep") {
      const target = (input.path as string || input.pattern as string || input.glob_pattern as string) ?? "";
      return target ? { icon: "search", title: name, description: target } : null;
    }
    if (lname.includes("bash"))
      return { icon: "terminal", title: "Ran a command", description: truncate((input.command as string) ?? "", 120) };
    if (name === "Agent")
      return { icon: "agent", title: `Delegated: ${(input.description as string) ?? "subtask"}`, description: "" };
    if (name === "WebSearch")
      return { icon: "search", title: "Searched the web", description: (input.search_term as string) ?? "" };
    if (name === "WebFetch")
      return { icon: "search", title: "Fetched a URL", description: (input.url as string) ?? "" };
    return { icon: "tool", title: `Used: ${name}`, description: (input.description as string) ?? "" };
  };

  if (t === "tool_call") {
    const name = (raw.tool as string) ?? "tool";
    const input = (raw.input as Record<string, unknown>) ?? {};
    return classifyTool(name, input);
  }

  if (t === "assistant") {
    const toolUse = extractToolUse(raw);
    if (toolUse) return classifyTool(toolUse.name, toolUse.input);
    const text = extractAssistantText(raw);
    if (!text) return null;
    return { icon: "message", title: "Co-founder said", description: truncate(text, 180), detail: text };
  }

  if (t === "result") {
    const result = (raw.result as string) ?? "Session ended";
    return { icon: "done", title: "Session result", description: truncate(result, 180), detail: result };
  }
  return null;
}

const ICON_CHAR: Record<string, string> = { file: "✎", search: "⌕", terminal: "▸", agent: "⚙", message: "💬", done: "✓", tool: "·" };
const ACTIVITY_ICON_KEY: Record<string, string> = { file: "file-plus", search: "file-search", terminal: "terminal", agent: "wrench", message: "message-circle", done: "check-circle", tool: "wrench" };

function buildActivityEntry(event: StoredEvent, session: WorkSessionLog, index: number): ActivityEntry | null {
  const c = classifyEvent(event);
  if (!c) return null;
  return {
    icon: ACTIVITY_ICON_KEY[c.icon] ?? "wrench",
    title: c.title,
    description: c.description,
    timestamp: formatRelativeTime(session.started_at),
    details: index < 3 ? c.detail : undefined,
  };
}

function parseSessionTimeline(eventsJson: string): ClassifiedEvent[] {
  let events: StoredEvent[] = [];
  try { events = JSON.parse(eventsJson) as StoredEvent[]; } catch { return []; }
  return events.map(classifyEvent).filter((e): e is ClassifiedEvent => e !== null);
}

export interface AgentDetailViewProps {
  agent: Agent;
  onRefetch: () => void;
  onShareJourney: (agent: Agent) => Promise<void> | void;
  onDeleted: () => void;
}

const ghostButton =
  "flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ease-out cursor-pointer";

type TabKey = "overview" | "inbox" | "schedule" | "settings" | "artifacts" | "tools" | "reports";

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

  // Live output
  const [liveOutput, setLiveOutput] = useState<Array<{ type: string; message: string; timestamp: number }>>([]);
  const [showLive, setShowLive] = useState(true);
  const liveEndRef = useRef<HTMLDivElement>(null);
  const liveContainerRef = useRef<HTMLDivElement>(null);

  // Session progress
  const [sessionProgress, setSessionProgress] = useState<{ turn: number; maxTurns: number; elapsedSecs: number; maxDurationSecs: number } | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  // Secrets
  const [envVars, setEnvVars] = useState<AgentEnvVar[]>([]);
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  // Files
  const [soulContent, setSoulContent] = useState("");
  const [missionContent, setMissionContent] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [fileSaving, setFileSaving] = useState(false);

  // Messages
  const [messageText, setMessageText] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [inboxContent, setInboxContent] = useState("");

  // Workspace health
  const [wsHealth, setWsHealth] = useState<WorkspaceHealth | null>(null);
  const [repairing, setRepairing] = useState(false);

  // Artifacts
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);

  // Tools
  const [tools, setTools] = useState<ToolManifestEntry[]>([]);

  // Daily reports
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [generatingReport, setGeneratingReport] = useState(false);

  // Spend
  const [spend, setSpend] = useState<SpendBreakdown | null>(null);
  const [budgetInput, setBudgetInput] = useState(agent.daily_budget_usd.toString());

  // Git
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitDiff, setGitDiff] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);

  // Tasks
  const [taskBoard, setTaskBoard] = useState<TaskBoard | null>(null);

  // Schedule
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntry[]>([]);
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [newScheduleTime, setNewScheduleTime] = useState("09:00");
  const [newScheduleAction, setNewScheduleAction] = useState("");
  const [newScheduleRecurrence, setNewScheduleRecurrence] = useState<"once" | "daily" | "weekdays" | "weekly">("daily");

  // Core data + contextual tab counts (eagerly fetched)
  useEffect(() => {
    getWorkSessions(agent.id).then(setSessions).catch(() => setSessions([]));
    checkWorkspaceHealth(agent.id).then(setWsHealth).catch(() => {});
    readArtifactsManifest(agent.id).then(setArtifacts).catch(() => setArtifacts([]));
    readToolsManifest(agent.id).then(setTools).catch(() => setTools([]));
    getDailyReports(agent.id).then(setReports).catch(() => setReports([]));
    getSpendBreakdown(agent.id).then(setSpend).catch(() => {});
    getTaskBoard(agent.id).then(setTaskBoard).catch(() => {});
    gitGetStatus(agent.id).then(setGitStatus).catch(() => {});
    setBudgetInput(agent.daily_budget_usd.toString());
    setLiveOutput([]);
    setSessionProgress(null);
  }, [agent.id, agent.daily_budget_usd]);

  // Lazy-load tab data when tab is activated
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
  const latestSession = sessions[0];
  const activity = useMemo(() => parseActivityEntries(latestSession), [latestSession]);
  const totalCost = useMemo(() => sessions.reduce((sum, s) => sum + (s.cost_usd || 0), 0), [sessions]);

  const handlePause = async () => { setBusy(true); try { await pauseAgent(agent.id); onRefetch(); } finally { setBusy(false); } };
  const handleRestart = async () => { setBusy(true); try { await stopAgent(agent.id); await startAgent(agent.id); onRefetch(); } finally { setBusy(false); } };
  const handleDelete = async () => {
    let confirmed = false;
    try { confirmed = await ask("Delete this co-founder from Agent Founder? This cannot be undone.", { title: "Delete Co-Founder", kind: "warning" }); }
    catch { confirmed = window.confirm("Delete this co-founder from Agent Founder? This cannot be undone."); }
    if (!confirmed) return;
    setDeleting(true);
    try { await deleteAgent(agent.id, removeFounderFiles); onDeleted(); } finally { setDeleting(false); }
  };
  const toggleDetails = (id: string) => setExpandedDetails((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const handleAddEnvVar = async () => { if (!newEnvKey.trim()) return; await setAgentEnvVar(agent.id, newEnvKey.trim(), newEnvValue); setNewEnvKey(""); setNewEnvValue(""); getAgentEnvVars(agent.id).then(setEnvVars).catch(() => {}); };
  const handleDeleteEnvVar = async (key: string) => { await deleteAgentEnvVar(agent.id, key); getAgentEnvVars(agent.id).then(setEnvVars).catch(() => {}); };
  const handleSaveFile = async (filename: string, content: string) => { setFileSaving(true); try { await writeTextFile(agent.id, `${agent.workspace}/.founder/${filename}`, content); } finally { setFileSaving(false); } };
  const handleRunNow = async () => { setBusy(true); try { await triggerManualSession(agent.id); onRefetch(); } finally { setBusy(false); } };
  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    setMessageSending(true);
    try { await sendMessageToAgent(agent.id, messageText.trim()); setMessageText(""); readTextFile(agent.id, `${agent.workspace}/.founder/INBOX.md`).then(setInboxContent).catch(() => {}); }
    finally { setMessageSending(false); }
  };
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

  // Overview helpers
  const hasActiveTasks = taskBoard?.columns.some(c => (c.column === "In Progress" || c.column === "To Do") && c.tasks.length > 0);
  const gitHasChanges = gitStatus?.is_repo && (gitStatus?.changed_files ?? 0) > 0;

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
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3 flex-wrap pb-4" style={{ borderBottom: "1px solid var(--border-default)", paddingBottom: 16 }}>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-medium" style={{ background: `color-mix(in srgb, ${config.color} 10%, transparent)`, color: config.color }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: config.color }} />
          {config.label}
        </div>

        <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          Last active {lastActive}
        </span>

        {agent.status === "running" && nextCheckIn !== "Soon" && (
          <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            · Next in {nextCheckIn}
          </span>
        )}

        {totalCost > 0 && (
          <span className="text-[13px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
            · ${totalCost.toFixed(2)} spent
          </span>
        )}

        {agent.total_sessions > 0 && (
          <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            · {agent.total_sessions} session{agent.total_sessions !== 1 ? "s" : ""}
          </span>
        )}

        {sessions.length > 0 && sessions[0].summary === "Nothing to do" && (
          <span className="text-[13px] italic" style={{ color: "var(--text-tertiary)" }}>
            · Last session: idle
          </span>
        )}
      </div>

      {/* Workspace health warning */}
      {wsHealth && !wsHealth.healthy && (
        <div
          className="rounded-xl p-4 border flex gap-3 mt-4"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)", borderLeftWidth: 3, borderLeftColor: "var(--status-working)" }}
        >
          <FolderCheck size={20} className="shrink-0 mt-0.5" style={{ color: "var(--status-working)" }} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
              {!wsHealth.workspace_exists ? "Workspace directory missing" : !wsHealth.founder_exists ? ".founder directory missing" : `Missing files: ${wsHealth.missing_files.join(", ")}`}
            </p>
            <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
              Your co-founder may not work correctly without these files.
            </p>
          </div>
          <button
            onClick={handleRepair}
            disabled={repairing}
            className="shrink-0 px-3 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer disabled:opacity-50"
            style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
          >
            {repairing ? "Repairing..." : "Auto-repair"}
          </button>
        </div>
      )}

      {/* Error recovery banner */}
      {agent.consecutive_errors > 0 && (
        <div
          className="rounded-xl p-4 border flex gap-3 mt-4"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)", borderLeftWidth: 3, borderLeftColor: agent.consecutive_errors >= 5 ? "var(--status-error)" : "var(--status-paused)" }}
        >
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
              <p className="text-[13px] mt-1" style={{ color: "var(--text-tertiary)" }}>
                Last error: {formatRelativeTime(agent.last_error_at)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Live output — compact inline indicator */}
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
            <div
              className="flex items-center gap-2.5 cursor-pointer group"
              onClick={() => setShowLive((v) => !v)}
              style={{ minHeight: 32 }}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: "var(--status-active)" }} />
              <span
                className="text-[14px] truncate flex-1 min-w-0"
                style={{ color: "var(--text-secondary)" }}
              >
                {latestMsg}
              </span>
              {sessionProgress && (
                <span className="text-[12px] font-mono shrink-0 flex items-center gap-2" style={{ color: "var(--text-tertiary)" }}>
                  <span>{sessionProgress.turn}/{sessionProgress.maxTurns}</span>
                  <span>{Math.floor(sessionProgress.elapsedSecs / 60)}:{String(sessionProgress.elapsedSecs % 60).padStart(2, "0")}</span>
                  <div className="w-16 h-1 rounded-full overflow-hidden" style={{ background: "var(--bg-inset)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ background: "var(--status-active)", width: `${Math.min(100, (sessionProgress.turn / sessionProgress.maxTurns) * 100)}%` }}
                    />
                  </div>
                </span>
              )}
            </div>

            {showLive && (
              <div
                ref={liveContainerRef}
                className="mt-2 rounded-lg overflow-hidden"
                style={{ maxHeight: 200, overflowY: "auto", overflowAnchor: "none" }}
              >
                <div className="space-y-0.5 pl-4">
                  {liveOutput.slice(0, -1).map((entry, i) => {
                    const isThinking = entry.type === "assistant" && entry.message.startsWith("Thinking");
                    if (isThinking) return null;

                    const msg = entry.type === "session_start" ? "Checking in..."
                      : entry.type === "tool_call" ? entry.message
                      : entry.type === "assistant" ? entry.message
                      : entry.type === "retry" ? "Retrying..."
                      : entry.type === "tempo_change" ? entry.message
                      : entry.type === "result" ? "Finished this step"
                      : entry.message;

                    return (
                      <div
                        key={i}
                        className="text-[13px] truncate"
                        style={{ color: "var(--text-tertiary)", lineHeight: "24px" }}
                      >
                        {msg}
                      </div>
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
              <span className="text-[11px] px-1.5 rounded-full font-semibold" style={{ background: "var(--bg-inset)", color: "var(--text-tertiary)" }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ===== OVERVIEW TAB ===== */}
      {activeTab === "overview" && (
        <>
          {/* Spend stats row */}
          {spend && (spend.daily > 0 || spend.weekly > 0 || spend.total > 0) && (
            <div className="flex items-center gap-4 mb-5 text-[13px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
              <span>${spend.daily.toFixed(2)} today</span>
              <span>· ${spend.weekly.toFixed(2)} this week</span>
              <span>· ${spend.total.toFixed(2)} total</span>
            </div>
          )}

          {/* Blocked banner */}
          {latestSession?.outcome === "blocked" && (
            <div className="rounded-xl p-4 border flex gap-3 mb-4" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)", borderLeftWidth: 3, borderLeftColor: "var(--status-working)" }}>
              <AlertTriangle size={20} className="shrink-0 mt-0.5" style={{ color: "var(--status-working)" }} />
              <div className="min-w-0">
                <p className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>Co-founder is blocked</p>
                <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>{latestSession.summary || "Review the latest session details for blocker context."}</p>
              </div>
            </div>
          )}

          {/* Git changes alert */}
          {gitHasChanges && (
            <div className="rounded-lg px-4 py-2.5 mb-4 flex items-center gap-3" style={{ background: "var(--bg-inset)" }}>
              <GitBranch size={14} style={{ color: "var(--text-tertiary)" }} />
              <span className="text-[13px] flex-1" style={{ color: "var(--text-secondary)" }}>
                {gitStatus!.changed_files} file{gitStatus!.changed_files !== 1 ? "s" : ""} changed
                {gitStatus!.branch ? ` on ${gitStatus!.branch}` : ""}
              </span>
              <button
                onClick={async () => { const diff = await gitGetDiff(agent.id); setGitDiff(diff || "No changes."); }}
                className="text-[12px] font-medium cursor-pointer"
                style={{ color: "var(--text-secondary)" }}
              >
                View diff
              </button>
              <button
                disabled={undoing}
                onClick={async () => {
                  const confirmed = window.confirm("Undo the last session? This will hard reset to the pre-session commit.");
                  if (!confirmed) return;
                  setUndoing(true);
                  try {
                    const msg = await gitUndoLastSession(agent.id);
                    window.alert(msg);
                    gitGetStatus(agent.id).then(setGitStatus).catch(() => {});
                  } catch (e) { window.alert(`Undo failed: ${e instanceof Error ? e.message : String(e)}`); }
                  setUndoing(false);
                }}
                className="text-[12px] font-medium cursor-pointer disabled:opacity-50"
                style={{ color: "var(--status-error)" }}
              >
                {undoing ? "Undoing..." : "Undo last session"}
              </button>
            </div>
          )}

          {gitDiff !== null && (
            <div className="rounded-xl border overflow-hidden mb-4" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
              <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--border-default)" }}>
                <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>Diff</span>
                <button onClick={() => setGitDiff(null)} className="text-[12px] cursor-pointer" style={{ color: "var(--text-tertiary)" }}>Close</button>
              </div>
              <pre className="p-3 text-[12px] font-mono overflow-auto max-h-96 whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{gitDiff}</pre>
            </div>
          )}

          {/* Last session card */}
          {latestSession && latestSession.summary !== "Nothing to do" && (
            <div className="mb-5">
              <h2 className="text-[15px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Latest update</h2>
              <div className="rounded-xl border p-4" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
                <p className="text-[14px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {latestSession.summary}
                </p>
                <div className="flex items-center gap-3 mt-3 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                  <span>{formatSessionDate(latestSession.started_at)}</span>
                  <span>· {latestSession.turns} turns</span>
                  {latestSession.cost_usd > 0 && <span>· ${latestSession.cost_usd.toFixed(4)}</span>}
                  <span className="px-2 py-0.5 rounded-full font-medium" style={{ background: `color-mix(in srgb, ${OUTCOME_CONFIG[latestSession.outcome].color} 10%, transparent)`, color: OUTCOME_CONFIG[latestSession.outcome].color }}>
                    {OUTCOME_CONFIG[latestSession.outcome].label}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Recent activity */}
          {activity.length > 0 && (
            <div className="mb-5">
              <h2 className="text-[15px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Recent actions</h2>
              <div className="flex flex-col gap-2">
                {activity.slice(0, 5).map((entry, i) => {
                  const Icon = ICON_MAP[entry.icon] ?? Wrench;
                  return (
                    <div key={`activity-${i}`} className="flex items-start gap-3 px-3 py-2 rounded-lg" style={{ background: "var(--bg-surface)" }}>
                      <Icon size={16} className="shrink-0 mt-0.5" style={{ color: "var(--text-tertiary)" }} />
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{entry.title}</span>
                        {entry.description && <span className="text-[13px] ml-1" style={{ color: "var(--text-tertiary)" }}>— {truncate(entry.description, 80)}</span>}
                      </div>
                    </div>
                  );
                })}
                {activity.length > 5 && (
                  <p className="text-[12px] pl-3" style={{ color: "var(--text-tertiary)" }}>+ {activity.length - 5} more actions</p>
                )}
              </div>
            </div>
          )}

          {/* Priorities (inline tasks) */}
          {hasActiveTasks && taskBoard && (
            <div className="mb-5">
              <h2 className="text-[15px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Priorities</h2>
              <div className="space-y-1.5">
                {taskBoard.columns
                  .filter(col => col.column === "In Progress" || col.column === "To Do")
                  .flatMap(col => col.tasks.map(task => ({ task, column: col.column })))
                  .slice(0, 8)
                  .map(({ task, column }, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg group" style={{ background: "var(--bg-surface)" }}>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: column === "In Progress" ? "var(--status-active)" : "var(--border-default)" }}
                      />
                      <span className="text-[13px] flex-1 min-w-0 truncate" style={{ color: "var(--text-secondary)" }}>{task}</span>
                      <span className="text-[11px] shrink-0" style={{ color: "var(--text-tertiary)" }}>{column}</span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {taskBoard.columns
                          .filter(c => c.column !== column)
                          .slice(0, 2)
                          .map(target => (
                            <button
                              key={target.column}
                              onClick={async () => {
                                await moveTask(agent.id, task, column, target.column);
                                getTaskBoard(agent.id).then(setTaskBoard).catch(() => {});
                              }}
                              className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer flex items-center gap-0.5"
                              style={{ background: "var(--bg-inset)", color: "var(--text-tertiary)" }}
                              title={`Move to ${target.column}`}
                            >
                              <ArrowRight size={9} /> {target.column}
                            </button>
                          ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* No activity state */}
          {!latestSession && activity.length === 0 && (
            <p className="text-[14px] mb-5" style={{ color: "var(--text-tertiary)" }}>No activity yet. Start your co-founder to begin working.</p>
          )}

          {/* Past sessions */}
          <div style={{ marginTop: 8 }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>Past sessions</h2>
              <button className={ghostButton} style={{ color: "var(--text-secondary)" }} onClick={() => onShareJourney(agent)}>
                <Share2 size={14} strokeWidth={2} /> Share journey
              </button>
            </div>
            {sessions.length === 0 ? (
              <p className="text-[14px]" style={{ color: "var(--text-tertiary)" }}>No work sessions yet.</p>
            ) : (
              <div className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
                {sessions.map((session, idx) => {
                  const outcomeConfig = OUTCOME_CONFIG[session.outcome];
                  const isExpanded = expandedSessionId === session.id;
                  return (
                    <div
                      key={session.id}
                      onClick={() => setExpandedSessionId((id) => (id === session.id ? null : session.id))}
                      className="cursor-pointer transition-all duration-150 ease-out"
                      style={{ minHeight: 48, padding: "12px 16px", borderBottom: idx < sessions.length - 1 ? "1px solid var(--border-default)" : "none" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0 flex items-center gap-3">
                          <span className="text-[14px] shrink-0" style={{ color: "var(--text-primary)" }}>{formatSessionDate(session.started_at)}</span>
                          <span className="text-[14px] truncate" style={{ color: "var(--text-secondary)" }}>- {truncate(session.summary || "No summary", 60)}</span>
                          <span className="shrink-0 px-2 py-0.5 rounded text-[12px] font-medium" style={{ background: "var(--bg-inset)", color: "var(--text-tertiary)" }}>{formatSessionDuration(session.started_at, session.ended_at)}</span>
                          <span className="shrink-0 px-2 py-0.5 rounded-full text-[12px] font-medium" style={{ background: `color-mix(in srgb, ${outcomeConfig.color} 10%, transparent)`, color: outcomeConfig.color }}>{outcomeConfig.label}</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-default)" }}>
                          <p className="text-[14px] mb-2" style={{ color: "var(--text-secondary)" }}>{session.summary || "No summary"}</p>
                          <div className="flex items-center gap-4 text-[13px] mb-2" style={{ color: "var(--text-tertiary)" }}>
                            <span>{session.turns} turns</span>
                            {(session.input_tokens > 0 || session.output_tokens > 0) && (
                              <span>{((session.input_tokens + session.output_tokens) / 1000).toFixed(1)}K tokens</span>
                            )}
                            {session.cost_usd > 0 && (
                              <span className="font-medium">${session.cost_usd.toFixed(4)}</span>
                            )}
                          </div>
                          {session.events_json && (() => {
                            const timeline = parseSessionTimeline(session.events_json);
                            if (timeline.length === 0) return null;
                            return (
                              <div className="rounded-lg overflow-hidden" style={{ background: "var(--bg-inset)" }}>
                                {timeline.map((entry, ti) => (
                                    <div key={ti} className="flex items-start gap-2.5 px-3 py-1.5 text-[13px]" style={{ borderBottom: ti < timeline.length - 1 ? "1px solid var(--border-default)" : "none" }}>
                                      <span className="shrink-0 w-4 text-center" style={{ color: "var(--text-tertiary)" }}>{ICON_CHAR[entry.icon] ?? "·"}</span>
                                      <div className="min-w-0 flex-1">
                                        <span style={{ color: "var(--text-secondary)" }}>{entry.title}{entry.description ? `: ${entry.description}` : ""}</span>
                                        {entry.detail && (
                                          <p className="mt-1 text-[12px] whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                                            {truncate(entry.detail, 500)}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== INBOX TAB ===== */}
      {activeTab === "inbox" && (
        <div className="space-y-4">
          <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>Inbox</h2>
          <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Messages are delivered on the next check-in.
          </p>
          <div className="flex gap-2">
            <input
              type="text" value={messageText} onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Type a message for your co-founder..."
              className="flex-1 h-10 px-3 rounded-lg text-[14px]"
              style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none" }}
            />
            <button onClick={handleSendMessage} disabled={messageSending || !messageText.trim()}
              className="h-10 px-4 rounded-lg text-[14px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--text-primary)", color: "var(--bg-base)" }}>
              {messageSending ? "Sending..." : "Send"}
            </button>
          </div>
          {inboxContent && inboxContent.includes("---") && (
            <div className="rounded-xl border p-4" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
              <h3 className="text-[15px] font-medium mb-2" style={{ color: "var(--text-primary)" }}>Pending messages</h3>
              <pre className="text-[13px] font-mono whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{inboxContent}</pre>
            </div>
          )}
        </div>
      )}

      {/* ===== SCHEDULE TAB ===== */}
      {activeTab === "schedule" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>Schedule</h2>
              <p className="text-[13px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                Your co-founder's daily agenda. Both of you can add entries — they show up as commitments in each work session.
              </p>
            </div>
            <button
              onClick={() => setShowAddSchedule(!showAddSchedule)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium cursor-pointer"
              style={{ background: "var(--accent)", color: "white" }}
            >
              <Plus size={14} /> Add entry
            </button>
          </div>

          {showAddSchedule && (
            <div className="rounded-xl border p-4 space-y-3" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
              <div className="flex gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] font-medium" style={{ color: "var(--text-tertiary)" }}>Time</label>
                  <input
                    type="time" value={newScheduleTime} onChange={(e) => setNewScheduleTime(e.target.value)}
                    className="h-9 px-2.5 rounded-lg text-[14px] outline-none"
                    style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                  />
                </div>
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[12px] font-medium" style={{ color: "var(--text-tertiary)" }}>What should happen</label>
                  <input
                    type="text" value={newScheduleAction} onChange={(e) => setNewScheduleAction(e.target.value)}
                    placeholder="e.g. Send me a status update, Check analytics, Email leads..."
                    className="h-9 px-2.5 rounded-lg text-[14px] outline-none w-full"
                    style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] font-medium" style={{ color: "var(--text-tertiary)" }}>Repeat</label>
                  <select
                    value={newScheduleRecurrence}
                    onChange={(e) => setNewScheduleRecurrence(e.target.value as "once" | "daily" | "weekdays" | "weekly")}
                    className="h-9 px-2 rounded-lg text-[14px] outline-none cursor-pointer"
                    style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                  >
                    <option value="once">One time</option>
                    <option value="daily">Every day</option>
                    <option value="weekdays">Weekdays</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (!newScheduleAction.trim()) return;
                    const entry: ScheduleEntry = { id: crypto.randomUUID(), time: newScheduleTime, action: newScheduleAction.trim(), recurrence: newScheduleRecurrence, source: "user", enabled: true };
                    await saveScheduleEntry(agent.id, entry);
                    setScheduleEntries(await getSchedule(agent.id));
                    setNewScheduleAction("");
                    setShowAddSchedule(false);
                  }}
                  className="h-9 px-4 rounded-lg text-[13px] font-medium cursor-pointer"
                  style={{ background: "var(--accent)", color: "white" }}
                >Save</button>
                <button onClick={() => setShowAddSchedule(false)}
                  className="h-9 px-4 rounded-lg text-[13px] font-medium cursor-pointer"
                  style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
                >Cancel</button>
              </div>
            </div>
          )}

          {scheduleEntries.length === 0 && !showAddSchedule ? (
            <div className="rounded-xl border p-8 text-center" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
              <CalendarClock size={32} style={{ color: "var(--text-tertiary)", margin: "0 auto 8px" }} />
              <p className="text-[14px] font-medium" style={{ color: "var(--text-secondary)" }}>No schedule yet</p>
              <p className="text-[13px] mt-1" style={{ color: "var(--text-tertiary)" }}>
                Add entries to give your co-founder a daily routine. They can also schedule their own items.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {scheduleEntries.map((entry) => {
                const now = new Date();
                const [h, m] = entry.time.split(":").map(Number);
                const isPast = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
                const recurrenceLabel = { once: "One time", daily: "Daily", weekdays: "Weekdays", weekly: "Weekly" }[entry.recurrence] ?? entry.recurrence;
                return (
                  <div key={entry.id} className="rounded-xl border p-3 flex items-center gap-3 group"
                    style={{ background: "var(--bg-surface)", borderColor: entry.enabled ? "var(--border-default)" : "var(--border-subtle)", opacity: entry.enabled ? 1 : 0.5 }}>
                    <div className="text-[15px] font-mono font-semibold tabular-nums w-14 shrink-0" style={{ color: isPast && entry.enabled ? "var(--accent)" : "var(--text-primary)" }}>{entry.time}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] leading-snug truncate" style={{ color: "var(--text-primary)" }}>{entry.action}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: entry.source === "user" ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "var(--bg-inset)", color: entry.source === "user" ? "var(--accent)" : "var(--text-tertiary)" }}>
                          {entry.source === "user" ? "You" : "Co-founder"}
                        </span>
                        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{recurrenceLabel}</span>
                        {isPast && entry.enabled && <span className="text-[11px] font-medium" style={{ color: "var(--accent)" }}>Due</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={async () => { await toggleScheduleEntry(agent.id, entry.id, !entry.enabled); setScheduleEntries(await getSchedule(agent.id)); }}
                        className="p-1.5 rounded-md cursor-pointer" style={{ color: "var(--text-tertiary)" }} title={entry.enabled ? "Disable" : "Enable"}>
                        {entry.enabled ? <Pause size={13} /> : <Play size={13} />}
                      </button>
                      <button onClick={async () => { await deleteScheduleEntry(agent.id, entry.id); setScheduleEntries(await getSchedule(agent.id)); }}
                        className="p-1.5 rounded-md cursor-pointer" style={{ color: "var(--status-error)" }} title="Delete">
                        <Trash size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===== SETTINGS TAB ===== */}
      {activeTab === "settings" && (
        <div className="space-y-3">

          {/* ── Identity & Strategy ── */}
          <details open className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
            <summary className="px-4 py-3 cursor-pointer select-none flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
              <ChevronDown size={16} className="shrink-0 chevron-indicator" style={{ color: "var(--text-tertiary)" }} />
              Identity & Strategy
            </summary>
            <div className="px-4 pb-4 space-y-5">
              {/* Mission */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>Mission</span>
                  <span className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>MISSION.md</span>
                </div>
                <p className="text-[12px] mb-2" style={{ color: "var(--text-tertiary)" }}>
                  The north star. Defines what your co-founder is trying to achieve. Update when your goals or strategy change.
                </p>
                <textarea value={missionContent} onChange={(e) => setMissionContent(e.target.value)} rows={5}
                  className="w-full rounded-lg p-3 text-[14px] font-mono resize-y"
                  style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none", minHeight: 80 }}
                />
                <button onClick={() => handleSaveFile("MISSION.md", missionContent)} disabled={fileSaving}
                  className="mt-2 text-[13px] font-medium px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                  style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}>
                  {fileSaving ? "Saving..." : "Save"}
                </button>
              </div>

              <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: 16 }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>Personality</span>
                  <span className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>SOUL.md</span>
                </div>
                <p className="text-[12px] mb-2" style={{ color: "var(--text-tertiary)" }}>
                  Your co-founder's DNA — decision-making style, risk tolerance, communication tone. Rarely needs changing once set.
                </p>
                <textarea value={soulContent} onChange={(e) => setSoulContent(e.target.value)} rows={6}
                  className="w-full rounded-lg p-3 text-[14px] font-mono resize-y"
                  style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none", minHeight: 100 }}
                />
                <button onClick={() => handleSaveFile("SOUL.md", soulContent)} disabled={fileSaving}
                  className="mt-2 text-[13px] font-medium px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                  style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}>
                  {fileSaving ? "Saving..." : "Save"}
                </button>
              </div>

              <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: 16 }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>Memory</span>
                  <span className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>MEMORY.md</span>
                </div>
                <p className="text-[12px] mb-2" style={{ color: "var(--text-tertiary)" }}>
                  Lessons learned, what worked, what failed. Your co-founder updates this automatically after each session — you can also edit it to correct course.
                </p>
                <textarea value={memoryContent} onChange={(e) => setMemoryContent(e.target.value)} rows={6}
                  className="w-full rounded-lg p-3 text-[14px] font-mono resize-y"
                  style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none", minHeight: 100 }}
                />
                <button onClick={() => handleSaveFile("MEMORY.md", memoryContent)} disabled={fileSaving}
                  className="mt-2 text-[13px] font-medium px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                  style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}>
                  {fileSaving ? "Saving..." : "Save"}
                </button>
              </div>

              <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: 16 }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>Budget</span>
                  {agent.daily_budget_usd > 0 && <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>${agent.daily_budget_usd}/day</span>}
                </div>
                <p className="text-[12px] mb-2" style={{ color: "var(--text-tertiary)" }}>
                  Your co-founder will pause automatically when this limit is reached. Set to 0 for unlimited.
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-[14px]" style={{ color: "var(--text-secondary)" }}>$</span>
                  <input type="number" min={0} step={0.5} value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)}
                    className="w-32 rounded-lg outline-none h-10 px-3"
                    style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                  />
                  <button
                    onClick={async () => { const val = parseFloat(budgetInput) || 0; await updateDailyBudget(agent.id, val); onRefetch(); }}
                    className="h-10 px-4 rounded-lg text-[13px] font-medium cursor-pointer"
                    style={{ background: "var(--accent)", color: "white" }}
                  >Save</button>
                </div>
              </div>
            </div>
          </details>

          {/* ── Environment Variables ── */}
          <details className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
            <summary className="px-4 py-3 cursor-pointer select-none flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
              <ChevronDown size={16} className="shrink-0 chevron-indicator" style={{ color: "var(--text-tertiary)" }} />
              Environment Variables
              {envVars.length > 0 && <span className="text-[11px] px-1.5 rounded-full font-semibold ml-1" style={{ background: "var(--bg-inset)", color: "var(--text-tertiary)" }}>{envVars.length}</span>}
            </summary>
            <div className="px-4 pb-4 space-y-3">
              <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                Stored securely. Your co-founder can use these but they never appear in logs.
              </p>
              <div className="flex gap-2">
                <input type="text" value={newEnvKey} onChange={(e) => setNewEnvKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
                  placeholder="KEY_NAME" className="w-48 h-10 px-3 rounded-lg text-[14px] font-mono"
                  style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none" }}
                />
                <input type="password" value={newEnvValue} onChange={(e) => setNewEnvValue(e.target.value)}
                  placeholder="value" className="flex-1 h-10 px-3 rounded-lg text-[14px] font-mono"
                  style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none" }}
                />
                <button onClick={handleAddEnvVar} disabled={!newEnvKey.trim()}
                  className="h-10 px-4 rounded-lg text-[14px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: "var(--text-primary)", color: "var(--bg-base)" }}>Add</button>
              </div>
              {envVars.length > 0 && (
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border-default)" }}>
                  {envVars.map((envVar, i) => (
                    <div key={envVar.key} className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: i < envVars.length - 1 ? "1px solid var(--border-default)" : "none" }}>
                      <span className="font-mono text-[14px] font-medium shrink-0" style={{ color: "var(--text-primary)", minWidth: 160 }}>{envVar.key}</span>
                      <span className="flex-1 font-mono text-[14px] truncate cursor-pointer flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}
                        onClick={() => setRevealedKeys((prev) => { const next = new Set(prev); if (next.has(envVar.key)) next.delete(envVar.key); else next.add(envVar.key); return next; })}>
                        {revealedKeys.has(envVar.key) ? <><EyeOff size={13} />{envVar.value}</> : <><Eye size={13} />{"••••••••"}</>}
                      </span>
                      <button onClick={() => handleDeleteEnvVar(envVar.key)} className="text-[13px] cursor-pointer shrink-0" style={{ color: "var(--status-error)" }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>

          {/* ── Integrations ── */}
          <details className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
            <summary className="px-4 py-3 cursor-pointer select-none flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
              <ChevronDown size={16} className="shrink-0 chevron-indicator" style={{ color: "var(--text-tertiary)" }} />
              Integrations
            </summary>
            <div className="px-4 pb-4">
              <IntegrationsPanel agentId={agent.id} />
            </div>
          </details>

          {/* ── Git Safety ── */}
          <details className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
            <summary className="px-4 py-3 cursor-pointer select-none flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
              <ChevronDown size={16} className="shrink-0 chevron-indicator" style={{ color: "var(--text-tertiary)" }} />
              Git Safety
            </summary>
            <div className="px-4 pb-4 space-y-3">
              {gitStatus && !gitStatus.is_repo ? (
                <div className="text-center py-4">
                  <GitBranch size={24} strokeWidth={1.5} className="mx-auto mb-2" style={{ color: "var(--text-tertiary)" }} />
                  <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>Not a Git repository. Initialize one to enable rollback.</p>
                </div>
              ) : gitStatus ? (
                <>
                  <div className="flex items-center gap-4 text-[13px]" style={{ color: "var(--text-secondary)" }}>
                    <span>Branch: <span className="font-mono font-medium">{gitStatus.branch || "detached"}</span></span>
                    <span>{gitStatus.changed_files ?? 0} changed files</span>
                    <span className="font-mono">{gitStatus.head?.slice(0, 8) ?? "—"}</span>
                  </div>
                  {gitStatus.changes && gitStatus.changes.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                      {gitStatus.changes.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-[13px] font-mono">
                          <span className="w-5 text-center font-medium" style={{ color: c.status === "M" ? "var(--status-working)" : c.status === "A" || c.status === "?" ? "var(--status-active)" : "var(--status-error)" }}>{c.status}</span>
                          <span style={{ color: "var(--text-secondary)" }}>{c.file}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button onClick={async () => { setGitStatus(null); gitGetStatus(agent.id).then(setGitStatus).catch(() => {}); }}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium cursor-pointer"
                      style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}>
                      <RefreshCw size={13} /> Refresh
                    </button>
                    <button disabled={undoing}
                      onClick={async () => {
                        const confirmed = window.confirm("Undo the last session? This will hard reset to the pre-session commit.");
                        if (!confirmed) return;
                        setUndoing(true);
                        try { const msg = await gitUndoLastSession(agent.id); window.alert(msg); gitGetStatus(agent.id).then(setGitStatus).catch(() => {}); }
                        catch (e) { window.alert(`Undo failed: ${e instanceof Error ? e.message : String(e)}`); }
                        setUndoing(false);
                      }}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium cursor-pointer disabled:opacity-50"
                      style={{ background: "color-mix(in srgb, var(--status-error) 10%, transparent)", color: "var(--status-error)", border: "1px solid var(--status-error)" }}>
                      <Undo2 size={14} /> {undoing ? "Undoing..." : "Undo last session"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>Loading...</p>
              )}
            </div>
          </details>

          {/* ── Danger Zone ── */}
          <details className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--status-error)" }}>
            <summary className="px-4 py-3 cursor-pointer select-none flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--status-error)" }}>
              <ChevronDown size={16} className="shrink-0 chevron-indicator" />
              Danger Zone
            </summary>
            <div className="px-4 pb-4 space-y-3">
              <div className="flex items-center gap-3">
                <button onClick={async () => { await clearAgentSessions(agent.id); setSessions([]); onRefetch(); }}
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[13px] font-medium cursor-pointer"
                  style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}>
                  Clear session history
                </button>
                <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>{sessions.length} session{sessions.length !== 1 ? "s" : ""}</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={removeFounderFiles} onChange={(e) => setRemoveFounderFiles(e.target.checked)} />
                <span className="text-[14px]" style={{ color: "var(--text-secondary)" }}>Also remove `.founder` files from workspace</span>
              </label>
              <button onClick={handleDelete} disabled={deleting}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-[14px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "var(--status-error)", color: "white" }}>
                <Trash2 size={15} strokeWidth={2} /> {deleting ? "Deleting..." : "Delete co-founder"}
              </button>
            </div>
          </details>

        </div>
      )}

      {/* ===== ARTIFACTS TAB (contextual) ===== */}
      {activeTab === "artifacts" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>Artifacts</h2>
            <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>{artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""}</span>
          </div>
          <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Your co-founder can create artifacts — dashboards, metrics, checklists, and logs — to track progress.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {artifacts.map((artifact) => (
              <div key={artifact.id} className="rounded-xl border p-4" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold uppercase" style={{ background: "var(--bg-inset)", color: "var(--text-tertiary)" }}>{artifact.type}</span>
                  <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>{formatRelativeTime(artifact.updated_at)}</span>
                </div>
                <p className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>{artifact.title}</p>
                {artifact.description && <p className="text-[13px] mt-1" style={{ color: "var(--text-secondary)" }}>{artifact.description}</p>}
                {artifact.type === "metric" && artifact.data != null && (
                  <div className="mt-3 text-[28px] font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {String((artifact.data as Record<string, unknown>)?.value ?? String(artifact.data))}
                  </div>
                )}
                {artifact.type === "checklist" && Array.isArray(artifact.data) && (
                  <ul className="mt-2 space-y-1">
                    {(artifact.data as Array<{ label: string; done: boolean }>).slice(0, 5).map((item, i) => (
                      <li key={i} className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
                        <span className="w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px]"
                          style={{ borderColor: "var(--border-default)", background: item.done ? "var(--status-active)" : "transparent", color: "white" }}>
                          {item.done && "✓"}
                        </span>
                        {item.label}
                      </li>
                    ))}
                  </ul>
                )}
                {artifact.type === "markdown" && (
                  <pre className="mt-2 text-[13px] font-mono whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
                    {truncate(String(artifact.data), 300)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== TOOLS TAB (contextual) ===== */}
      {activeTab === "tools" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>Co-Founder Toolbox</h2>
            <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>{tools.length} tool{tools.length !== 1 ? "s" : ""}</span>
          </div>
          <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Tools your co-founder has built for itself. These compound over time.
          </p>
          <div className="flex flex-col gap-3">
            {tools.map((tool) => (
              <div key={tool.name} className="rounded-xl border p-4 flex items-start gap-3" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
                <Hammer size={18} className="shrink-0 mt-0.5" style={{ color: "var(--text-secondary)" }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>{tool.name}</span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono" style={{ background: "var(--bg-inset)", color: "var(--text-tertiary)" }}>{tool.language}</span>
                    {tool.approved
                      ? <span className="px-2 py-0.5 rounded text-[11px] font-medium" style={{ background: "color-mix(in srgb, var(--status-active) 12%, transparent)", color: "var(--status-active)" }}>Approved</span>
                      : <span className="px-2 py-0.5 rounded text-[11px] font-medium" style={{ background: "color-mix(in srgb, var(--status-paused) 12%, transparent)", color: "var(--status-paused)" }}>Pending</span>}
                  </div>
                  <p className="text-[13px] mt-1" style={{ color: "var(--text-secondary)" }}>{tool.description}</p>
                  <div className="flex items-center gap-3 mt-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                    <span>Used {tool.use_count}x</span>
                    <span>Created {formatRelativeTime(tool.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== REPORTS TAB (contextual) ===== */}
      {activeTab === "reports" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>Daily Reports</h2>
            <button
              onClick={async () => {
                setGeneratingReport(true);
                try { await generateDailyReport(agent.id); const r = await getDailyReports(agent.id); setReports(r); } catch { /* ignore */ }
                setGeneratingReport(false);
              }}
              disabled={generatingReport}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium cursor-pointer disabled:opacity-50"
              style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
            >
              <RefreshCw size={13} className={generatingReport ? "animate-spin" : ""} />
              {generatingReport ? "Generating..." : "Generate now"}
            </button>
          </div>
          <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            A summary of your co-founder's work is generated each morning at 8am.
          </p>
          <div className="flex flex-col gap-4">
            {reports.map((report) => (
              <details key={report.date} className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
                <summary className="px-4 py-3 cursor-pointer flex items-center gap-2 select-none">
                  <Clock size={14} style={{ color: "var(--text-tertiary)" }} />
                  <span className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>{report.date}</span>
                </summary>
                <div className="px-4 pb-4">
                  <div className="prose prose-sm max-w-none text-[14px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {report.content.split("\n").map((line, i) => {
                      if (line.startsWith("# ")) return <h3 key={i} className="text-[16px] font-semibold mt-3 mb-1" style={{ color: "var(--text-primary)" }}>{line.slice(2)}</h3>;
                      if (line.startsWith("## ")) return <h4 key={i} className="text-[14px] font-semibold mt-3 mb-1" style={{ color: "var(--text-primary)" }}>{line.slice(3)}</h4>;
                      if (line.startsWith("| ")) return <pre key={i} className="text-[13px] font-mono" style={{ color: "var(--text-secondary)" }}>{line}</pre>;
                      if (line.startsWith("- ")) return <p key={i} className="ml-3 text-[13px]">{line}</p>;
                      if (line.trim() === "") return <br key={i} />;
                      return <p key={i} className="text-[13px]">{line}</p>;
                    })}
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
