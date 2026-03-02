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
  Bot,
  User,
  ChevronDown,
  ChevronRight,
  Loader2,
  Image as ImageIcon,
  ExternalLink,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sendLiveMessage } from "@/lib/api";
import type {
  Agent,
  LivePreviewDetectedEvent,
  LiveSessionEndedEvent,
  LiveTurnCompleteEvent,
} from "@/types";

// ─── Types ──────────────────────────────────────────────────────────────────

interface LiveSessionViewProps {
  agent: Agent;
  sessionId: string;
  onManualEnd: () => Promise<void> | void;
  onNewSession: () => void;
  onSessionEnded: () => void;
}

interface AgentOutputEvent {
  agent_id?: string;
  session_id?: string;
  type?: string;
  raw?: string;
  message?: string;
}

interface AttachedImage {
  id: string;
  name: string;
  dataUrl: string;
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

function readFileAsThumbnail(file: File, maxDim = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
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
  const label = isLive
    ? `Thinking… ${formatDuration(duration)}`
    : `Thought for ${formatDuration(duration)}`;

  return (
    <div className="my-1">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[12px] cursor-pointer select-none"
        style={{ color: "var(--text-tertiary)" }}
      >
        {isLive ? (
          <Loader2 size={11} className="animate-spin shrink-0" />
        ) : expanded ? (
          <ChevronDown size={11} className="shrink-0" />
        ) : (
          <ChevronRight size={11} className="shrink-0" />
        )}
        <span className="italic">{label}</span>
      </button>

      {expanded && msg.steps.length > 0 && (
        <div
          className="mt-1.5 ml-3.5 pl-3 border-l space-y-1"
          style={{ borderColor: "var(--border-default)" }}
        >
          {msg.steps.map((step, i) => (
            <p key={i} className="text-[11px] leading-relaxed" style={{ color: "var(--text-tertiary)", fontStyle: "italic" }}>
              {step}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function LiveSessionView({
  agent,
  sessionId,
  onManualEnd,
  onNewSession,
  onSessionEnded,
}: LiveSessionViewProps) {
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

  // Track the current in-progress thinking block ID
  const activeThinkingIdRef = useRef<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openedUrlsRef = useRef<Set<string>>(new Set());

  const [chatTitle, setChatTitle] = useState("New Chat");
  const titleDerivedRef = useRef(false);

  // Pinned = last user message
  let lastUserMsg: Extract<ChatMessage, { role: "user" }> | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserMsg = messages[i] as Extract<ChatMessage, { role: "user" }>;
      break;
    }
  }

  // ── Reset on session change ──────────────────────────────────────────────
  useEffect(() => {
    setSessionEnded(false);
    setCanSend(false);
    setInput("");
    setPreviewUrl(null);
    setMessages([]);
    setAttachedImages([]);
    setExpandedThinking({});
    setSendError(null);
    setChatTitle("New Chat");
    titleDerivedRef.current = false;
    activeThinkingIdRef.current = null;
    openedUrlsRef.current = new Set();
  }, [sessionId]);

  // ── Derive chat title from first agent response ──────────────────────────
  useEffect(() => {
    if (titleDerivedRef.current) return;
    const agentMsgs = messages.filter((m) => m.role === "agent") as Extract<ChatMessage, { role: "agent" }>[];
    if (agentMsgs.length === 0) return;
    const firstText = agentMsgs[0].text;
    if (!firstText || firstText.length < 8) return;
    // Extract a short title: first sentence or first ~40 chars
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

  // ── Auto-scroll (only when user is near bottom) ─────────────────────────
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottom = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    if (isNearBottom()) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isNearBottom]);

  // ── Auto-grow textarea ───────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

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
            // Add step to existing thinking block
            return prev.map((m) =>
              m.id === thinkingId && m.role === "thinking"
                ? { ...m, steps: [...m.steps, label] }
                : m,
            );
          }
          // Create new thinking block
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
            // Replace or append agent streaming message
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

    listen<LiveTurnCompleteEvent>("live-turn-complete", (event) => {
      if (!active) return;
      const p = event.payload;
      if (p.agent_id !== agent.id || p.session_id !== sessionId) return;

      const thinkingId = activeThinkingIdRef.current;
      activeThinkingIdRef.current = null;

      setMessages((prev) => {
        let next = [...prev];

        // Finalize thinking block with duration
        if (thinkingId) {
          next = next.map((m) => {
            if (m.id === thinkingId && m.role === "thinking") {
              return { ...m, durationMs: Date.now() - m.startTime };
            }
            return m;
          });
          // Remove orphaned thinking block if no agent text followed
          const afterThink = next.findIndex((m) => m.id === thinkingId);
          const hasResponse = afterThink < next.length - 1 && next[afterThink + 1]?.role === "agent";
          if (!hasResponse) {
            // keep it but finalize — the user can see what it did
          }
        }

        // Finalize streaming agent message
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

    listen<LivePreviewDetectedEvent>("live-preview-detected", (event) => {
      if (!active) return;
      const p = event.payload;
      if (p.agent_id !== agent.id || p.session_id !== sessionId) return;
      setPreviewUrl(p.url);
    })
      .then((fn) => { if (active) unlisten.push(fn); })
      .catch(() => {});

    listen<LiveSessionEndedEvent>("live-session-ended", (event) => {
      if (!active) return;
      const p = event.payload;
      if (p.agent_id !== agent.id || p.session_id !== sessionId) return;
      setCanSend(false);
      setSessionEnded(true);
      if (p.summary && !p.summary.startsWith("Live session ended by user")) {
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

  // ── Image attachment ─────────────────────────────────────────────────────
  const attachFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(isImageFile);
    const loaded: AttachedImage[] = await Promise.all(
      arr.map(async (f) => ({
        id: `img-${Date.now()}-${Math.random()}`,
        name: f.name,
        dataUrl: await readFileAsThumbnail(f),
      })),
    );
    setAttachedImages((prev) => [...prev, ...loaded]);
  }, []);

  const removeImage = (id: string) => {
    setAttachedImages((prev) => prev.filter((i) => i.id !== id));
  };

  // DnD handlers
  const handleDragOver = (e: React.DragEvent) => {
    if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) {
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
    if (e.dataTransfer.files.length) void attachFiles(e.dataTransfer.files);
  };

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const msg = input.trim();
    if ((!msg && attachedImages.length === 0) || !canSend || sending || sessionEnded) return;

    setSending(true);
    const imgs = [...attachedImages];
    const textToSend = imgs.length > 0
      ? `${msg}\n\n[Attached images: ${imgs.map((i) => i.name).join(", ")}]`.trim()
      : msg;

    try {
      await sendLiveMessage(agent.id, sessionId, textToSend);
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
          <Bot size={12} style={{ color: "var(--text-tertiary)" }} />
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
          title="New live session"
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-inset)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Plus size={14} />
        </button>


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
              End
            </>
          )}
        </button>
      </div>

      {/* Pinned last user message */}
      {lastUserMsg && (
        <div
          className="shrink-0 px-6 py-2.5 border-b"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border-default)",
          }}
        >
          <div className="flex items-start gap-2 max-w-2xl">
            <User size={13} className="mt-0.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
            <p
              className="text-[13px] leading-snug line-clamp-2"
              style={{ color: "var(--text-secondary)" }}
            >
              {lastUserMsg.text}
            </p>
          </div>
        </div>
      )}

      {/* Message list */}
      <div ref={chatContainerRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <div
              className="flex items-center justify-center py-16 text-[13px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              <Loader2 size={14} className="animate-spin mr-2" />
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
                    className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5"
                    style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)" }}
                  >
                    <Bot size={13} style={{ color: "var(--text-secondary)" }} />
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
              background: "var(--bg-inset)",
              border: `1px solid ${isDragging ? "var(--accent)" : "var(--border-default)"}`,
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
              placeholder={
                sessionEnded
                  ? "Session ended"
                  : canSend
                    ? "Message co-founder…"
                    : "Waiting for co-founder…"
              }
              rows={1}
              className="flex-1 resize-none bg-transparent text-[14px] outline-none leading-relaxed px-3 pt-2.5"
              style={{
                color: "var(--text-primary)",
                minHeight: 36,
                maxHeight: 200,
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
                  e.currentTarget.style.background = "var(--bg-surface)";
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
