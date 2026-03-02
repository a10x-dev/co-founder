import { useState } from "react";
import { Clock, RefreshCw } from "lucide-react";
import { generateDailyReport, getDailyReports } from "@/lib/api";
import type { DailyReport } from "@/lib/api";

export interface ReportsTabProps {
  agentId: string;
  reports: DailyReport[];
  setReports: (r: DailyReport[]) => void;
}

export default function ReportsTab({ agentId, reports, setReports }: ReportsTabProps) {
  const [generating, setGenerating] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>Daily Reports</h2>
        <button
          onClick={async () => {
            setGenerating(true);
            try { await generateDailyReport(agentId); const r = await getDailyReports(agentId); setReports(r); } catch { /* ignore */ }
            setGenerating(false);
          }}
          disabled={generating}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium cursor-pointer disabled:opacity-50"
          style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
        >
          <RefreshCw size={13} className={generating ? "animate-spin" : ""} />
          {generating ? "Generating..." : "Generate now"}
        </button>
      </div>
      <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
        A summary of your co-founder's work is generated each morning at 8am.
      </p>
      <div className="flex flex-col gap-4">
        {reports.map((report) => (
          <details key={report.date} className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
            <summary className="px-4 py-3 cursor-pointer flex items-center gap-2 select-none">
              <Clock size={14} style={{ color: "var(--text-tertiary)" }} />
              <span className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>{report.date}</span>
            </summary>
            <div className="px-4 pb-4">
              <div className="prose prose-sm max-w-none text-[14px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {report.content.split("\n").map((line, i) => {
                  if (line.startsWith("# ")) return <h3 key={i} className="text-[16px] font-semibold mt-3 mb-1" style={{ color: "var(--text-primary)" }}>{line.slice(2)}</h3>;
                  if (line.startsWith("## ")) return <h4 key={i} className="text-[14px] font-semibold mt-3 mb-1" style={{ color: "var(--text-primary)" }}>{line.slice(3)}</h4>;
                  if (line.startsWith("| ")) return <pre key={i} className="text-[13px] font-mono" style={{ color: "var(--text-secondary)" }}>{line}</pre>;
                  if (line.startsWith("- ")) return <p key={i} className="ml-3 text-[13px]">{line}</p>;
                  if (line.trim() === "") return <br key={i} />;
                  return <p key={i} className="text-[13px]">{line}</p>;
                })}
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
