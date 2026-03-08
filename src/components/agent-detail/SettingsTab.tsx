import { useState } from "react";
import {
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  Undo2,
  GitBranch,
} from "lucide-react";
import type { Agent, AgentEnvVar, GitStatus } from "@/types";
import {
  getAgentEnvVars,
  setAgentEnvVar,
  deleteAgentEnvVar,
  clearAgentSessions,
  updateDailyBudget,
  gitGetStatus,
  gitUndoLastSession,
} from "@/lib/api";
import IntegrationsPanel from "@/components/IntegrationsPanel";
import TelegramPanel from "@/components/TelegramPanel";

const divider = { borderTop: "1px solid var(--border-default)", paddingTop: 24 };

export interface SettingsTabProps {
  agent: Agent;
  onRefetch: () => void;
  onDeleted: () => void;
  envVars: AgentEnvVar[];
  setEnvVars: (v: AgentEnvVar[]) => void;
  gitStatus: GitStatus | null;
  setGitStatus: (s: GitStatus | null) => void;
  sessionsCount: number;
  clearSessions: () => void;
}

export default function SettingsTab({
  agent,
  onRefetch,
  onDeleted,
  envVars,
  setEnvVars,
  gitStatus,
  setGitStatus,
  sessionsCount,
  clearSessions,
}: SettingsTabProps) {
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [budgetInput, setBudgetInput] = useState(agent.daily_budget_usd.toString());
  const [undoing, setUndoing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removeFounderFiles, setRemoveFounderFiles] = useState(false);

  const handleAddEnvVar = async () => {
    if (!newEnvKey.trim()) return;
    await setAgentEnvVar(agent.id, newEnvKey.trim(), newEnvValue);
    setNewEnvKey("");
    setNewEnvValue("");
    getAgentEnvVars(agent.id).then(setEnvVars).catch(() => {});
  };

  const handleDeleteEnvVar = async (key: string) => {
    await deleteAgentEnvVar(agent.id, key);
    getAgentEnvVars(agent.id).then(setEnvVars).catch(() => {});
  };

  const handleDelete = async () => {
    let confirmed = false;
    try {
      const { ask: tauriAsk } = await import("@tauri-apps/plugin-dialog");
      confirmed = await tauriAsk("Delete this co-founder? This cannot be undone.", { title: "Delete Co-Founder", kind: "warning" });
    } catch {
      // Fallback to native confirm if Tauri dialog is unavailable
      confirmed = window.confirm("Delete this co-founder? This cannot be undone.");
    }
    if (!confirmed) return;
    setDeleting(true);
    try {
      const { deleteAgent } = await import("@/lib/api");
      await deleteAgent(agent.id, removeFounderFiles);
      onDeleted();
    } catch (err) {
      console.error("[DELETE_AGENT]", err);
      try {
        const { message: tauriMsg } = await import("@tauri-apps/plugin-dialog");
        await tauriMsg(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`, { title: "Error", kind: "error" });
      } catch {
        window.alert(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally { setDeleting(false); }
  };

  return (
    <div className="space-y-6">

      {/* ── Budget ──────────────────────────────────────────────────────────── */}
      <div>
        <p className="text-[15px] font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Budget</p>
        <p className="text-[13px] mb-3" style={{ color: "var(--text-tertiary)" }}>
          Your co-founder will pause automatically when this daily limit is reached. Set to 0 for unlimited.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[14px]" style={{ color: "var(--text-secondary)" }}>$</span>
          <input
            type="number" min={0} step={0.5} value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            className="w-32 rounded-lg outline-none h-10 px-3"
            style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
          />
          <button
            onClick={async () => { const val = parseFloat(budgetInput) || 0; await updateDailyBudget(agent.id, val); onRefetch(); }}
            className="h-10 px-4 rounded-lg text-[13px] font-medium cursor-pointer"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Save
          </button>
          {agent.daily_budget_usd > 0 && (
            <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
              Current: ${agent.daily_budget_usd}/day
            </span>
          )}
        </div>
      </div>

      {/* ── Environment Variables ───────────────────────────────────────────── */}
      <div style={divider}>
        <p className="text-[15px] font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
          Environment Variables
          {envVars.length > 0 && (
            <span className="text-[12px] font-normal ml-2" style={{ color: "var(--text-tertiary)" }}>{envVars.length} stored</span>
          )}
        </p>
        <p className="text-[13px] mb-3" style={{ color: "var(--text-tertiary)" }}>
          Stored securely. Your co-founder can use these but they never appear in logs.
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text" value={newEnvKey}
            onChange={(e) => setNewEnvKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
            placeholder="KEY_NAME"
            className="w-48 h-10 px-3 rounded-lg text-[14px] font-mono"
            style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none" }}
          />
          <input
            type="password" value={newEnvValue}
            onChange={(e) => setNewEnvValue(e.target.value)}
            placeholder="value"
            className="flex-1 h-10 px-3 rounded-lg text-[14px] font-mono"
            style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none" }}
          />
          <button
            onClick={handleAddEnvVar} disabled={!newEnvKey.trim()}
            className="h-10 px-4 rounded-lg text-[14px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--text-primary)", color: "var(--bg-base)" }}
          >
            Add
          </button>
        </div>
        {envVars.length > 0 && (
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border-default)" }}>
            {envVars.map((envVar, i) => (
              <div
                key={envVar.key}
                className="flex items-center gap-3 px-4 py-2.5"
                style={{ borderBottom: i < envVars.length - 1 ? "1px solid var(--border-default)" : "none" }}
              >
                <span className="font-mono text-[14px] font-medium shrink-0" style={{ color: "var(--text-primary)", minWidth: 160 }}>{envVar.key}</span>
                <span
                  className="flex-1 font-mono text-[14px] truncate cursor-pointer flex items-center gap-1.5"
                  style={{ color: "var(--text-secondary)" }}
                  onClick={() => setRevealedKeys((prev) => {
                    const next = new Set(prev);
                    if (next.has(envVar.key)) next.delete(envVar.key); else next.add(envVar.key);
                    return next;
                  })}
                >
                  {revealedKeys.has(envVar.key) ? <><EyeOff size={13} />{envVar.value}</> : <><Eye size={13} />{"••••••••"}</>}
                </span>
                <button onClick={() => handleDeleteEnvVar(envVar.key)} className="text-[13px] cursor-pointer shrink-0" style={{ color: "var(--status-error)" }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Telegram ──────────────────────────────────────────────────────── */}
      <div style={divider}>
        <p className="text-[15px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Telegram</p>
        <TelegramPanel agentId={agent.id} agentName={agent.name} />
      </div>

      {/* ── Integrations ───────────────────────────────────────────────────── */}
      <div style={divider}>
        <p className="text-[15px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Integrations</p>
        <IntegrationsPanel agentId={agent.id} />
      </div>

      {/* ── Git Safety ─────────────────────────────────────────────────────── */}
      <div style={divider}>
        <p className="text-[15px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Git Safety</p>
        {gitStatus && !gitStatus.is_repo ? (
          <div className="flex items-center gap-3" style={{ color: "var(--text-tertiary)" }}>
            <GitBranch size={18} strokeWidth={1.5} />
            <p className="text-[13px]">Not a Git repository. Initialize one to enable rollback.</p>
          </div>
        ) : gitStatus ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-[13px]" style={{ color: "var(--text-secondary)" }}>
              <span>Branch: <span className="font-mono font-medium">{gitStatus.branch || "detached"}</span></span>
              <span>{gitStatus.changed_files ?? 0} changed files</span>
              <span className="font-mono">{gitStatus.head?.slice(0, 8) ?? "—"}</span>
            </div>
            {gitStatus.changes && gitStatus.changes.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {gitStatus.changes.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-[13px] font-mono">
                    <span className="w-5 text-center font-medium" style={{ color: c.status === "M" ? "var(--status-working)" : c.status === "A" || c.status === "?" ? "var(--status-active)" : "var(--status-error)" }}>{c.status}</span>
                    <span style={{ color: "var(--text-secondary)" }}>{c.file}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setGitStatus(null); gitGetStatus(agent.id).then(setGitStatus).catch(() => {}); }}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium cursor-pointer"
                style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
              >
                <RefreshCw size={13} /> Refresh
              </button>
              <button
                disabled={undoing}
                onClick={async () => {
                  const confirmed = window.confirm("Undo the last session? This will hard reset to the pre-session commit.");
                  if (!confirmed) return;
                  setUndoing(true);
                  try { const msg = await gitUndoLastSession(agent.id); window.alert(msg); gitGetStatus(agent.id).then(setGitStatus).catch(() => {}); }
                  catch (e) { window.alert(`Undo failed: ${e instanceof Error ? e.message : String(e)}`); }
                  setUndoing(false);
                }}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium cursor-pointer disabled:opacity-50"
                style={{ background: "color-mix(in srgb, var(--status-error) 10%, transparent)", color: "var(--status-error)", border: "1px solid var(--status-error)" }}
              >
                <Undo2 size={14} /> {undoing ? "Undoing…" : "Undo last session"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>Loading…</p>
        )}
      </div>

      {/* ── Danger Zone ────────────────────────────────────────────────────── */}
      <div style={{ ...divider, borderTopColor: "var(--status-error)" }}>
        <p className="text-[15px] font-semibold mb-3" style={{ color: "var(--status-error)" }}>Danger Zone</p>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              onClick={clearSessions}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[13px] font-medium cursor-pointer"
              style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
            >
              Clear session history
            </button>
            <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>{sessionsCount} session{sessionsCount !== 1 ? "s" : ""}</span>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={removeFounderFiles} onChange={(e) => setRemoveFounderFiles(e.target.checked)} />
            <span className="text-[14px]" style={{ color: "var(--text-secondary)" }}>Also remove `.founder` files from workspace</span>
          </label>
          <button
            onClick={handleDelete} disabled={deleting}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-[14px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--status-error)", color: "white" }}
          >
            <Trash2 size={15} strokeWidth={2} /> {deleting ? "Deleting…" : "Delete co-founder"}
          </button>
        </div>
      </div>

    </div>
  );
}
