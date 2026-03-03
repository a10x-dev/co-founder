import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, FolderOpen, Settings, PanelLeftClose, PanelLeft } from "lucide-react";
import type { Agent, AgentStatus } from "@/types";

function StarburstIcon({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="shrink-0">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <line
          key={angle}
          x1="12" y1="2" x2="12" y2="8"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
    </svg>
  );
}

const STORAGE_KEY = "sidebar-width";
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 260;

interface SidebarProps {
  agents: Agent[];
  selectedAgentId: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onSelectAgent: (id: string) => void;
  onHome: () => void;
  onNewAgent: () => void;
  onImportAgent: () => void;
  onSettings: () => void;
}

const statusColors: Record<AgentStatus, string> = {
  idle: "var(--status-idle)",
  running: "var(--status-active)",
  paused: "var(--status-paused)",
  error: "var(--status-error)",
};

const statusLabels: Record<AgentStatus, string> = {
  idle: "Idle",
  running: "Running",
  paused: "Paused",
  error: "Error",
};

function getStoredWidth(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch { /* noop */ }
  return DEFAULT_WIDTH;
}

export default function Sidebar({
  agents,
  selectedAgentId,
  isOpen,
  onToggle,
  onSelectAgent,
  onHome,
  onNewAgent,
  onImportAgent,
  onSettings,
}: SidebarProps) {
  const [width, setWidth] = useState(getStoredWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW.current + delta));
      setWidth(next);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem(STORAGE_KEY, String(width)); } catch { /* noop */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [width]);

  if (!isOpen) {
    const miniBtn = "p-2 rounded-lg cursor-pointer flex items-center justify-center";
    return (
      <div className="flex flex-col h-full shrink-0" style={{ width: 52, background: "var(--bg-sidebar)" }}>
        <div className="flex flex-col items-center gap-1 pt-4 pb-3">
          <button
            onClick={onToggle}
            className={miniBtn}
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            title="Show sidebar (⌘B)"
          >
            <PanelLeft size={18} />
          </button>
          <button
            onClick={onHome}
            className={miniBtn}
            style={{ color: selectedAgentId ? "var(--text-tertiary)" : "var(--accent)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            title="Home"
          >
            <StarburstIcon size={16} color={selectedAgentId ? "var(--text-tertiary)" : "var(--accent)"} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col items-center gap-1.5 px-1.5 min-h-0">
          {agents.map((agent) => {
            const selected = agent.id === selectedAgentId;
            return (
              <button
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer shrink-0 text-[13px] font-semibold"
                style={{
                  background: selected ? "var(--accent-subtle)" : "transparent",
                  color: selected ? "var(--accent)" : "var(--text-secondary)",
                  border: selected ? "1.5px solid var(--accent)" : "1.5px solid transparent",
                }}
                onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
                title={`${agent.name} — ${statusLabels[agent.status]}`}
              >
                <span className="relative">
                  {agent.name.charAt(0).toUpperCase()}
                  <span
                    className="absolute -bottom-0.5 -right-1 w-2 h-2 rounded-full border border-white"
                    style={{ background: statusColors[agent.status] }}
                  />
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-1 py-3 border-t" style={{ borderColor: "var(--border-default)" }}>
          <button onClick={onNewAgent} className={miniBtn} style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            title="New Co-Founder"
          >
            <Plus size={16} />
          </button>
          <button onClick={onImportAgent} className={miniBtn} style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            title="Import Project"
          >
            <FolderOpen size={16} />
          </button>
          <button onClick={onSettings} className={miniBtn} style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            title="Settings"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative shrink-0 flex" style={{ width }}>
      <aside
        className="flex flex-col h-full min-h-0 flex-1"
        style={{ background: "var(--bg-sidebar)" }}
      >
        <div
          className="px-5 pt-5 pb-4 flex items-center justify-between select-none"
          data-tauri-drag-region
        >
          <button
            onClick={onHome}
            className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em] uppercase cursor-pointer rounded-md px-1.5 py-1 -ml-1.5"
            style={{ color: "var(--text-tertiary)", background: "none", border: "none" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.background = "none"; }}
            title="Go to Home"
          >
            <StarburstIcon size={14} color="currentColor" />
            Co-Founder
          </button>
          <button
            onClick={onToggle}
            className="p-1 rounded cursor-pointer"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-tertiary)")}
            title="Hide sidebar (⌘B)"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 min-h-0">
          {agents.length === 0 && (
            <div
              className="text-[13px] px-3 py-6 text-center select-none"
              style={{ color: "var(--text-tertiary)" }}
            >
              No co-founders yet
            </div>
          )}
          {agents.map((agent) => {
            const selected = agent.id === selectedAgentId;
            return (
              <button
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className="w-full text-left rounded-lg px-3 py-2.5 mb-0.5 transition-all duration-100 ease-out cursor-pointer"
                style={{
                  background: selected ? "var(--accent-subtle)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!selected)
                    e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!selected)
                    e.currentTarget.style.background = "transparent";
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="block w-2 h-2 rounded-full shrink-0"
                    style={{ background: statusColors[agent.status] }}
                  />
                  <span
                    className="text-[14px] font-medium truncate"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {agent.name}
                  </span>
                </div>
                <div
                  className="text-[12px] mt-0.5 ml-4"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {statusLabels[agent.status]}
                </div>
              </button>
            );
          })}
        </div>

        <div
          className="px-3 py-3 border-t flex flex-col gap-1"
          style={{ borderColor: "var(--border-default)" }}
        >
          <button
            onClick={onNewAgent}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[14px] font-medium transition-all duration-100 ease-out cursor-pointer"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--bg-hover)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <Plus size={16} strokeWidth={2} />
            New Co-Founder
          </button>
          <button
            onClick={onImportAgent}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[14px] font-medium transition-all duration-100 ease-out cursor-pointer"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--bg-hover)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <FolderOpen size={16} strokeWidth={2} />
            Import Project
          </button>
          <button
            onClick={onSettings}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[14px] font-medium transition-all duration-100 ease-out cursor-pointer"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--bg-hover)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <Settings size={16} strokeWidth={2} />
            Settings
          </button>
        </div>
      </aside>

      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className="absolute top-0 right-0 h-full z-10 group"
        style={{ width: 6, cursor: "col-resize" }}
      >
        <div
          className="h-full transition-opacity duration-150 opacity-0 group-hover:opacity-100"
          style={{ width: 2, marginLeft: 2, background: "var(--accent)" }}
        />
      </div>
    </div>
  );
}
