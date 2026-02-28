import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Search } from "lucide-react";
import { detectClaudeCli, getGlobalSettings, updateGlobalSettings } from "@/lib/api";
import type { GlobalSettings } from "@/types";

const buttonClass =
  "rounded-lg font-medium transition-all duration-150 ease-out cursor-pointer";

export default function SettingsView() {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    getGlobalSettings()
      .then((data) => {
        if (!active) return;
        setSettings(data);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const updateField = <K extends keyof GlobalSettings>(
    key: K,
    value: GlobalSettings[K],
  ) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const chooseWorkspaceRoot = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Default Workspace Folder",
      });
      if (selected && typeof selected === "string") {
        updateField("default_workspace_root", selected);
      }
    } catch {
      setError("Could not open folder picker");
    }
  };

  const autoDetectClaude = async () => {
    setMessage(null);
    setError(null);
    setDetecting(true);
    try {
      const path = await detectClaudeCli();
      if (!path) {
        setError("Claude CLI not found in PATH.");
        return;
      }
      updateField("claude_cli_path", path);
      setMessage("Detected Claude CLI path.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetecting(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      await updateGlobalSettings(settings);
      setMessage("Settings saved. Concurrency changes apply after restart.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-[14px]" style={{ color: "var(--text-tertiary)" }}>
        Loading settings...
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-8 text-[14px]" style={{ color: "var(--status-error)" }}>
        {error ?? "Failed to load settings."}
      </div>
    );
  }

  return (
    <div className="max-w-[760px] mx-auto px-8 pt-10 pb-14">
      <h1 className="text-[28px] font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
        Settings
      </h1>
      <p className="text-[15px] mb-8" style={{ color: "var(--text-secondary)" }}>
        Configure runtime defaults and system integrations.
      </p>

      <div className="rounded-xl border p-6 space-y-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
        <div>
          <label className="block text-[14px] font-medium mb-2" style={{ color: "var(--text-primary)" }}>
            Default workspace root
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.default_workspace_root}
              onChange={(e) => updateField("default_workspace_root", e.target.value)}
              className="flex-1 rounded-lg outline-none h-11 px-3"
              style={{
                background: "var(--bg-inset)",
                border: "1px solid var(--border-default)",
                color: "var(--text-primary)",
              }}
            />
            <button
              onClick={chooseWorkspaceRoot}
              className={`${buttonClass} h-11 px-3 inline-flex items-center gap-2`}
              style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
            >
              <FolderOpen size={16} strokeWidth={2} />
              Browse
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[14px] font-medium mb-2" style={{ color: "var(--text-primary)" }}>
            Max concurrent agents
          </label>
          <input
            type="number"
            min={1}
            max={10}
            value={settings.max_concurrent_agents}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              if (Number.isNaN(parsed)) return;
              updateField("max_concurrent_agents", Math.min(10, Math.max(1, parsed)));
            }}
            className="w-32 rounded-lg outline-none h-11 px-3"
            style={{
              background: "var(--bg-inset)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          />
          <p className="text-[12px] mt-2" style={{ color: "var(--text-tertiary)" }}>
            Changes apply after app restart.
          </p>
        </div>

        <div>
          <label className="block text-[14px] font-medium mb-2" style={{ color: "var(--text-primary)" }}>
            Claude CLI path
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.claude_cli_path}
              onChange={(e) => updateField("claude_cli_path", e.target.value)}
              placeholder="claude"
              className="flex-1 rounded-lg outline-none h-11 px-3"
              style={{
                background: "var(--bg-inset)",
                border: "1px solid var(--border-default)",
                color: "var(--text-primary)",
              }}
            />
            <button
              onClick={autoDetectClaude}
              disabled={detecting}
              className={`${buttonClass} h-11 px-3 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
              style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
            >
              <Search size={16} strokeWidth={2} />
              {detecting ? "Detecting..." : "Detect"}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: "var(--bg-inset)" }}>
          <div>
            <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
              Minimize to tray on close
            </p>
            <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              Keep agents running in the background.
            </p>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only"
              checked={settings.minimize_to_tray}
              onChange={(e) => updateField("minimize_to_tray", e.target.checked)}
            />
            <span
              className="w-10 h-6 rounded-full relative transition-all"
              style={{
                background: settings.minimize_to_tray
                  ? "var(--accent)"
                  : "var(--border-strong)",
              }}
            >
              <span
                className="absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all"
                style={{ left: settings.minimize_to_tray ? 18 : 2 }}
              />
            </span>
          </label>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`${buttonClass} h-11 px-5 disabled:opacity-50 disabled:cursor-not-allowed`}
            style={{ background: "var(--accent)", color: "white" }}
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
          {message && <p className="text-[13px]" style={{ color: "var(--status-active)" }}>{message}</p>}
          {error && <p className="text-[13px]" style={{ color: "var(--status-error)" }}>{error}</p>}
        </div>
      </div>
    </div>
  );
}
