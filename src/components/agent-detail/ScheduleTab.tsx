import { useState } from "react";
import { CalendarClock, Pause, Play, Plus, Trash } from "lucide-react";
import type { Agent, ScheduleEntry } from "@/types";
import { getSchedule, saveScheduleEntry, deleteScheduleEntry, toggleScheduleEntry } from "@/lib/api";

export interface ScheduleTabProps {
  agent: Agent;
  entries: ScheduleEntry[];
  setEntries: (e: ScheduleEntry[]) => void;
}

export default function ScheduleTab({ agent, entries, setEntries }: ScheduleTabProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [newTime, setNewTime] = useState("09:00");
  const [newAction, setNewAction] = useState("");
  const [newRecurrence, setNewRecurrence] = useState<"once" | "daily" | "weekdays" | "weekly">("daily");

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>Schedule</h2>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium cursor-pointer"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <Plus size={14} /> Add entry
          </button>
        </div>
        <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          Your co-founder's daily agenda. Both of you can add entries — they show up as commitments in each work session.
        </p>
      </div>

      {showAdd && (
        <div className="rounded-xl border p-4 space-y-3" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
          <div className="flex gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-medium" style={{ color: "var(--text-tertiary)" }}>Time</label>
              <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)}
                className="h-9 px-2.5 rounded-lg text-[14px] outline-none"
                style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
              />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[12px] font-medium" style={{ color: "var(--text-tertiary)" }}>What should happen</label>
              <input type="text" value={newAction} onChange={(e) => setNewAction(e.target.value)}
                placeholder="e.g. Send me a status update, Check analytics, Email leads..."
                className="h-9 px-2.5 rounded-lg text-[14px] outline-none w-full"
                style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-medium" style={{ color: "var(--text-tertiary)" }}>Repeat</label>
              <select value={newRecurrence} onChange={(e) => setNewRecurrence(e.target.value as typeof newRecurrence)}
                className="h-9 px-2 rounded-lg text-[14px] outline-none cursor-pointer"
                style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
              >
                <option value="once">One time</option>
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                if (!newAction.trim()) return;
                const entry: ScheduleEntry = { id: crypto.randomUUID(), time: newTime, action: newAction.trim(), recurrence: newRecurrence, source: "user", enabled: true };
                await saveScheduleEntry(agent.id, entry);
                setEntries(await getSchedule(agent.id));
                setNewAction("");
                setShowAdd(false);
              }}
              className="h-9 px-4 rounded-lg text-[13px] font-medium cursor-pointer"
              style={{ background: "var(--accent)", color: "white" }}
            >Save</button>
            <button onClick={() => setShowAdd(false)}
              className="h-9 px-4 rounded-lg text-[13px] font-medium cursor-pointer"
              style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
            >Cancel</button>
          </div>
        </div>
      )}

      {entries.length === 0 && !showAdd ? (
        <div className="rounded-xl border p-8 text-center" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
          <CalendarClock size={32} style={{ color: "var(--text-tertiary)", margin: "0 auto 8px" }} />
          <p className="text-[14px] font-medium" style={{ color: "var(--text-secondary)" }}>No schedule yet</p>
          <p className="text-[13px] mt-1" style={{ color: "var(--text-tertiary)" }}>
            Add entries to give your co-founder a daily routine. They can also schedule their own items.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry) => {
            const now = new Date();
            const [h, m] = entry.time.split(":").map(Number);
            const isPast = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
            const recurrenceLabel = { once: "One time", daily: "Daily", weekdays: "Weekdays", weekly: "Weekly" }[entry.recurrence] ?? entry.recurrence;
            return (
              <div key={entry.id} className="rounded-xl border p-3 flex items-center gap-3 group"
                style={{ background: "var(--bg-surface)", borderColor: entry.enabled ? "var(--border-default)" : "var(--border-subtle)", opacity: entry.enabled ? 1 : 0.5 }}>
                <div className="text-[15px] font-mono font-semibold tabular-nums w-14 shrink-0" style={{ color: isPast && entry.enabled ? "var(--accent)" : "var(--text-primary)" }}>{entry.time}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] leading-snug truncate" style={{ color: "var(--text-primary)" }}>{entry.action}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: entry.source === "user" ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "var(--bg-inset)", color: entry.source === "user" ? "var(--accent)" : "var(--text-tertiary)" }}>
                      {entry.source === "user" ? "You" : "Co-founder"}
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{recurrenceLabel}</span>
                    {isPast && entry.enabled && <span className="text-[11px] font-medium" style={{ color: "var(--accent)" }}>Due</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={async () => { await toggleScheduleEntry(agent.id, entry.id, !entry.enabled); setEntries(await getSchedule(agent.id)); }}
                    className="p-1.5 rounded-md cursor-pointer" style={{ color: "var(--text-tertiary)" }} title={entry.enabled ? "Disable" : "Enable"}>
                    {entry.enabled ? <Pause size={13} /> : <Play size={13} />}
                  </button>
                  <button onClick={async () => { await deleteScheduleEntry(agent.id, entry.id); setEntries(await getSchedule(agent.id)); }}
                    className="p-1.5 rounded-md cursor-pointer" style={{ color: "var(--status-error)" }} title="Delete">
                    <Trash size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
