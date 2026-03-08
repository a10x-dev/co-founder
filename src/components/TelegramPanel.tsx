import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2, ExternalLink, X, Copy, Check } from "lucide-react";
import { saveTelegramConfig, removeTelegramConfig, getTelegramStatus } from "@/lib/api";
import type { TelegramStatus } from "@/types";
import FriendlyError from "@/components/FriendlyError";

interface TelegramPanelProps {
  agentId: string;
  agentName: string;
}

type SetupStep = "idle" | "enter-token" | "verifying" | "waiting-start" | "connected";

export default function TelegramPanel({ agentId, agentName }: TelegramPanelProps) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [step, setStep] = useState<SetupStep>("idle");
  const [token, setToken] = useState("");
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const slug = agentName.toLowerCase().replace(/[^a-z0-9]/g, "_");

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    });
  };

  const reload = useCallback(() => {
    getTelegramStatus(agentId)
      .then((s) => {
        setStatus(s);
        if (s.configured && s.connected) {
          setStep("connected");
          setBotUsername(s.bot_username);
        } else if (s.configured && !s.connected) {
          setStep("waiting-start");
          setBotUsername(s.bot_username);
        } else {
          setStep("idle");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    reload();
  }, [agentId, reload]);

  // Listen for telegram-connected event (auto-advance to connected)
  useEffect(() => {
    const unlisten = listen<{ agent_id: string; chat_id: number }>("telegram-connected", (event) => {
      if (event.payload.agent_id === agentId) {
        setStep("connected");
        reload();
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [agentId, reload]);

  const handleSaveToken = async () => {
    if (!token.trim()) return;
    setError(null);
    setStep("verifying");
    try {
      const result = await saveTelegramConfig(agentId, token.trim());
      setBotUsername(result.bot_username);
      setStep("waiting-start");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("enter-token");
    }
  };

  const handleDisconnect = async () => {
    setError(null);
    try {
      await removeTelegramConfig(agentId);
      setStep("idle");
      setToken("");
      setBotUsername(null);
      setStatus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3" style={{ color: "var(--text-tertiary)" }}>
        <Loader2 size={14} className="animate-spin" /> Loading...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <FriendlyError error={error} />}

      {/* ── Connected state ────────────────────────────────────────── */}
      {step === "connected" && (
        <div
          className="rounded-xl border p-4"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <TelegramIcon />
              <span className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
                Telegram
              </span>
            </div>
            <span
              className="flex items-center gap-1.5 text-[12px] font-medium"
              style={{ color: status?.online ? "var(--status-active)" : "var(--text-tertiary)" }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: status?.online ? "var(--status-active)" : "var(--text-tertiary)" }}
              />
              {status?.online ? "Online" : "Offline"}
            </span>
          </div>
          {botUsername && (
            <p className="text-[13px] font-mono mb-3" style={{ color: "var(--text-secondary)" }}>
              @{botUsername}
            </p>
          )}
          <p className="text-[13px] mb-3" style={{ color: "var(--text-tertiary)" }}>
            Chat with {agentName} from your phone. Messages work like pair sessions.
          </p>
          <div className="flex items-center gap-2">
            {botUsername && (
              <button
                onClick={() => openUrl(`https://t.me/${botUsername}`)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium cursor-pointer"
                style={{ background: "var(--accent)", color: "white" }}
              >
                <ExternalLink size={13} /> Open Chat
              </button>
            )}
            <button
              onClick={handleDisconnect}
              className="h-8 px-3 rounded-lg text-[13px] font-medium cursor-pointer"
              style={{ color: "var(--status-error)", background: "var(--bg-inset)", border: "1px solid var(--border-default)" }}
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {/* ── Waiting for /start ─────────────────────────────────────── */}
      {step === "waiting-start" && (
        <div
          className="rounded-xl border p-4"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TelegramIcon />
              <span className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
                Almost there!
              </span>
            </div>
            <button
              onClick={handleDisconnect}
              className="cursor-pointer"
              style={{ color: "var(--text-tertiary)" }}
            >
              <X size={16} />
            </button>
          </div>
          <p className="text-[13px] mb-3" style={{ color: "var(--text-secondary)" }}>
            Open this chat on Telegram and tap <strong>Start</strong>:
          </p>
          {botUsername && (
            <button
              onClick={() => openUrl(`https://t.me/${botUsername}`)}
              className="w-full h-10 rounded-lg text-[14px] font-medium cursor-pointer mb-3 flex items-center justify-center gap-2"
              style={{ background: "var(--accent)", color: "white" }}
            >
              <ExternalLink size={14} /> Open @{botUsername}
            </button>
          )}
          <div className="flex items-center gap-2" style={{ color: "var(--text-tertiary)" }}>
            <Loader2 size={14} className="animate-spin" />
            <span className="text-[13px]">Waiting for connection...</span>
          </div>
        </div>
      )}

      {/* ── Enter token step ───────────────────────────────────────── */}
      {(step === "enter-token" || step === "verifying") && (
        <div
          className="rounded-xl border p-4 space-y-3"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TelegramIcon />
              <span className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
                Connect Telegram
              </span>
            </div>
            <button
              onClick={() => { setStep("idle"); setToken(""); setError(null); }}
              className="cursor-pointer"
              style={{ color: "var(--text-tertiary)" }}
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <span
                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold mt-0.5"
                style={{ background: "var(--accent)", color: "white" }}
              >
                1
              </span>
              <div>
                <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
                  Open{" "}
                  <button
                    onClick={() => openUrl("https://t.me/BotFather")}
                    className="underline cursor-pointer font-medium"
                    style={{ color: "var(--accent)" }}
                  >
                    @BotFather
                  </button>{" "}
                  on Telegram
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <span
                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold mt-0.5"
                style={{ background: "var(--accent)", color: "white" }}
              >
                2
              </span>
              <div>
                <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
                  Send <code className="px-1 rounded text-[12px]" style={{ background: "var(--bg-inset)" }}>/newbot</code> and create a bot
                </p>
                <div className="text-[12px] mt-1 space-y-1" style={{ color: "var(--text-tertiary)" }}>
                  <div className="flex items-center gap-1.5">
                    <span>Suggested name:</span>
                    <button
                      onClick={() => copyToClipboard(`${agentName} CoFounder`, "name")}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium cursor-pointer"
                      style={{ background: "var(--bg-inset)", color: "var(--text-primary)" }}
                    >
                      {agentName} CoFounder
                      {copiedField === "name" ? <Check size={11} style={{ color: "var(--status-active)" }} /> : <Copy size={11} style={{ color: "var(--text-tertiary)" }} />}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span>Suggested username:</span>
                    <button
                      onClick={() => copyToClipboard(`${slug}_cofounder_bot`, "username")}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium font-mono cursor-pointer"
                      style={{ background: "var(--bg-inset)", color: "var(--text-primary)" }}
                    >
                      {slug}_cofounder_bot
                      {copiedField === "username" ? <Check size={11} style={{ color: "var(--status-active)" }} /> : <Copy size={11} style={{ color: "var(--text-tertiary)" }} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <span
                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold mt-0.5"
                style={{ background: "var(--accent)", color: "white" }}
              >
                3
              </span>
              <div className="flex-1">
                <p className="text-[13px] mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  Paste the bot token below
                </p>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="7123456789:AAF..."
                  className="w-full h-9 px-3 rounded-lg text-[13px] font-mono outline-none"
                  style={{
                    background: "var(--bg-inset)",
                    border: "1px solid var(--border-default)",
                    color: "var(--text-primary)",
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveToken(); }}
                  disabled={step === "verifying"}
                />
              </div>
            </div>
          </div>

          <button
            onClick={handleSaveToken}
            disabled={!token.trim() || step === "verifying"}
            className="w-full h-9 rounded-lg text-[13px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{ background: "var(--accent)", color: "white" }}
          >
            {step === "verifying" ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Verifying...
              </>
            ) : (
              "Connect"
            )}
          </button>
        </div>
      )}

      {/* ── Idle state (not configured) ────────────────────────────── */}
      {step === "idle" && (
        <div
          className="rounded-xl border p-4 flex items-center justify-between"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
        >
          <div className="flex items-center gap-3">
            <TelegramIcon />
            <div>
              <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
                Telegram
              </p>
              <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                Chat with {agentName} from your phone
              </p>
            </div>
          </div>
          <button
            onClick={() => { setStep("enter-token"); setError(null); }}
            className="h-8 px-4 rounded-lg text-[13px] font-medium cursor-pointer transition-all duration-150"
            style={{
              background: "var(--bg-inset)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-default)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-inset)"; }}
          >
            Connect
          </button>
        </div>
      )}
    </div>
  );
}

function TelegramIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.28-.02-.12.03-2.02 1.28-5.69 3.77-.54.37-1.03.55-1.47.54-.48-.01-1.41-.27-2.1-.5-.85-.28-1.52-.43-1.46-.91.03-.25.38-.51 1.04-.78 4.07-1.77 6.78-2.94 8.13-3.5 3.87-1.61 4.68-1.89 5.2-1.9.12 0 .37.03.54.18.14.12.18.29.2.45-.01.06.01.24 0 .38z"
        fill="var(--text-secondary)"
      />
    </svg>
  );
}
