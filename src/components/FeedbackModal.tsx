import { useState, useRef, useEffect } from "react";
import { X, Send, MessageCircle } from "lucide-react";
import { sendFeedback } from "@/lib/api";

export default function FeedbackModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setSent(false);
      setError("");
      setTimeout(() => textRef.current?.focus(), 100);
    }
  }, [open]);

  async function handleSend() {
    if (!message.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      await sendFeedback(message.trim(), email.trim() || undefined);
      setSent(true);
      setMessage("");
      setEmail("");
      setTimeout(() => onClose(), 1500);
    } catch {
      setError("Failed to send. Please try again.");
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl overflow-hidden shadow-2xl"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--border-default)" }}
        >
          <div className="flex items-center gap-2.5">
            <MessageCircle size={16} style={{ color: "var(--accent)" }} />
            <span
              className="text-[14px] font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              Send Feedback
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded cursor-pointer"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--bg-hover)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {sent ? (
            <div className="py-8 text-center">
              <div
                className="text-[15px] font-medium mb-1"
                style={{ color: "var(--text-primary)" }}
              >
                Thanks for your feedback!
              </div>
              <div
                className="text-[13px]"
                style={{ color: "var(--text-tertiary)" }}
              >
                We read every message.
              </div>
            </div>
          ) : (
            <>
              <div>
                <label
                  className="block text-[12px] font-medium mb-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  What's on your mind?
                </label>
                <textarea
                  ref={textRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Bug report, feature request, or just tell us what you think..."
                  className="w-full h-28 px-3 py-2.5 rounded-lg text-[13px] leading-relaxed resize-none focus:outline-none"
                  style={{
                    background: "var(--bg-inset)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-default)",
                  }}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "var(--accent)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border-default)")
                  }
                  maxLength={2000}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.metaKey) handleSend();
                  }}
                />
              </div>

              <div>
                <label
                  className="block text-[12px] font-medium mb-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Email{" "}
                  <span style={{ color: "var(--text-tertiary)" }}>
                    (optional, for follow-up)
                  </span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full h-9 px-3 rounded-lg text-[13px] focus:outline-none"
                  style={{
                    background: "var(--bg-inset)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-default)",
                  }}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "var(--accent)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border-default)")
                  }
                />
              </div>

              {error && (
                <p className="text-[12px]" style={{ color: "var(--status-error)" }}>
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!sent && (
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderTop: "1px solid var(--border-default)" }}
          >
            <span
              className="text-[11px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              {"\u2318"}Enter to send
            </span>
            <button
              onClick={handleSend}
              disabled={!message.trim() || sending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium cursor-pointer transition-opacity"
              style={{
                background: "var(--accent)",
                color: "white",
                opacity: !message.trim() || sending ? 0.5 : 1,
              }}
            >
              {sending ? (
                <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Send size={13} />
              )}
              {sending ? "Sending..." : "Send Feedback"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
