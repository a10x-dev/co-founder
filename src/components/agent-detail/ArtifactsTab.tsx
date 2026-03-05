import { useState } from "react";
import type { Artifact } from "@/types";
import { formatRelativeTime } from "@/lib/formatTime";

function TableRenderer({ data }: { data: unknown }) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const rows = data as Array<Record<string, unknown>>;
  const keys = Object.keys(rows[0]);
  if (keys.length === 0) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-lg border" style={{ borderColor: "var(--border-default)" }}>
      <table className="w-full text-[12px]">
        <thead>
          <tr style={{ background: "var(--bg-inset)" }}>
            {keys.map((k) => (
              <th key={k} className="text-left px-2.5 py-1.5 font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)", fontSize: 10 }}>
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t" style={{ borderColor: "var(--border-default)" }}>
              {keys.map((k) => (
                <td key={k} className="px-2.5 py-1.5 font-medium" style={{ color: k === "code" ? "var(--status-active)" : "var(--text-secondary)" }}>
                  {String(row[k] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableDetail({ artifact, onBack }: { artifact: Artifact; onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  const rows = Array.isArray(artifact.data) ? artifact.data as Array<Record<string, unknown>> : [];
  const keys = rows.length > 0 ? Object.keys(rows[0]) : [];

  const handleCopy = async () => {
    const text = rows.map(row => keys.map(k => String(row[k] ?? "")).join("\t")).join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[13px] font-medium px-2.5 py-1 rounded-lg transition-colors"
          style={{ color: "var(--text-secondary)", background: "var(--bg-inset)" }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>&larr;</span> Back
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-[17px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>{artifact.title}</h2>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md transition-colors"
          style={{ color: copied ? "var(--status-active)" : "var(--text-secondary)", background: "var(--bg-inset)" }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <span className="px-2 py-0.5 rounded text-[11px] font-semibold uppercase shrink-0" style={{ background: "var(--bg-inset)", color: "var(--text-tertiary)" }}>{artifact.type}</span>
      </div>
      {artifact.description && (
        <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>{artifact.description}</p>
      )}
      {rows.length > 0 && keys.length > 0 ? (
        <div className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ background: "var(--bg-inset)" }}>
                {keys.map((k) => (
                  <th key={k} className="text-left px-4 py-2.5 font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)", fontSize: 11 }}>
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t" style={{ borderColor: "var(--border-default)" }}>
                  {keys.map((k) => (
                    <td key={k} className="px-4 py-2.5 font-medium" style={{
                      color: k === "code" ? "var(--status-active)" : "var(--text-primary)",
                      fontFamily: k === "code" ? "var(--font-mono, monospace)" : "inherit",
                      fontWeight: k === "code" ? 600 : 500,
                    }}>
                      {String(row[k] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border p-6 text-center" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
          <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>No data</p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {rows.length} row{rows.length !== 1 ? "s" : ""} &middot; Last updated {formatRelativeTime(artifact.updated_at)}
        </div>
      </div>
    </div>
  );
}

function ArtifactDetail({ artifact, onBack }: { artifact: Artifact; onBack: () => void }) {
  if (artifact.type === "table") {
    return <TableDetail artifact={artifact} onBack={onBack} />;
  }

  const [copied, setCopied] = useState(false);
  const content = typeof artifact.data === "string" ? artifact.data : JSON.stringify(artifact.data, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[13px] font-medium px-2.5 py-1 rounded-lg transition-colors"
          style={{ color: "var(--text-secondary)", background: "var(--bg-inset)" }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>&larr;</span> Back
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-[17px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>{artifact.title}</h2>
        </div>
        <span className="px-2 py-0.5 rounded text-[11px] font-semibold uppercase shrink-0" style={{ background: "var(--bg-inset)", color: "var(--text-tertiary)" }}>{artifact.type}</span>
      </div>
      {artifact.description && (
        <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>{artifact.description}</p>
      )}
      <div className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
        <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "var(--border-default)", background: "var(--bg-inset)" }}>
          <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>Content</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md transition-colors"
            style={{ color: copied ? "var(--status-active)" : "var(--text-secondary)", background: "var(--bg-surface)" }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="p-4 text-[13px] font-mono whitespace-pre-wrap leading-relaxed overflow-auto" style={{ color: "var(--text-primary)", maxHeight: "calc(100vh - 300px)" }}>
          {content}
        </pre>
      </div>
      <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
        Last updated {formatRelativeTime(artifact.updated_at)}
      </div>
    </div>
  );
}

export interface ArtifactsTabProps {
  artifacts: Artifact[];
}

export default function ArtifactsTab({ artifacts }: ArtifactsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = artifacts.find((a) => a.id === selectedId);

  if (selected) {
    return <ArtifactDetail artifact={selected} onBack={() => setSelectedId(null)} />;
  }

  const metrics = artifacts.filter((a) => a.type !== "markdown");
  const content = artifacts.filter((a) => a.type === "markdown");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>Artifacts</h2>
        <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>{artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""}</span>
      </div>

      {metrics.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-tertiary)" }}>Status & Metrics</h3>
          <div className="grid grid-cols-2 gap-3">
            {metrics.map((artifact) => (
              <div
                key={artifact.id}
                className="rounded-xl border p-4 cursor-pointer transition-colors hover:border-[var(--border-hover)]"
                style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
                onClick={() => setSelectedId(artifact.id)}
              >
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
                          {item.done && "\u2713"}
                        </span>
                        {item.label}
                      </li>
                    ))}
                    {(artifact.data as Array<{ label: string; done: boolean }>).length > 5 && (
                      <li className="text-[12px] pl-5" style={{ color: "var(--text-tertiary)" }}>
                        +{(artifact.data as Array<{ label: string; done: boolean }>).length - 5} more...
                      </li>
                    )}
                  </ul>
                )}
                {artifact.type === "table" && <TableRenderer data={artifact.data} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {content.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-tertiary)" }}>Launch Content</h3>
          <div className="space-y-2">
            {content.map((artifact) => (
              <div
                key={artifact.id}
                className="rounded-xl border p-4 cursor-pointer transition-colors hover:border-[var(--border-hover)]"
                style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
                onClick={() => setSelectedId(artifact.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>{artifact.title}</p>
                    {artifact.description && <p className="text-[13px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{artifact.description}</p>}
                  </div>
                  <span className="text-[18px] ml-3 shrink-0" style={{ color: "var(--text-tertiary)" }}>&rsaquo;</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
