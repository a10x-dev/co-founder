import type { Artifact } from "@/types";
import { formatRelativeTime } from "@/lib/formatTime";

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len).trim() + "...";
}

export interface ArtifactsTabProps {
  artifacts: Artifact[];
}

export default function ArtifactsTab({ artifacts }: ArtifactsTabProps) {
  return (
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
  );
}
