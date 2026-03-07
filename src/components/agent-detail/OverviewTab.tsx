import { useState } from "react";
import {
  Share2,
  AlertTriangle,
  GitBranch,
  ArrowRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import remarkGfm from "remark-gfm";
import type { Agent, WorkSessionLog, GitStatus, TaskBoard } from "@/types";
import {
  gitGetDiff,
  gitGetStatus,
  gitUndoLastSession,
  getTaskBoard,
  moveTask,
} from "@/lib/api";

const summaryMdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold" style={{ color: "var(--text-primary)" }}>{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <h3 className="text-[14px] font-semibold mt-2 mb-1" style={{ color: "var(--text-primary)" }}>{children}</h3>,
  h2: ({ children }) => <h3 className="text-[14px] font-semibold mt-2 mb-1" style={{ color: "var(--text-primary)" }}>{children}</h3>,
  h3: ({ children }) => <h4 className="text-[13px] font-semibold mt-1.5 mb-0.5" style={{ color: "var(--text-primary)" }}>{children}</h4>,
  ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code: ({ children, className }) => {
    if (className?.includes("language-")) {
      return (
        <pre className="rounded-lg px-3 py-2 my-1.5 overflow-x-auto text-[12px] leading-5" style={{ background: "var(--bg-inset)", color: "var(--text-primary)", fontFamily: "'Geist Mono', monospace" }}>
          <code>{children}</code>
        </pre>
      );
    }
    return <code className="px-1 py-0.5 rounded text-[12px]" style={{ background: "var(--bg-inset)", color: "var(--text-primary)", fontFamily: "'Geist Mono', monospace" }}>{children}</code>;
  },
  a: ({ href, children }) => <a href={href} onClick={(e) => { e.preventDefault(); if (href) openUrl(href).catch(console.error); }} className="underline underline-offset-2 cursor-pointer hover:opacity-70 transition-opacity" style={{ color: "var(--accent-primary, #6366f1)" }}>{children}</a>,
  hr: () => <hr className="my-2" style={{ borderColor: "var(--border-default)" }} />,
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
  interrupted: { label: "Interrupted", color: "var(--status-error)" },
};

const ICON_CHAR: Record<string, string> = { file: "✎", search: "⌕", terminal: "▸", agent: "⚙", message: "💬", done: "✓", tool: "·" };

interface StoredEvent {
  type?: string;
  raw?: string;
}

interface ClassifiedEvent {
  icon: string;
  title: string;
  description: string;
  detail?: string;
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len).trim() + "...";
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

function parseSessionTimeline(eventsJson: string): ClassifiedEvent[] {
  let events: StoredEvent[] = [];
  try { events = JSON.parse(eventsJson) as StoredEvent[]; } catch { return []; }
  return events.map(classifyEvent).filter((e): e is ClassifiedEvent => e !== null);
}

const ghostButton =
  "flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ease-out cursor-pointer";

export interface OverviewTabProps {
  agent: Agent;
  sessions: WorkSessionLog[];
  gitStatus: GitStatus | null;
  setGitStatus: (s: GitStatus | null) => void;
  taskBoard: TaskBoard | null;
  setTaskBoard: (t: TaskBoard | null) => void;
  onShareJourney: (agent: Agent) => Promise<void> | void;
}

export default function OverviewTab({
  agent,
  sessions,
  gitStatus,
  setGitStatus,
  taskBoard,
  setTaskBoard,
  onShareJourney,
}: OverviewTabProps) {
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [gitDiff, setGitDiff] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [showFullBlocker, setShowFullBlocker] = useState(false);
  const [showFullUpdate, setShowFullUpdate] = useState(false);

  const latestSession = sessions[0];

  const hasActiveTasks = taskBoard?.columns.some(c => (c.column === "In Progress" || c.column === "To Do") && c.tasks.length > 0);
  const gitHasChanges = gitStatus?.is_repo && (gitStatus?.changed_files ?? 0) > 0;

  return (
    <>
      {latestSession?.outcome === "blocked" && (() => {
        const text = latestSession.summary || "Review the latest session details for blocker context.";
        const long = text.length > 200;
        return (
          <div className="rounded-xl p-4 flex gap-3 mb-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}>
            <AlertTriangle size={20} className="shrink-0 mt-0.5" style={{ color: "var(--status-working)" }} />
            <div className="min-w-0">
              <p className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>Co-founder is blocked</p>
              <div className={`text-[14px] ${!showFullBlocker && long ? "line-clamp-3" : ""}`} style={{ color: "var(--text-secondary)" }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={summaryMdComponents}>{text}</ReactMarkdown>
              </div>
              {long && (
                <button
                  onClick={() => setShowFullBlocker((v) => !v)}
                  className="text-[13px] mt-1 cursor-pointer"
                  style={{ color: "var(--text-tertiary)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-tertiary)")}
                >
                  {showFullBlocker ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          </div>
        );
      })()}

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

      {latestSession && latestSession.summary !== "Nothing to do" && (() => {
        const text = latestSession.summary || "";
        const long = text.length > 200;
        return (
          <div className="mb-5">
            <h2 className="text-[15px] font-semibold mb-2" style={{ color: "var(--text-primary)" }}>Latest update</h2>
            <div className={`text-[14px] leading-relaxed mb-1.5 ${!showFullUpdate && long ? "line-clamp-3" : ""}`} style={{ color: "var(--text-secondary)" }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={summaryMdComponents}>{text}</ReactMarkdown>
            </div>
            {long && (
              <button
                onClick={() => setShowFullUpdate((v) => !v)}
                className="text-[13px] cursor-pointer"
                style={{ color: "var(--text-tertiary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-tertiary)")}
              >
                {showFullUpdate ? "Show less" : "Show more"}
              </button>
            )}
            <div className="flex items-center gap-2 text-[12px] mt-1.5" style={{ color: "var(--text-tertiary)" }}>
              <span>{formatSessionDate(latestSession.started_at)}</span>
              <span>·</span>
              <span>{latestSession.turns} turns</span>
              <span>·</span>
              <span className="font-medium" style={{ color: OUTCOME_CONFIG[latestSession.outcome].color }}>
                {OUTCOME_CONFIG[latestSession.outcome].label}
              </span>
            </div>
          </div>
        );
      })()}

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
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: column === "In Progress" ? "var(--status-active)" : "var(--border-default)" }} />
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

      {!latestSession && (
        <p className="text-[14px] mb-5" style={{ color: "var(--text-tertiary)" }}>No activity yet. Start your co-founder to begin working.</p>
      )}

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
                  style={{ borderBottom: idx < sessions.length - 1 ? "1px solid var(--border-default)" : "none" }}
                >
                  <div
                    onClick={() => setExpandedSessionId((id) => (id === session.id ? null : session.id))}
                    className="cursor-pointer transition-all duration-150 ease-out"
                    style={{ minHeight: 48, padding: "12px 16px" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0 flex items-center gap-3">
                        <span className="text-[14px] shrink-0" style={{ color: "var(--text-primary)" }}>{formatSessionDate(session.started_at)}</span>
                        <span className="text-[14px] truncate" style={{ color: "var(--text-secondary)" }}>- {truncate(session.summary || "No summary", 60)}</span>
                        <span className="shrink-0 px-2 py-0.5 rounded text-[12px] font-medium" style={{ background: "var(--bg-inset)", color: "var(--text-tertiary)" }}>{formatSessionDuration(session.started_at, session.ended_at)}</span>
                        <span className="shrink-0 px-2 py-0.5 rounded-full text-[12px] font-medium" style={{ background: `color-mix(in srgb, ${outcomeConfig.color} 10%, transparent)`, color: outcomeConfig.color }}>{outcomeConfig.label}</span>
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="pt-3 pb-3" onClick={(e) => e.stopPropagation()} style={{ padding: "0 16px 12px 16px", borderTop: "1px solid var(--border-default)", background: "var(--bg-surface)" }}>
                      <div className="text-[14px] mb-2 pt-3" style={{ color: "var(--text-secondary)" }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={summaryMdComponents}>{session.summary || "No summary"}</ReactMarkdown>
                      </div>
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
  );
}
