import { useEffect, useState } from "react";
import type { Agent } from "@/types";
import { writeTextFile, updateAgentBehavior } from "@/lib/api";
import { CHECKIN_OPTIONS, AUTONOMY_OPTIONS } from "@/lib/wizardConstants";

const SESSION_DURATION_OPTIONS = [
  { label: "15 min", sublabel: "Quick tasks", value: 900 },
  { label: "30 min", sublabel: "Default", value: 1800 },
  { label: "45 min", sublabel: "Deeper work", value: 2700 },
  { label: "1 hour", sublabel: "Complex tasks", value: 3600 },
] as const;

const divider = { borderTop: "1px solid var(--border-default)", paddingTop: 24 };

export interface BehaviorTabProps {
  agent: Agent;
  onRefetch: () => void;
  soulContent: string;
  setSoulContent: (c: string) => void;
  missionContent: string;
  setMissionContent: (c: string) => void;
  memoryContent: string;
  setMemoryContent: (c: string) => void;
}

export default function BehaviorTab({
  agent,
  onRefetch,
  soulContent,
  setSoulContent,
  missionContent,
  setMissionContent,
  memoryContent,
  setMemoryContent,
}: BehaviorTabProps) {
  // ── Behavior ───────────────────────────────────────────────────────────────
  const [autonomy, setAutonomy] = useState<"semi" | "yolo">(agent.autonomy_level);
  const [checkin, setCheckin] = useState(agent.checkin_interval_secs);
  const [duration, setDuration] = useState(agent.max_session_duration_secs);
  const [behaviorSaving, setBehaviorSaving] = useState(false);
  const [behaviorSaved, setBehaviorSaved] = useState(false);

  // Sync local state when the agent prop updates after a save + refetch
  useEffect(() => {
    setAutonomy(agent.autonomy_level);
    setCheckin(agent.checkin_interval_secs);
    setDuration(agent.max_session_duration_secs);
  }, [agent.autonomy_level, agent.checkin_interval_secs, agent.max_session_duration_secs]);

  const behaviorDirty =
    autonomy !== agent.autonomy_level ||
    checkin !== agent.checkin_interval_secs ||
    duration !== agent.max_session_duration_secs;

  const handleSaveBehavior = async () => {
    setBehaviorSaving(true);
    try {
      await updateAgentBehavior(agent.id, autonomy, checkin, duration);
      onRefetch();
      setBehaviorSaved(true);
      setTimeout(() => setBehaviorSaved(false), 2000);
    } finally {
      setBehaviorSaving(false);
    }
  };

  // ── Identity ───────────────────────────────────────────────────────────────
  const [missionSaving, setMissionSaving] = useState(false);
  const [soulSaving, setSoulSaving] = useState(false);
  const [memorySaving, setMemorySaving] = useState(false);

  const handleSaveFile = async (
    filename: string,
    content: string,
    setSaving: (v: boolean) => void,
  ) => {
    setSaving(true);
    try { await writeTextFile(agent.id, `${agent.workspace}/.founder/${filename}`, content); }
    finally { setSaving(false); }
  };

  const card = (selected: boolean): React.CSSProperties => ({
    padding: 14,
    background: selected ? "var(--accent-subtle)" : "var(--bg-inset)",
    border: "2px solid",
    borderColor: selected ? "var(--border-strong)" : "var(--border-default)",
  });

  const onHover = (selected: boolean, enter: boolean, el: HTMLButtonElement) => {
    el.style.background = enter && !selected
      ? "var(--bg-hover)"
      : selected ? "var(--accent-subtle)" : "var(--bg-inset)";
  };

  return (
    <div className="space-y-6">

      {/* ── Mission ─────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>Mission</span>
          <span className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>MISSION.md</span>
        </div>
        <p className="text-[13px] mb-2" style={{ color: "var(--text-tertiary)" }}>
          The north star. Defines what your co-founder is trying to achieve. Update when your goals or strategy change.
        </p>
        <textarea
          value={missionContent}
          onChange={(e) => setMissionContent(e.target.value)}
          rows={5}
          className="w-full rounded-lg p-3 text-[14px] font-mono resize-y"
          style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none", minHeight: 80 }}
        />
        <button
          onClick={() => handleSaveFile("MISSION.md", missionContent, setMissionSaving)}
          disabled={missionSaving}
          className="mt-2 text-[13px] font-medium px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
          style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
        >
          {missionSaving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* ── Personality ─────────────────────────────────────────────────────── */}
      <div style={divider}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>Personality</span>
          <span className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>SOUL.md</span>
        </div>
        <p className="text-[13px] mb-2" style={{ color: "var(--text-tertiary)" }}>
          Your co-founder's DNA — decision-making style, risk tolerance, communication tone. Rarely needs changing once set.
        </p>
        <textarea
          value={soulContent}
          onChange={(e) => setSoulContent(e.target.value)}
          rows={6}
          className="w-full rounded-lg p-3 text-[14px] font-mono resize-y"
          style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none", minHeight: 100 }}
        />
        <button
          onClick={() => handleSaveFile("SOUL.md", soulContent, setSoulSaving)}
          disabled={soulSaving}
          className="mt-2 text-[13px] font-medium px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
          style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
        >
          {soulSaving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* ── Memory ──────────────────────────────────────────────────────────── */}
      <div style={divider}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>Memory</span>
          <span className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>MEMORY.md</span>
        </div>
        <p className="text-[13px] mb-2" style={{ color: "var(--text-tertiary)" }}>
          Lessons learned, what worked, what failed. Your co-founder updates this automatically — you can also edit it to correct course.
        </p>
        <textarea
          value={memoryContent}
          onChange={(e) => setMemoryContent(e.target.value)}
          rows={6}
          className="w-full rounded-lg p-3 text-[14px] font-mono resize-y"
          style={{ background: "var(--bg-inset)", color: "var(--text-primary)", border: "1px solid var(--border-default)", outline: "none", minHeight: 100 }}
        />
        <button
          onClick={() => handleSaveFile("MEMORY.md", memoryContent, setMemorySaving)}
          disabled={memorySaving}
          className="mt-2 text-[13px] font-medium px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
          style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
        >
          {memorySaving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* ── Decision-making ─────────────────────────────────────────────────── */}
      <div style={divider}>
        <label className="block text-[15px] font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
          Decision-making
        </label>
        <p className="text-[13px] mb-3" style={{ color: "var(--text-tertiary)" }}>
          Controls whether your co-founder asks before making significant changes.
        </p>
        <div className="flex gap-2">
          {AUTONOMY_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const selected = autonomy === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setAutonomy(opt.id)}
                className="flex-1 flex items-start gap-3 rounded-lg text-left transition-all duration-150 ease-out cursor-pointer"
                style={card(selected)}
                onMouseEnter={(e) => onHover(selected, true, e.currentTarget)}
                onMouseLeave={(e) => onHover(selected, false, e.currentTarget)}
              >
                <Icon size={18} style={{ color: "var(--text-secondary)", flexShrink: 0, marginTop: 2 }} />
                <div className="min-w-0">
                  <div className="font-medium" style={{ fontSize: 13, color: "var(--text-primary)" }}>{opt.label}</div>
                  <p className="mt-0.5" style={{ fontSize: 12, color: "var(--text-secondary)" }}>{opt.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Check-in frequency ──────────────────────────────────────────────── */}
      <div style={divider}>
        <label className="block text-[15px] font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
          Check-in frequency
        </label>
        <p className="text-[13px] mb-3" style={{ color: "var(--text-tertiary)" }}>
          How often your co-founder wakes up to check for tasks. It can self-adjust based on workload.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {CHECKIN_OPTIONS.map((opt) => {
            const selected = checkin === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setCheckin(opt.value)}
                className="rounded-lg text-center transition-all duration-150 ease-out cursor-pointer"
                style={card(selected)}
                onMouseEnter={(e) => onHover(selected, true, e.currentTarget)}
                onMouseLeave={(e) => onHover(selected, false, e.currentTarget)}
              >
                <div className="font-medium" style={{ fontSize: 14, color: "var(--text-primary)" }}>{opt.label}</div>
                <div className="mt-0.5" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{opt.sublabel}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Max session duration ─────────────────────────────────────────────── */}
      <div style={divider}>
        <label className="block text-[15px] font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
          Max session duration
        </label>
        <p className="text-[13px] mb-3" style={{ color: "var(--text-tertiary)" }}>
          How long each autonomous work session can run before wrapping up.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {SESSION_DURATION_OPTIONS.map((opt) => {
            const selected = duration === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setDuration(opt.value)}
                className="rounded-lg text-center transition-all duration-150 ease-out cursor-pointer"
                style={card(selected)}
                onMouseEnter={(e) => onHover(selected, true, e.currentTarget)}
                onMouseLeave={(e) => onHover(selected, false, e.currentTarget)}
              >
                <div className="font-medium" style={{ fontSize: 14, color: "var(--text-primary)" }}>{opt.label}</div>
                <div className="mt-0.5" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{opt.sublabel}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Save behavior ───────────────────────────────────────────────────── */}
      <button
        onClick={handleSaveBehavior}
        disabled={!behaviorDirty || behaviorSaving}
        className="w-full rounded-lg font-medium text-[14px] transition-all duration-150 ease-out cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ height: 42, background: behaviorSaved ? "var(--status-active)" : "var(--accent)", color: "white" }}
      >
        {behaviorSaving ? "Saving…" : behaviorSaved ? "Saved!" : "Save changes"}
      </button>

    </div>
  );
}
