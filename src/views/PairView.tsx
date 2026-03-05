import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Plus,
  Send,
  StopCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Image as ImageIcon,
  ExternalLink,
  X,
  Clock,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sendPairMessage, saveInboxImages, getWorkSessions } from "@/lib/api";
import { type AttachedImage, isImageFile, readFileAsThumbnail, readFileAsBase64 } from "@/lib/imageUtils";
import type {
  Agent,
  PairPreviewDetectedEvent,
  PairSessionEndedEvent,
  PairTurnCompleteEvent,
  WorkSessionLog,
} from "@/types";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PairViewProps {
  agent: Agent;
  sessionId: string;
  onManualEnd: () => Promise<void> | void;
  onNewSession: () => void;
  onSessionEnded: () => void;
  onResumeSession?: (pastSessionId: string) => void;
  initialMessages?: ChatMessage[];
}

interface AgentOutputEvent {
  agent_id?: string;
  session_id?: string;
  type?: string;
  raw?: string;
  message?: string;
}

type ChatMessage =
  | { id: string; role: "user"; text: string; images?: AttachedImage[]; timestamp: number }
  | { id: string; role: "agent"; text: string; isStreaming?: boolean; timestamp: number }
  | { id: string; role: "thinking"; steps: string[]; startTime: number; durationMs?: number; timestamp: number }
  | { id: string; role: "system"; text: string; timestamp: number };

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractAssistantText(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.content === "string" && obj.content.trim()) return obj.content.trim();
  if (typeof obj.result === "string" && obj.result.trim()) return obj.result.trim();

  const tryBlocks = (blocks: unknown): string | null => {
    if (!Array.isArray(blocks)) return null;
    const text = blocks
      .filter((b): b is { type?: unknown; text?: unknown } => !!b && typeof b === "object")
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => String(b.text))
      .join("\n")
      .trim();
    return text || null;
  };

  const fromContent = tryBlocks(obj.content);
  if (fromContent) return fromContent;

  const msg = obj.message;
  if (msg && typeof msg === "object") {
    const fromMsg = tryBlocks((msg as Record<string, unknown>).content);
    if (fromMsg) return fromMsg;
  }

  return null;
}

function extractToolLabel(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "Working…";
  const obj = raw as Record<string, unknown>;
  const tool =
    typeof obj.tool === "string" ? obj.tool :
    typeof obj.name === "string" ? obj.name : "tool";
  const input = obj.input ? JSON.stringify(obj.input) : "";
  const label = input ? `${tool}: ${input}` : tool;
  return label.length > 72 ? label.slice(0, 69) + "…" : label;
}

function formatDuration(ms: number): string {
  const secs = Math.round(ms / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}


// ─── Markdown renderer ───────────────────────────────────────────────────────

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  p: ({ children }) => (
    <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold" style={{ color: "var(--text-primary)" }}>{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => (
    <h2 className="text-[15px] font-semibold mt-3 mb-1" style={{ color: "var(--text-primary)" }}>{children}</h2>
  ),
  h2: ({ children }) => (
    <h2 className="text-[15px] font-semibold mt-3 mb-1" style={{ color: "var(--text-primary)" }}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[13px] font-semibold mt-2.5 mb-0.5 uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <pre
          className="rounded-lg px-3 py-2.5 my-2 overflow-x-auto text-[12px] leading-5"
          style={{ background: "var(--bg-inset)", color: "var(--text-primary)", fontFamily: "'Geist Mono', monospace" }}
        >
          <code>{children}</code>
        </pre>
      );
    }
    return (
      <code
        className="px-1 py-0.5 rounded text-[12px]"
        style={{ background: "var(--bg-inset)", color: "var(--text-primary)", fontFamily: "'Geist Mono', monospace" }}
      >
        {children}
      </code>
    );
  },
  blockquote: ({ children }) => (
    <blockquote
      className="pl-3 my-2 border-l-2"
      style={{ borderColor: "var(--border-strong)", color: "var(--text-tertiary)" }}
    >
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
      style={{ color: "var(--text-primary)" }}
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-3" style={{ borderColor: "var(--border-default)" }} />,
};

function StarburstIcon({ size = 13, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <line
          key={angle}
          x1="12" y1="2" x2="12" y2="8"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
    </svg>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ThinkingBlock({
  msg,
  expanded,
  onToggle,
  isLive,
}: {
  msg: Extract<ChatMessage, { role: "thinking" }>;
  expanded: boolean;
  onToggle: () => void;
  isLive: boolean;
}) {
  const [liveMs, setLiveMs] = useState(Date.now() - msg.startTime);

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setLiveMs(Date.now() - msg.startTime), 500);
    return () => clearInterval(id);
  }, [isLive, msg.startTime]);

  const duration = msg.durationMs != null ? msg.durationMs : liveMs;
  const latestStep = msg.steps[msg.steps.length - 1];

  return (
    <div className="flex items-start gap-2.5">
      <div
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5"
        style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)" }}
      >
        {isLive ? (
          <div className="animate-spin"><StarburstIcon size={13} color="var(--text-tertiary)" /></div>
        ) : (
          <StarburstIcon size={13} color="var(--text-secondary)" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 cursor-pointer select-none group"
          style={{ color: "var(--text-tertiary)" }}
        >
          {isLive ? (
            <span className="text-[13px]">
              {latestStep
                ? <><span className="truncate inline-block max-w-[300px] align-bottom" style={{ color: "var(--text-secondary)" }}>{latestStep}</span>{" "}<span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>{formatDuration(duration)}</span></>
                : <>Thinking… <span className="text-[12px]">{formatDuration(duration)}</span></>
              }
            </span>
          ) : (
            <span className="text-[13px] flex items-center gap-1">
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span>Thought for {formatDuration(duration)}</span>
              <span className="text-[12px]">· {msg.steps.length} step{msg.steps.length !== 1 ? "s" : ""}</span>
            </span>
          )}
        </button>

        {expanded && msg.steps.length > 0 && (
          <div
            className="mt-2 pl-3 border-l space-y-1"
            style={{ borderColor: "var(--border-default)" }}
          >
            {msg.steps.map((step, i) => (
              <p key={i} className="text-[12px] leading-relaxed truncate" style={{ color: "var(--text-tertiary)" }}>
                {step}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2.5 items-center">
      <div
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5"
        style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)" }}
      >
        <div className="animate-spin"><StarburstIcon size={13} color="var(--text-tertiary)" /></div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="thinking-dot"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

// ─── Session history list ────────────────────────────────────────────────────

function SessionHistoryList({
  sessions,
  searchQuery,
  onResume,
}: {
  sessions: WorkSessionLog[];
  searchQuery: string;
  onResume: (session: WorkSessionLog) => void;
}) {
  const filtered = sessions.filter(
    (s) => !searchQuery || s.summary.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (filtered.length === 0) {
    return (
      <p className="text-[12px] text-center py-6" style={{ color: "var(--text-tertiary)" }}>
        No past sessions
      </p>
    );
  }

  const groups: Record<string, WorkSessionLog[]> = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  for (const s of filtered) {
    const d = new Date(s.started_at);
    let label: string;
    if (d >= today) label = "Today";
    else if (d >= yesterday) label = "Yesterday";
    else if (d >= weekAgo) label = "This Week";
    else label = "Older";
    (groups[label] ??= []).push(s);
  }

  const order = ["Today", "Yesterday", "This Week", "Older"];
  return (
    <>
      {order
        .filter((g) => groups[g]?.length)
        .map((groupLabel) => (
          <div key={groupLabel}>
            <p
              className="px-3 pt-2 pb-1 text-[11px] font-medium"
              style={{ color: "var(--text-tertiary)" }}
            >
              {groupLabel}
            </p>
            {groups[groupLabel].map((s) => (
              <button
                key={s.id}
                onClick={() => void onResume(s)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--status-active)", flexShrink: 0 }}>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span className="text-[13px] truncate flex-1">
                  {s.summary === "Pair session started" ? `Session ${s.session_id.slice(0, 8)}` : s.summary.length > 40 ? s.summary.slice(0, 37) + "\u2026" : s.summary}
                </span>
              </button>
            ))}
          </div>
        ))}
    </>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function PairView({
  agent,
  sessionId,
  onManualEnd,
  onNewSession,
  onSessionEnded,
  onResumeSession,
  initialMessages,
}: PairViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [canSend, setCanSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [sendError, setSendError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [pairSessions, setPairSessions] = useState<WorkSessionLog[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  const activeThinkingIdRef = useRef<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openedUrlsRef = useRef<Set<string>>(new Set());

  const [chatTitle, setChatTitle] = useState("New Chat");
  const titleDerivedRef = useRef(false);

  // ── Reset on session change ──────────────────────────────────────────────
  useEffect(() => {
    setSessionEnded(false);
    setCanSend(false);
    setInput("");
    setPreviewUrl(null);
    setMessages(initialMessages ?? []);
    setAttachedImages([]);
    setExpandedThinking({});
    setSendError(null);
    setHistoryOpen(false);
    setHistorySearch("");
    if (initialMessages?.length) {
      setChatTitle("Resumed Session");
      titleDerivedRef.current = false;
    } else {
      setChatTitle("New Chat");
      titleDerivedRef.current = false;
    }
    activeThinkingIdRef.current = null;
    openedUrlsRef.current = new Set();
  }, [sessionId, initialMessages]);

  // ── Derive chat title from first agent response ──────────────────────────
  useEffect(() => {
    if (titleDerivedRef.current) return;
    const agentMsgs = messages.filter((m) => m.role === "agent") as Extract<ChatMessage, { role: "agent" }>[];
    if (agentMsgs.length === 0) return;
    const firstText = agentMsgs[0].text;
    if (!firstText || firstText.length < 8) return;
    const cleaned = firstText.replace(/^#+\s*/gm, "").replace(/\*+/g, "").trim();
    const firstSentence = cleaned.split(/[.!?\n]/)[0]?.trim() ?? "";
    const title = firstSentence.length > 40
      ? firstSentence.slice(0, 37) + "…"
      : firstSentence || "New Chat";
    if (title && title !== "New Chat") {
      setChatTitle(title);
      titleDerivedRef.current = true;
    }
  }, [messages]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const handleChatScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distanceFromBottom > 150;
  }, []);

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, [messages]);

  // ── Auto-grow textarea ───────────────────────────────────────────────────
  const maxTextareaHeight = typeof window !== "undefined" ? Math.round(window.innerHeight * 0.35) : 300;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const desired = el.scrollHeight;
    el.style.height = `${Math.min(desired, maxTextareaHeight)}px`;
    el.style.overflowY = desired > maxTextareaHeight ? "auto" : "hidden";
  }, [input, maxTextareaHeight]);

  // ── Event listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    const unlisten: Array<() => void> = [];

    listen<AgentOutputEvent>("agent-output", (event) => {
      if (!active) return;
      const p = event.payload;
      if (p?.agent_id !== agent.id || p?.session_id !== sessionId) return;
      const t = p.type;
      if (!t) return;

      if (t === "tool_call" || t === "retry") {
        const label =
          t === "retry"
            ? "Retrying after a transient error…"
            : (() => {
                try {
                  return extractToolLabel(JSON.parse(p.raw ?? "{}"));
                } catch {
                  return "Working…";
                }
              })();

        setMessages((prev) => {
          const thinkingId = activeThinkingIdRef.current;
          if (thinkingId) {
            return prev.map((m) =>
              m.id === thinkingId && m.role === "thinking"
                ? { ...m, steps: [...m.steps, label] }
                : m,
            );
          }
          const id = `think-${Date.now()}-${Math.random()}`;
          activeThinkingIdRef.current = id;
          return [
            ...prev.slice(-199),
            { id, role: "thinking", steps: [label], startTime: Date.now(), timestamp: Date.now() } as ChatMessage,
          ];
        });
        return;
      }

      if (t === "assistant") {
        try {
          const raw = JSON.parse(p.raw ?? "{}");
          const text = extractAssistantText(raw);
          if (!text) return;

          setMessages((prev) => {
            const trimmed = prev.slice(-199);
            const last = trimmed[trimmed.length - 1];
            if (last?.role === "agent" && last.isStreaming) {
              const next = [...trimmed];
              next[next.length - 1] = { ...last, text, timestamp: Date.now() };
              return next;
            }
            return [
              ...trimmed,
              {
                id: `agent-${Date.now()}-${Math.random()}`,
                role: "agent",
                text,
                isStreaming: true,
                timestamp: Date.now(),
              } as ChatMessage,
            ];
          });
        } catch {
          /* ignore parse error */
        }
      }
    })
      .then((fn) => { if (active) unlisten.push(fn); })
      .catch(() => {});

    listen<PairTurnCompleteEvent>("pair-turn-complete", (event) => {
      if (!active) return;
      const p = event.payload;
      if (p.agent_id !== agent.id || p.session_id !== sessionId) return;

      const thinkingId = activeThinkingIdRef.current;
      activeThinkingIdRef.current = null;

      setMessages((prev) => {
        let next = [...prev];

        if (thinkingId) {
          next = next.map((m) => {
            if (m.id === thinkingId && m.role === "thinking") {
              return { ...m, durationMs: Date.now() - m.startTime };
            }
            return m;
          });
        }

        const last = next[next.length - 1];
        if (last?.role === "agent" && last.isStreaming) {
          next[next.length - 1] = { ...last, isStreaming: false };
        }

        return next;
      });

      setCanSend(true);
    })
      .then((fn) => { if (active) unlisten.push(fn); })
      .catch(() => {});

    listen<PairPreviewDetectedEvent>("pair-preview-detected", (event) => {
      if (!active) return;
      const p = event.payload;
      if (p.agent_id !== agent.id || p.session_id !== sessionId) return;
      setPreviewUrl(p.url);
    })
      .then((fn) => { if (active) unlisten.push(fn); })
      .catch(() => {});

    listen<PairSessionEndedEvent>("pair-session-ended", (event) => {
      if (!active) return;
      const p = event.payload;
      if (p.agent_id !== agent.id || p.session_id !== sessionId) return;
      setCanSend(false);
      setSessionEnded(true);
      if (p.summary && !p.summary.startsWith("Pair session ended by user")) {
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, role: "system", text: p.summary, timestamp: Date.now() },
        ]);
      }
      onSessionEnded();
    })
      .then((fn) => { if (active) unlisten.push(fn); })
      .catch(() => {});

    return () => {
      active = false;
      unlisten.forEach((fn) => fn());
    };
  }, [agent.id, onSessionEnded, sessionId]);

  // ── Auto-open preview ────────────────────────────────────────────────────
  useEffect(() => {
    if (!previewUrl || openedUrlsRef.current.has(previewUrl)) return;
    openedUrlsRef.current.add(previewUrl);
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  }, [previewUrl]);

  // ── History dropdown ────────────────────────────────────────────────────

  const historyStaleRef = useRef(true);
  // Mark history stale when a new session starts
  useEffect(() => { historyStaleRef.current = true; }, [sessionId]);

  useEffect(() => {
    if (!historyOpen) return;
    if (!historyStaleRef.current && pairSessions.length > 0) return;
    setLoadingHistory(true);
    getWorkSessions(agent.id).then((sessions) => {
      const pair = sessions.filter((s) => s.mode === "pair" && s.session_id !== sessionId);
      setPairSessions(pair);
      historyStaleRef.current = false;
      setLoadingHistory(false);
    }).catch(() => setLoadingHistory(false));
  }, [historyOpen, agent.id, sessionId]);

  useEffect(() => {
    if (!historyOpen) return;
    const handler = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [historyOpen]);

  const handleResumeSession = (pastSession: WorkSessionLog) => {
    setHistoryOpen(false);
    onResumeSession?.(pastSession.session_id);
  };

  // ── Image attachment ─────────────────────────────────────────────────────
  const MAX_IMAGES = 10;

  const attachFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(isImageFile);
    if (arr.length === 0) return;

    const loaded: AttachedImage[] = await Promise.all(
      arr.map(async (f) => ({
        id: `img-${Date.now()}-${Math.random()}`,
        name: f.name,
        dataUrl: await readFileAsThumbnail(f),
        rawBase64: await readFileAsBase64(f),
      })),
    );
    setAttachedImages((prev) => {
      const slotsLeft = MAX_IMAGES - prev.length;
      if (slotsLeft <= 0) return prev;
      return [...prev, ...loaded.slice(0, slotsLeft)];
    });
    textareaRef.current?.focus();
  }, []);

  const removeImage = (id: string) => {
    setAttachedImages((prev) => prev.filter((i) => i.id !== id));
  };

  const handleDragOver = (e: React.DragEvent) => {
    // On macOS Finder drags, item.type is "" during dragover — accept any file drag
    const hasFiles = [...e.dataTransfer.items].some(
      (i) => i.kind === "file" && (i.type === "" || i.type.startsWith("image/"))
    );
    if (hasFiles) {
      e.preventDefault();
      setIsDragging(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    // Filter for images at drop time when MIME types are available
    const imageFiles = [...e.dataTransfer.files].filter((f) => isImageFile(f));
    if (imageFiles.length > 0) void attachFiles(imageFiles);
  };

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const msg = input.trim();
    if ((!msg && attachedImages.length === 0) || !canSend || sending || sessionEnded) return;

    setSending(true);
    const imgs = [...attachedImages];
    let textToSend = msg;

    if (imgs.length > 0) {
      const imagesWithData = imgs
        .filter((i) => i.rawBase64)
        .map((i) => ({ name: i.name, data: i.rawBase64! }));

      if (imagesWithData.length > 0) {
        try {
          const savedPaths = await saveInboxImages(agent.id, imagesWithData);
          const pathList = savedPaths.map((p) => `  - ${p}`).join("\n");
          textToSend = `${msg}\n\n[Attached images — saved to disk, view them with Read tool or open in browser:]\n${pathList}`.trim();
        } catch {
          textToSend = `${msg}\n\n[Attached images: ${imgs.map((i) => i.name).join(", ")}]`.trim();
        }
      }
    }

    try {
      userScrolledUpRef.current = false;
      await sendPairMessage(agent.id, sessionId, textToSend);
      setMessages((prev) => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: "user",
          text: msg,
          images: imgs.length ? imgs : undefined,
          timestamp: Date.now(),
        } as ChatMessage,
      ]);
      setInput("");
      setAttachedImages([]);
      setCanSend(false);
    } catch (err) {
      console.error("Failed to send message:", err);
      setSendError("Message failed to send. Try again.");
      setTimeout(() => setSendError(null), 4000);
    } finally {
      setSending(false);
    }
  };

  const handleEndOrBack = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await onManualEnd();
    } finally {
      setEnding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      void attachFiles(imageFiles);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="h-full min-h-0 flex flex-col"
      style={{ background: "var(--bg-app)" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Tab bar */}
      <div
        className="shrink-0 flex items-center gap-1 px-4 border-b"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-surface)",
          height: 40,
        }}
      >
        {/* Active session tab */}
        <div className="flex items-center gap-1.5 h-7 px-1 text-[12px] font-medium select-none">
          <StarburstIcon size={12} color="var(--text-tertiary)" />
          <span style={{ color: "var(--text-secondary)" }}>{agent.name}</span>
          <span style={{ color: "var(--text-tertiary)" }}>·</span>
          <span className="max-w-[200px] truncate" style={{ color: "var(--text-primary)" }}>{chatTitle}</span>
          {!sessionEnded && !canSend && (
            <Loader2 size={10} className="animate-spin" style={{ color: "var(--text-tertiary)" }} />
          )}
        </div>

        {/* New session */}
        <button
          onClick={onNewSession}
          className="h-7 w-7 flex items-center justify-center rounded-md cursor-pointer"
          style={{ color: "var(--text-tertiary)" }}
          title="New pair session"
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-inset)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Plus size={14} />
        </button>

        {/* History */}
        <div className="relative" ref={historyRef}>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="h-7 w-7 flex items-center justify-center rounded-md cursor-pointer"
            style={{
              color: "var(--text-tertiary)",
              background: historyOpen ? "var(--bg-inset)" : "transparent",
            }}
            title="Session history"
            onMouseEnter={(e) => { if (!historyOpen) e.currentTarget.style.background = "var(--bg-inset)"; }}
            onMouseLeave={(e) => { if (!historyOpen) e.currentTarget.style.background = "transparent"; }}
          >
            <Clock size={14} />
          </button>

          {historyOpen && (
            <div
              className="absolute left-0 top-full mt-1 w-72 rounded-lg overflow-hidden shadow-lg z-50"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-default)",
              }}
            >
              {/* Search */}
              <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border-default)" }}>
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Search sessions…"
                  autoFocus
                  className="w-full bg-transparent text-[13px] outline-none"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>

              {/* Session list */}
              <div className="max-h-80 overflow-y-auto py-1">
                {loadingHistory ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-tertiary)" }} />
                  </div>
                ) : (
                  <SessionHistoryList
                    sessions={pairSessions}
                    searchQuery={historySearch}
                    onResume={handleResumeSession}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Preview badge */}
        {previewUrl && (
          <button
            onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium cursor-pointer"
            style={{
              background: "color-mix(in srgb, var(--status-active) 10%, transparent)",
              color: "var(--status-active)",
              border: "1px solid color-mix(in srgb, var(--status-active) 20%, transparent)",
            }}
          >
            <ExternalLink size={11} />
            {previewUrl.replace(/^https?:\/\//, "")}
          </button>
        )}

        {/* End / Back */}
        <button
          onClick={() => void handleEndOrBack()}
          disabled={ending}
          className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium cursor-pointer disabled:opacity-40"
          style={
            sessionEnded
              ? { background: "var(--accent)", color: "white" }
              : { color: "var(--text-tertiary)" }
          }
          onMouseEnter={(e) => {
            if (!sessionEnded) e.currentTarget.style.background = "var(--bg-inset)";
          }}
          onMouseLeave={(e) => {
            if (!sessionEnded) e.currentTarget.style.background = "transparent";
          }}
        >
          {sessionEnded ? (
            "Back to Agent"
          ) : (
            <>
              <StopCircle size={11} />
              End Pair
            </>
          )}
        </button>
      </div>

      {/* Message list */}
      <div
        ref={chatContainerRef}
        onScroll={handleChatScroll}
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ background: "var(--bg-surface)" }}
      >
        <div className="max-w-2xl mx-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <div
              className="flex items-center justify-center py-16 text-[13px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              <div className="animate-spin mr-2"><StarburstIcon size={14} color="var(--text-tertiary)" /></div>
              Starting session…
            </div>
          )}

          {messages.map((m) => {
            if (m.role === "thinking") {
              return (
                <ThinkingBlock
                  key={m.id}
                  msg={m}
                  expanded={expandedThinking[m.id] ?? false}
                  onToggle={() =>
                    setExpandedThinking((p) => ({ ...p, [m.id]: !p[m.id] }))
                  }
                  isLive={m.durationMs == null}
                />
              );
            }

            if (m.role === "user") {
              return (
                <div key={m.id} className="flex flex-col items-end gap-1.5">
                  {/* Images */}
                  {m.images && m.images.length > 0 && (
                    <div className="flex flex-wrap gap-2 justify-end">
                      {m.images.map((img) => (
                        <img
                          key={img.id}
                          src={img.dataUrl}
                          alt={img.name}
                          className="rounded-lg object-cover"
                          style={{ width: 120, height: 90, border: "1px solid var(--border-default)" }}
                        />
                      ))}
                    </div>
                  )}
                  {m.text && (
                    <div
                      className="px-3.5 py-2.5 rounded-2xl rounded-br-sm text-[14px] leading-relaxed max-w-[80%]"
                      style={{
                        background: "var(--bg-inset)",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border-default)",
                      }}
                    >
                      {m.text}
                    </div>
                  )}
                </div>
              );
            }

            if (m.role === "agent") {
              return (
                <div key={m.id} className="flex items-start gap-2.5">
                  <div
                    className="shrink-0 w-6 h-6 flex items-center justify-center mt-0.5 rounded"
                    style={{ background: "white", border: "1px solid var(--border-default)" }}
                  >
                    <StarburstIcon size={13} color="var(--text-secondary)" />
                  </div>
                  <div
                    className="flex-1 min-w-0 text-[14px] leading-relaxed"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {m.text}
                    </ReactMarkdown>
                    {m.isStreaming && (
                      <span
                        className="inline-block w-[2px] h-[14px] ml-0.5 align-middle animate-pulse rounded-full"
                        style={{ background: "var(--text-tertiary)" }}
                      />
                    )}
                  </div>
                </div>
              );
            }

            if (m.role === "system") {
              return (
                <p key={m.id} className="text-[12px] text-center" style={{ color: "var(--text-tertiary)" }}>
                  {m.text}
                </p>
              );
            }

            return null;
          })}

          {/* Typing indicator: shows when waiting for agent and no active thinking/streaming */}
          {!canSend && !sessionEnded && messages.length > 0 && (() => {
            const last = messages[messages.length - 1];
            const hasActiveThinking = last?.role === "thinking" && last.durationMs == null;
            const hasActiveStreaming = last?.role === "agent" && last.isStreaming;
            if (hasActiveThinking || hasActiveStreaming) return null;
            return <TypingIndicator />;
          })()}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div
        className="shrink-0 border-t"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border-default)",
        }}
      >
        <div className="max-w-2xl mx-auto px-4 py-3">
          {sendError && (
            <div className="text-[12px] mb-1.5 px-1" style={{ color: "var(--status-error)" }}>
              {sendError}
            </div>
          )}
          <div
            className="flex flex-col rounded-xl overflow-hidden"
            style={{
              background: "var(--bg-surface)",
              border: `1.5px solid ${isDragging ? "var(--accent)" : "var(--border-default)"}`,
              boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
              transition: "border-color 150ms",
            }}
          >
            {/* Attached image previews — inside the input box, above text */}
            {attachedImages.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {attachedImages.map((img) => (
                  <div key={img.id} className="relative group">
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="rounded-lg object-cover"
                      style={{ width: 72, height: 54, border: "1px solid var(--border-default)" }}
                    />
                    <button
                      onClick={() => removeImage(img.id)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      style={{ background: "var(--text-primary)", color: "white" }}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={input}
              disabled={!canSend || sending || sessionEnded}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => e.preventDefault()}
              placeholder={
                sessionEnded
                  ? "Session ended"
                  : canSend
                    ? "Message co-founder…"
                    : "Waiting for co-founder…"
              }
              rows={1}
              className="w-full resize-none bg-transparent text-[14px] outline-none leading-relaxed px-3 pt-2.5"
              style={{
                color: "var(--text-primary)",
                minHeight: 36,
                opacity: !canSend || sessionEnded ? 0.5 : 1,
              }}
            />

            {/* Bottom toolbar — buttons pinned to bottom */}
            <div className="flex items-center justify-end gap-1 px-2 pb-2 pt-1">
              {/* Image attach */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={sessionEnded}
                className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer disabled:opacity-40 transition-colors"
                style={{ color: "var(--text-tertiary)" }}
                title="Attach image"
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text-secondary)";
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-tertiary)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <ImageIcon size={16} />
              </button>

              {/* Send */}
              <button
                onClick={() => void handleSend()}
                disabled={(!input.trim() && attachedImages.length === 0) || !canSend || sending || sessionEnded}
                className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer disabled:opacity-30 transition-opacity"
                style={{ background: "var(--accent)", color: "white" }}
              >
                {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void attachFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {isDragging && (
            <p className="text-[11px] text-center mt-1.5" style={{ color: "var(--text-tertiary)" }}>
              Drop images to attach
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
