import { useCallback, useEffect, useState } from "react";
import { FileText, Image, File, Trash2, Copy, Check, ChevronRight, FolderOpen, X } from "lucide-react";
import type { DeliverableFile } from "@/types";
import { listDeliverables, readDeliverableFile, dismissDeliverable } from "@/lib/api";
import { formatRelativeTime } from "@/lib/formatTime";

// Folder display config
const FOLDER_META: Record<string, { label: string; description: string }> = {
  content: { label: "Content", description: "Blog posts, social media, and written content" },
  marketing: { label: "Marketing", description: "Marketing materials and campaigns" },
  plans: { label: "Plans", description: "Strategy documents and roadmaps" },
  prospects: { label: "Prospects", description: "Outreach lists and lead research" },
  "social-templates": { label: "Social Templates", description: "Ready-to-post social media templates" },
  "": { label: "Files", description: "Root-level deliverables" },
};

function folderLabel(folder: string): string {
  return FOLDER_META[folder]?.label || folder.charAt(0).toUpperCase() + folder.slice(1);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ type }: { type: string }) {
  if (type === "image") return <Image size={16} strokeWidth={1.8} />;
  if (type === "markdown") return <FileText size={16} strokeWidth={1.8} />;
  return <File size={16} strokeWidth={1.8} />;
}

// ---------------------------------------------------------------------------
// File Viewer — renders markdown text or images inline
// ---------------------------------------------------------------------------
function FileViewer({
  file,
  agentId,
  onClose,
  onDismiss,
}: {
  file: DeliverableFile;
  agentId: string;
  onClose: () => void;
  onDismiss: (path: string) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setLoading(true);
    setContent(null);
    readDeliverableFile(agentId, file.path)
      .then(setContent)
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [agentId, file.path]);

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDismiss = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    onDismiss(file.path);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-[13px] font-medium px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
          style={{ color: "var(--text-secondary)", background: "var(--bg-inset)" }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>&larr;</span> Back
        </button>
        <div className="flex-1 min-w-0">
          <h2
            className="text-[17px] font-semibold truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {file.name}
          </h2>
          {file.folder && (
            <p className="text-[12px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              {folderLabel(file.folder)} &middot; {formatFileSize(file.size)}
            </p>
          )}
        </div>
        {file.file_type !== "image" && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md transition-colors cursor-pointer"
            style={{
              color: copied ? "var(--status-active)" : "var(--text-secondary)",
              background: "var(--bg-inset)",
            }}
          >
            {copied ? (
              <>
                <Check size={12} /> Copied
              </>
            ) : (
              <>
                <Copy size={12} /> Copy
              </>
            )}
          </button>
        )}
        <button
          onClick={handleDismiss}
          className="flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md transition-colors cursor-pointer"
          style={{
            color: confirming ? "white" : "var(--status-error)",
            background: confirming ? "var(--status-error)" : "rgba(239, 68, 68, 0.08)",
          }}
        >
          {confirming ? (
            <>
              <Trash2 size={12} /> Confirm Delete
            </>
          ) : (
            <>
              <X size={12} /> Dismiss
            </>
          )}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div
          className="rounded-xl border p-12 text-center"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
        >
          <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Loading...
          </p>
        </div>
      ) : file.file_type === "image" && content ? (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
        >
          <img
            src={content}
            alt={file.name}
            className="w-full h-auto"
            style={{ maxHeight: "calc(100vh - 280px)", objectFit: "contain" }}
          />
        </div>
      ) : content ? (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
        >
          <div
            className="flex items-center justify-between px-4 py-2 border-b"
            style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}
          >
            <span
              className="text-[11px] font-medium uppercase tracking-wide"
              style={{ color: "var(--text-tertiary)" }}
            >
              {file.name.endsWith(".json") ? "JSON" : file.name.endsWith(".csv") ? "CSV" : "Content"}
            </span>
            <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              {formatRelativeTime(file.modified_at)}
            </span>
          </div>
          <pre
            className="p-4 text-[13px] font-mono whitespace-pre-wrap leading-relaxed overflow-auto"
            style={{ color: "var(--text-primary)", maxHeight: "calc(100vh - 320px)" }}
          >
            {content}
          </pre>
        </div>
      ) : (
        <div
          className="rounded-xl border p-12 text-center"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
        >
          <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Could not load file content
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Tab
// ---------------------------------------------------------------------------
export interface DeliverablesTabProps {
  agentId: string;
  deliverables: DeliverableFile[];
  onRefresh: () => void;
}

export default function DeliverablesTab({
  agentId,
  deliverables,
  onRefresh,
}: DeliverablesTabProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const selected = deliverables.find((d) => d.path === selectedPath);

  const handleDismiss = useCallback(
    async (path: string) => {
      setDismissing(path);
      try {
        await dismissDeliverable(agentId, path);
        setSelectedPath(null);
        onRefresh();
      } catch (e) {
        console.error("Failed to dismiss deliverable:", e);
      } finally {
        setDismissing(null);
      }
    },
    [agentId, onRefresh],
  );

  // Group by folder
  const grouped = new Map<string, DeliverableFile[]>();
  for (const d of deliverables) {
    const key = d.folder || "";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(d);
  }

  // Sort folders: root files first, then alphabetical
  const sortedFolders = [...grouped.keys()].sort((a, b) => {
    if (a === "" && b !== "") return -1;
    if (b === "" && a !== "") return 1;
    return a.localeCompare(b);
  });

  // Detail view
  if (selected) {
    return (
      <FileViewer
        file={selected}
        agentId={agentId}
        onClose={() => setSelectedPath(null)}
        onDismiss={handleDismiss}
      />
    );
  }

  if (deliverables.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Deliverables
          </h2>
        </div>
        <div
          className="rounded-xl border p-12 text-center"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
        >
          <FolderOpen size={32} strokeWidth={1.5} className="mx-auto mb-3" style={{ color: "var(--text-tertiary)" }} />
          <p className="text-[15px] font-medium" style={{ color: "var(--text-secondary)" }}>
            No deliverables yet
          </p>
          <p className="text-[13px] mt-1" style={{ color: "var(--text-tertiary)" }}>
            Files your co-founder creates will appear here for review
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Deliverables
        </h2>
        <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          {deliverables.length} file{deliverables.length !== 1 ? "s" : ""}
        </span>
      </div>

      {sortedFolders.map((folder) => {
        const files = grouped.get(folder)!;
        return (
          <div key={folder || "__root"}>
            <h3
              className="text-[13px] font-semibold uppercase tracking-wide mb-3 flex items-center gap-2"
              style={{ color: "var(--text-tertiary)" }}
            >
              <FolderOpen size={14} />
              {folderLabel(folder)}
              <span
                className="text-[11px] px-1.5 rounded-full font-semibold"
                style={{ background: "var(--bg-inset)", color: "var(--text-tertiary)" }}
              >
                {files.length}
              </span>
            </h3>
            <div className="space-y-1.5">
              {files.map((file) => (
                <div
                  key={file.path}
                  className="rounded-xl border p-3.5 cursor-pointer transition-all hover:border-[var(--border-hover)] group flex items-center gap-3"
                  style={{
                    background: "var(--bg-surface)",
                    borderColor: "var(--border-default)",
                    opacity: dismissing === file.path ? 0.5 : 1,
                  }}
                  onClick={() => setSelectedPath(file.path)}
                >
                  {/* File icon */}
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background:
                        file.file_type === "image"
                          ? "rgba(168, 85, 247, 0.08)"
                          : file.file_type === "markdown"
                            ? "rgba(59, 130, 246, 0.08)"
                            : "var(--bg-inset)",
                      color:
                        file.file_type === "image"
                          ? "#a855f7"
                          : file.file_type === "markdown"
                            ? "#3b82f6"
                            : "var(--text-tertiary)",
                    }}
                  >
                    <FileIcon type={file.file_type} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-[14px] font-medium truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {file.name}
                    </p>
                    <p className="text-[12px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                      {formatFileSize(file.size)} &middot;{" "}
                      {formatRelativeTime(file.modified_at)}
                    </p>
                  </div>

                  {/* Dismiss button (visible on hover) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDismiss(file.path);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg cursor-pointer"
                    style={{ color: "var(--text-tertiary)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--status-error)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-tertiary)")}
                    title="Dismiss (delete file)"
                  >
                    <Trash2 size={14} />
                  </button>

                  {/* Chevron */}
                  <ChevronRight
                    size={16}
                    className="shrink-0"
                    style={{ color: "var(--text-tertiary)" }}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <p className="text-[12px] text-center pt-2" style={{ color: "var(--text-tertiary)" }}>
        Dismiss files once reviewed — they&apos;ll be permanently deleted
      </p>
    </div>
  );
}
