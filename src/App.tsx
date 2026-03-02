import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "@/components/Sidebar";
import HomeView from "@/views/HomeView";
import AgentDetailView from "@/views/AgentDetailView";
import CreateAgentView from "@/views/CreateAgentView";
import ImportAgentView from "@/views/ImportAgentView";
import JourneyExportView from "@/views/JourneyExportView";
import OnboardingView from "@/views/OnboardingView";
import SettingsView from "@/views/SettingsView";
import { useAgents } from "@/hooks/useAgents";
import { useNotifications } from "@/hooks/useNotifications";
import { detectClaudeCli, getGlobalSettings, getWorkSessionsExport } from "@/lib/api";
import type { Agent, WorkSessionLog } from "@/types";

type View = "home" | "create" | "import" | "settings" | "journey";

export default function App() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [journeyData, setJourneyData] = useState<{
    agent: Agent;
    sessions: WorkSessionLog[];
  } | null>(null);
  const [cliWarning, setCliWarning] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { agents, loading, refetch } = useAgents();
  const { notify } = useNotifications();

  const toggleSidebar = useCallback(() => setSidebarOpen((p) => !p), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleSidebar]);

  const handleSelectAgent = (id: string) => {
    setSelectedAgentId(id);
    setView("home");
  };

  const handleHome = () => {
    setSelectedAgentId(null);
    setView("home");
  };

  const handleNewAgent = () => {
    setSelectedAgentId(null);
    setView("create");
  };

  const handleSettings = () => {
    setSelectedAgentId(null);
    setView("settings");
  };

  const handleAgentCreated = () => {
    refetch();
    setView("home");
  };

  const handleImportAgent = () => {
    setSelectedAgentId(null);
    setView("import");
  };

  const handleShareJourney = async (agent: Agent) => {
    try {
      const sessions = await getWorkSessionsExport(agent.id);
      setJourneyData({ agent, sessions });
      setView("journey");
    } catch (err) {
      console.error("Failed to export sessions:", err);
      notify("Export failed", "Could not load sessions for export.");
    }
  };

  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId)
    : null;

  useEffect(() => {
    let unlistenSession: (() => void) | null = null;
    let unlistenCliMissing: (() => void) | null = null;
    let unlistenSessionError: (() => void) | null = null;
    let active = true;

    getGlobalSettings()
      .then((settings) => {
        if (!active) return;
        if (settings.claude_cli_path) return;
        return detectClaudeCli();
      })
      .then((path) => {
        if (!active) return;
        if (path === undefined) return;
        if (!path) {
          setCliWarning(
            "Claude Code not found. Install it to start using your co-founders.",
          );
        }
      })
      .catch(() => {});

    listen<WorkSessionLog>("session-completed", (event) => {
      refetch();
      const payload = event.payload;
      if (!payload) return;

      if (payload.outcome === "blocked") {
        notify("Co-founder blocked", "Your co-founder is blocked and needs your review.");
      } else if (payload.outcome === "error") {
        notify("Co-founder error", "A work session ended with an error.");
      } else {
        notify("Session completed", "Your co-founder finished a work session.");
      }
    }).then((fn) => {
      if (active) unlistenSession = fn;
    }).catch(() => {
      // Running outside Tauri (web dev) — no event bus available.
    });

    listen<{ message?: string }>("cli-missing", (event) => {
      const message =
        event.payload?.message ??
        "Claude Code not found. Install it to start using your co-founders.";
      setCliWarning(message);
    }).then((fn) => {
      if (active) unlistenCliMissing = fn;
    }).catch(() => {
      // Running outside Tauri (web dev) — no event bus available.
    });

    listen<{ agent_id?: string; error?: string }>(
      "session-runtime-error",
      (event) => {
        refetch();
        const message =
          event.payload?.error ?? "A work session crashed unexpectedly.";
        notify("Session runtime error", message);
      },
    ).then((fn) => {
      if (active) unlistenSessionError = fn;
    }).catch(() => {
      // Running outside Tauri (web dev) — no event bus available.
    });

    let unlistenBudget: (() => void) | null = null;
    listen<{ agent_name?: string; daily_spend?: number; budget?: number }>("budget-exceeded", (event) => {
      const name = event.payload?.agent_name ?? "Your co-founder";
      notify("Budget limit reached", `${name} paused — daily spend reached $${event.payload?.daily_spend?.toFixed(2) ?? "?"}.`);
      refetch();
    }).then((fn) => {
      if (active) unlistenBudget = fn;
    }).catch(() => {});

    let unlistenReport: (() => void) | null = null;
    listen<{ agent_name?: string }>("daily-report-ready", (event) => {
      const name = event.payload?.agent_name ?? "Your co-founder";
      notify("Daily report ready", `${name}'s morning summary is ready.`);
    }).then((fn) => {
      if (active) unlistenReport = fn;
    }).catch(() => {});

    return () => {
      active = false;
      if (unlistenSession) unlistenSession();
      if (unlistenCliMissing) unlistenCliMissing();
      if (unlistenSessionError) unlistenSessionError();
      if (unlistenReport) unlistenReport();
      if (unlistenBudget) unlistenBudget();
    };
  }, [notify, refetch]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        agents={agents}
        selectedAgentId={selectedAgentId}
        isOpen={sidebarOpen}
        onToggle={toggleSidebar}
        onSelectAgent={handleSelectAgent}
        onHome={handleHome}
        onNewAgent={handleNewAgent}
        onImportAgent={handleImportAgent}
        onSettings={handleSettings}
      />

      <main
        className="flex-1 min-w-0 overflow-y-auto"
        style={{ background: "var(--bg-app)" }}
      >
        {cliWarning && (
          <div className="mx-8 mt-6 rounded-lg border px-4 py-3 flex items-start justify-between gap-4" style={{ borderColor: "var(--status-working)", background: "var(--bg-surface)" }}>
            <p className="text-[14px]" style={{ color: "var(--text-primary)" }}>
              {cliWarning}
            </p>
            <button
              onClick={() => setCliWarning(null)}
              className="text-[13px] font-medium shrink-0 cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <div
            className="flex items-center justify-center h-full text-[14px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            Loading...
          </div>
        ) : view === "create" ? (
          <CreateAgentView
            onCreated={handleAgentCreated}
            onCancel={() => setView("home")}
          />
        ) : view === "import" ? (
          <ImportAgentView
            onImported={handleAgentCreated}
            onCancel={() => setView("home")}
          />
        ) : view === "journey" && journeyData ? (
          <JourneyExportView
            agent={journeyData.agent}
            sessions={journeyData.sessions}
            onClose={() => setView("home")}
          />
        ) : view === "settings" ? (
          <SettingsView />
        ) : selectedAgent ? (
          <AgentDetailView
            agent={selectedAgent}
            onRefetch={refetch}
            onShareJourney={handleShareJourney}
            onDeleted={() => {
              setSelectedAgentId(null);
              setView("home");
              refetch();
            }}
          />
        ) : agents.length === 0 ? (
          <OnboardingView
            onCreated={handleAgentCreated}
            onImport={handleImportAgent}
          />
        ) : (
          <HomeView
            agents={agents}
            onSelectAgent={handleSelectAgent}
            onNewAgent={handleNewAgent}
            onImportAgent={handleImportAgent}
            onRefetch={refetch}
          />
        )}
      </main>
    </div>
  );
}
