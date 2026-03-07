import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, MessageCircle, ImagePlus } from "lucide-react";
import { sendFeedback } from "@/lib/api";

type FeedbackType = "bug" | "feature" | "other";

const TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature" },
  { value: "other", label: "Other" },
];

export default function FeedbackModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [type, setType] = useState<FeedbackType>("other");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSent(false);
      setError("");
      setTimeout(() => textRef.current?.focus(), 100);
    }
  }, [open]);

  const MAX_IMAGES = 5;

  const addImage = useCallback((file: File | null) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5MB");
      return;
    }
    setImages((prev) => {
      if (prev.length >= MAX_IMAGES) {
        setError(`Maximum ${MAX_IMAGES} images allowed`);
        return prev;
      }
      return [...prev, file];
    });
    const reader = new FileReader();
    reader.onloadend = () =>
      setImagePreviews((p) =>
        p.length < MAX_IMAGES ? [...p, reader.result as string] : p,
      );
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          addImage(item.getAsFile());
          break;
        }
      }
    },
    [addImage],
  );

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
    if (fileRef.current) fileRef.current.value = "";
  };

  const clearImages = () => {
    setImages([]);
    setImagePreviews([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  async function handleSend() {
    if (!message.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      await sendFeedback(message.trim(), email.trim() || undefined, type, images.length > 0 ? images : undefined);
      setSent(true);
      setMessage("");
      setEmail("");
      setType("other");
      clearImages();
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
              {/* Type selector */}
              <div className="flex gap-1.5">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setType(opt.value)}
                    className="px-3 py-1.5 rounded-full text-[12px] font-medium cursor-pointer transition-all"
                    style={{
                      background:
                        type === opt.value
                          ? "var(--accent)"
                          : "var(--bg-inset)",
                      color:
                        type === opt.value
                          ? "white"
                          : "var(--text-secondary)",
                      border: `1px solid ${type === opt.value ? "var(--accent)" : "var(--border-default)"}`,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Message */}
              <div>
                <label
                  className="block text-[12px] font-medium mb-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  What&apos;s on your mind?
                </label>
                <textarea
                  ref={textRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onPaste={handlePaste}
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
                    (e.currentTarget.style.borderColor =
                      "var(--border-default)")
                  }
                  maxLength={2000}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.metaKey) handleSend();
                  }}
                />
              </div>

              {/* Image previews */}
              {imagePreviews.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {imagePreviews.map((preview, i) => (
                    <div key={i} className="relative inline-block">
                      <img
                        src={preview}
                        alt={`Attached screenshot ${i + 1}`}
                        className="h-16 rounded-lg object-cover"
                        style={{ border: "1px solid var(--border-default)" }}
                      />
                      <button
                        onClick={() => removeImage(i)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] cursor-pointer"
                        style={{
                          background: "var(--accent)",
                          color: "white",
                        }}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Email */}
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
                    (e.currentTarget.style.borderColor =
                      "var(--border-default)")
                  }
                />
              </div>

              {error && (
                <p
                  className="text-[12px]"
                  style={{ color: "var(--status-error)" }}
                >
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
            <div className="flex items-center gap-3">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 cursor-pointer p-1 rounded transition-colors"
                style={{ color: "var(--text-tertiary)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = "var(--text-primary)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "var(--text-tertiary)")
                }
                title="Attach screenshot"
              >
                <ImagePlus size={15} />
                <span className="text-[11px]">
                  {images.length > 0 ? `${images.length}/${MAX_IMAGES}` : "Screenshot"}
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files) Array.from(files).forEach((f) => addImage(f));
                }}
              />
              <span
                className="text-[11px]"
                style={{ color: "var(--text-tertiary)", opacity: 0.6 }}
              >
                or paste from clipboard
              </span>
            </div>

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
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
