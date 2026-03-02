import { Hammer } from "lucide-react";
import type { ToolManifestEntry } from "@/types";
import { formatRelativeTime } from "@/lib/formatTime";

export interface ToolsTabProps {
  tools: ToolManifestEntry[];
}

export default function ToolsTab({ tools }: ToolsTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>Co-Founder Toolbox</h2>
        <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>{tools.length} tool{tools.length !== 1 ? "s" : ""}</span>
      </div>
      <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
        Tools your co-founder has built for itself. These compound over time.
      </p>
      <div className="flex flex-col gap-3">
        {tools.map((tool) => (
          <div key={tool.name} className="rounded-xl border p-4 flex items-start gap-3" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
            <Hammer size={18} className="shrink-0 mt-0.5" style={{ color: "var(--text-secondary)" }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>{tool.name}</span>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono" style={{ background: "var(--bg-inset)", color: "var(--text-tertiary)" }}>{tool.language}</span>
                {tool.approved
                  ? <span className="px-2 py-0.5 rounded text-[11px] font-medium" style={{ background: "color-mix(in srgb, var(--status-active) 12%, transparent)", color: "var(--status-active)" }}>Approved</span>
                  : <span className="px-2 py-0.5 rounded text-[11px] font-medium" style={{ background: "color-mix(in srgb, var(--status-paused) 12%, transparent)", color: "var(--status-paused)" }}>Pending</span>}
              </div>
              <p className="text-[13px] mt-1" style={{ color: "var(--text-secondary)" }}>{tool.description}</p>
              <div className="flex items-center gap-3 mt-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                <span>Used {tool.use_count}x</span>
                <span>Created {formatRelativeTime(tool.created_at)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
