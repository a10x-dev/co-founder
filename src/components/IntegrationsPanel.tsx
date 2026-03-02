import { useEffect, useState } from "react";
import { Plus, Trash2, Check, X, Github, MessageSquare, Database, Plug } from "lucide-react";
import { getIntegrations, saveIntegration, removeIntegration } from "@/lib/api";
import type { McpJson } from "@/types";
import FriendlyError from "@/components/FriendlyError";

interface CatalogEntry {
  key: string;
  name: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  description: string;
  command: string;
  args: string[];
  envFields: { key: string; label: string; placeholder: string }[];
}

const CATALOG: CatalogEntry[] = [
  {
    key: "github",
    name: "GitHub",
    icon: Github,
    description: "Manage issues, PRs, and repos",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envFields: [{ key: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "Personal Access Token", placeholder: "ghp_..." }],
  },
  {
    key: "slack",
    name: "Slack",
    icon: MessageSquare,
    description: "Read and send Slack messages",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    envFields: [{ key: "SLACK_BOT_TOKEN", label: "Bot Token", placeholder: "xoxb-..." }],
  },
  {
    key: "postgres",
    name: "PostgreSQL",
    icon: Database,
    description: "Query and manage your database",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    envFields: [{ key: "POSTGRES_URL", label: "Connection URL", placeholder: "postgres://user:pass@host:5432/db" }],
  },
];

interface IntegrationsPanelProps {
  agentId: string;
}

export default function IntegrationsPanel({ agentId }: IntegrationsPanelProps) {
  const [mcpData, setMcpData] = useState<McpJson>({ mcpServers: {} });
  const [connecting, setConnecting] = useState<string | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [showCustom, setShowCustom] = useState(false);
  const [customKey, setCustomKey] = useState("");
  const [customCommand, setCustomCommand] = useState("");
  const [customArgs, setCustomArgs] = useState("");
  const [customEnvKey, setCustomEnvKey] = useState("");
  const [customEnvValue, setCustomEnvValue] = useState("");
  const [customEnvPairs, setCustomEnvPairs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    getIntegrations(agentId).then(setMcpData).catch(() => {});
  };

  useEffect(() => {
    reload();
    setConnecting(null);
    setEnvValues({});
  }, [agentId]);

  const connectedKeys = Object.keys(mcpData.mcpServers);

  const handleConnect = async (entry: CatalogEntry) => {
    setError(null);
    const env: Record<string, string> = {};
    for (const field of entry.envFields) {
      const val = envValues[field.key];
      if (!val?.trim()) {
        setError(`${field.label} is required`);
        return;
      }
      env[field.key] = val.trim();
    }
    try {
      await saveIntegration(agentId, entry.key, entry.command, entry.args, env);
      setConnecting(null);
      setEnvValues({});
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDisconnect = async (key: string) => {
    try {
      await removeIntegration(agentId, key);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCustomSave = async () => {
    setError(null);
    if (!customKey.trim() || !customCommand.trim()) {
      setError("Name and command are required");
      return;
    }
    const key = customKey.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const args = customArgs.trim() ? customArgs.trim().split(/\s+/) : [];
    try {
      await saveIntegration(agentId, key, customCommand.trim(), args, customEnvPairs);
      setShowCustom(false);
      setCustomKey("");
      setCustomCommand("");
      setCustomArgs("");
      setCustomEnvPairs({});
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>Integrations</h2>
        <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>{connectedKeys.length} connected</span>
      </div>
      <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
        Connect services so your co-founder can interact with them directly.
      </p>

      {error && <FriendlyError error={error} />}

      {/* Connected integrations */}
      {connectedKeys.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
          {connectedKeys.map((key, i) => {
            const catalogEntry = CATALOG.find((c) => c.key === key);
            const Icon = catalogEntry?.icon ?? Plug;
            const name = catalogEntry?.name ?? key;
            return (
              <div
                key={key}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: i < connectedKeys.length - 1 ? "1px solid var(--border-default)" : "none" }}
              >
                <Icon size={18} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <span className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>{name}</span>
                </div>
                <span className="flex items-center gap-1 text-[12px] font-medium" style={{ color: "var(--status-active)" }}>
                  <Check size={12} /> Connected
                </span>
                <button
                  onClick={() => handleDisconnect(key)}
                  className="text-[13px] cursor-pointer shrink-0 ml-2"
                  style={{ color: "var(--status-error)" }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Catalog */}
      <div className="grid grid-cols-2 gap-3">
        {CATALOG.filter((c) => !connectedKeys.includes(c.key)).map((entry) => {
          const Icon = entry.icon;
          const isConnecting = connecting === entry.key;
          return (
            <div
              key={entry.key}
              className="rounded-xl border p-4 flex flex-col"
              style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon size={20} style={{ color: "var(--text-secondary)" }} />
                <span className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>{entry.name}</span>
              </div>
              <p className="text-[13px] mb-3 flex-1" style={{ color: "var(--text-tertiary)" }}>{entry.description}</p>

              {isConnecting ? (
                <div className="space-y-2">
                  {entry.envFields.map((field) => (
                    <div key={field.key}>
                      <label className="block text-[12px] mb-1" style={{ color: "var(--text-secondary)" }}>{field.label}</label>
                      <input
                        type="password"
                        value={envValues[field.key] ?? ""}
                        onChange={(e) => setEnvValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className="w-full h-8 px-2 rounded text-[13px] font-mono outline-none"
                        style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                      />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConnect(entry)}
                      className="flex-1 h-8 rounded text-[13px] font-medium cursor-pointer"
                      style={{ background: "var(--accent)", color: "white" }}
                    >
                      Connect
                    </button>
                    <button
                      onClick={() => { setConnecting(null); setEnvValues({}); setError(null); }}
                      className="h-8 px-3 rounded text-[13px] cursor-pointer"
                      style={{ color: "var(--text-secondary)", background: "var(--bg-inset)" }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setConnecting(entry.key); setError(null); }}
                  className="h-8 rounded text-[13px] font-medium cursor-pointer transition-all duration-150"
                  style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-inset)"; }}
                >
                  Connect
                </button>
              )}
            </div>
          );
        })}

        {/* Custom integration card */}
        {!showCustom ? (
          <button
            onClick={() => setShowCustom(true)}
            className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-8 transition-all duration-150 ease-out cursor-pointer"
            style={{ borderColor: "var(--border-default)", background: "var(--bg-app)" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--text-tertiary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; }}
          >
            <Plus size={20} className="mb-1" style={{ color: "var(--text-tertiary)" }} />
            <span className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>Add Custom</span>
          </button>
        ) : (
          <div className="rounded-xl border p-4 col-span-2 space-y-3" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
            <h3 className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>Custom Integration</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[12px] mb-1" style={{ color: "var(--text-secondary)" }}>Name</label>
                <input
                  type="text" value={customKey} onChange={(e) => setCustomKey(e.target.value)}
                  placeholder="my-server"
                  className="w-full h-8 px-2 rounded text-[13px] outline-none"
                  style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label className="block text-[12px] mb-1" style={{ color: "var(--text-secondary)" }}>Command</label>
                <input
                  type="text" value={customCommand} onChange={(e) => setCustomCommand(e.target.value)}
                  placeholder="npx"
                  className="w-full h-8 px-2 rounded text-[13px] font-mono outline-none"
                  style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                />
              </div>
            </div>
            <div>
              <label className="block text-[12px] mb-1" style={{ color: "var(--text-secondary)" }}>Arguments (space-separated)</label>
              <input
                type="text" value={customArgs} onChange={(e) => setCustomArgs(e.target.value)}
                placeholder="-y @modelcontextprotocol/server-my-service"
                className="w-full h-8 px-2 rounded text-[13px] font-mono outline-none"
                style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
              />
            </div>
            <div>
              <label className="block text-[12px] mb-1" style={{ color: "var(--text-secondary)" }}>Environment Variables</label>
              <div className="space-y-1">
                {Object.entries(customEnvPairs).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1 text-[12px] font-mono" style={{ color: "var(--text-secondary)" }}>
                    <span>{k}=••••</span>
                    <button onClick={() => setCustomEnvPairs((prev) => { const n = { ...prev }; delete n[k]; return n; })}
                      className="cursor-pointer" style={{ color: "var(--status-error)" }}><X size={12} /></button>
                  </div>
                ))}
                <div className="flex gap-1">
                  <input type="text" value={customEnvKey} onChange={(e) => setCustomEnvKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
                    placeholder="KEY" className="w-28 h-7 px-2 rounded text-[12px] font-mono outline-none"
                    style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }} />
                  <input type="password" value={customEnvValue} onChange={(e) => setCustomEnvValue(e.target.value)}
                    placeholder="value" className="flex-1 h-7 px-2 rounded text-[12px] font-mono outline-none"
                    style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }} />
                  <button onClick={() => {
                    if (customEnvKey.trim()) { setCustomEnvPairs((prev) => ({ ...prev, [customEnvKey.trim()]: customEnvValue })); setCustomEnvKey(""); setCustomEnvValue(""); }
                  }} className="h-7 px-2 rounded text-[12px] font-medium cursor-pointer"
                    style={{ background: "var(--bg-inset)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}>Add</button>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleCustomSave}
                className="flex-1 h-8 rounded text-[13px] font-medium cursor-pointer"
                style={{ background: "var(--accent)", color: "white" }}>Save</button>
              <button onClick={() => { setShowCustom(false); setCustomKey(""); setCustomCommand(""); setCustomArgs(""); setCustomEnvPairs({}); }}
                className="h-8 px-3 rounded text-[13px] cursor-pointer"
                style={{ color: "var(--text-secondary)", background: "var(--bg-inset)" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
