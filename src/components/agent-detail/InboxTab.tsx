import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, Image as ImageIcon, X } from "lucide-react";
import type { Agent } from "@/types";
import { sendMessageToAgent, readTextFile, saveInboxImages } from "@/lib/api";
import { type AttachedImage, isImageFile, readFileAsThumbnail, readFileAsBase64 } from "@/lib/imageUtils";

export interface InboxTabProps {
  agent: Agent;
  inboxContent: string;
  setInboxContent: (c: string) => void;
}

const MAX_IMAGES = 10;

export default function InboxTab({ agent, inboxContent, setInboxContent }: InboxTabProps) {
  const [messageText, setMessageText] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-grow textarea
  const maxHeight = typeof window !== "undefined" ? Math.round(window.innerHeight * 0.25) : 200;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const clamped = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${clamped}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [messageText, maxHeight]);

  // Image attachment
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

  // DnD
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

  // Paste images
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles: File[] = [];
    for (const item of e.clipboardData.items) {
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

  // Send
  const handleSend = async () => {
    const msg = messageText.trim();
    if (!msg && attachedImages.length === 0) return;
    setMessageSending(true);
    try {
      let textToSend = msg;

      if (attachedImages.length > 0) {
        const imagesWithData = attachedImages
          .filter((i) => i.rawBase64)
          .map((i) => ({ name: i.name, data: i.rawBase64! }));

        if (imagesWithData.length > 0) {
          const savedPaths = await saveInboxImages(agent.id, imagesWithData);
          const pathList = savedPaths.map((p) => `  - ${p}`).join("\n");
          textToSend = `${msg}\n\n[Attached images — saved to disk, view them with Read tool or open in browser:]\n${pathList}`.trim();
        }
      }

      await sendMessageToAgent(agent.id, textToSend);
      setMessageText("");
      setAttachedImages([]);
      readTextFile(agent.id, `${agent.workspace}/.founder/INBOX.md`).then(setInboxContent).catch(() => {});
    } finally {
      setMessageSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div
      className="space-y-4"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>Inbox</h2>
      <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
        Messages are delivered on the next check-in.
      </p>

      {/* Compose area */}
      <div
        className="flex flex-col rounded-xl overflow-hidden"
        style={{
          background: "var(--bg-surface)",
          border: `1.5px solid ${isDragging ? "var(--accent)" : "var(--border-default)"}`,
          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
          transition: "border-color 150ms",
        }}
      >
        {/* Image previews */}
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

        <textarea
          ref={textareaRef}
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Type a message for your co-founder…"
          rows={1}
          className="flex-1 resize-none bg-transparent text-[14px] outline-none leading-relaxed px-3 pt-2.5"
          style={{
            color: "var(--text-primary)",
            minHeight: 36,
            maxHeight,
            overflowY: "hidden",
          }}
        />

        {/* Toolbar */}
        <div className="flex items-center justify-end gap-1 px-2 pb-2 pt-1">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer transition-colors"
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

          <button
            onClick={() => void handleSend()}
            disabled={(!messageText.trim() && attachedImages.length === 0) || messageSending}
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer disabled:opacity-30 transition-opacity"
            style={{ background: "var(--accent)", color: "white" }}
          >
            {messageSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
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
        <p className="text-[11px] text-center" style={{ color: "var(--text-tertiary)" }}>
          Drop images to attach
        </p>
      )}

      {/* Pending messages */}
      {inboxContent && inboxContent.includes("---") && (
        <div className="rounded-xl border p-4" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
          <h3 className="text-[15px] font-medium mb-2" style={{ color: "var(--text-primary)" }}>Pending messages</h3>
          <pre className="text-[13px] font-mono whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{inboxContent}</pre>
        </div>
      )}
    </div>
  );
}
