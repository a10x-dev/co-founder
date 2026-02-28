import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "@/components/Sidebar";
import HomeView from "@/views/HomeView";
import AgentDetailView from "@/views/AgentDetailView";
import CreateAgentView from "@/views/CreateAgentView";
import ImportAgentView from "@/views/ImportAgentView";
import JourneyExportView from "@/views/JourneyExportView";
import SettingsView from "@/views/SettingsView";
import { useAgents } from "@/hooks/useAgents";
import { useNotifications } from "@/hooks/useNotifications";
import { detectClaudeCli, getGlobalSettings } from "@/lib/api";
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
  const { agents, loading, refetch } = useAgents();
  const { notify } = useNotifications();

  const handleSelectAgent = (id: string) => {
    setSelectedAgentId(id);
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

  const handleShareJourney = (agent: Agent, sessions: WorkSessionLog[]) => {
    setJourneyData({ agent, sessions });
    setView("journey");
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
            "Claude CLI not found. Install Claude CLI or set the path in Settings.",
          );
        }
      })
      .catch(() => {});

    listen<WorkSessionLog>("session-completed", (event) => {
      refetch();
      const payload = event.payload;
      if (!payload) return;

      if (payload.outcome === "blocked") {
        notify("Agent blocked", "An agent is blocked and needs your review.");
      } else if (payload.outcome === "error") {
        notify("Agent error", "An agent session ended with an error.");
      } else {
        notify("Session completed", "An agent finished a work session.");
      }
    }).then((fn) => {
      if (active) unlistenSession = fn;
    }).catch(() => {
      // Running outside Tauri (web dev) — no event bus available.
    });

    listen<{ message?: string }>("cli-missing", (event) => {
      const message =
        event.payload?.message ??
        "Claude CLI not found. Install Claude CLI or set the path in Settings.";
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
          event.payload?.error ?? "An agent session crashed unexpectedly.";
        notify("Session runtime error", message);
      },
    ).then((fn) => {
      if (active) unlistenSessionError = fn;
    }).catch(() => {
      // Running outside Tauri (web dev) — no event bus available.
    });

    return () => {
      active = false;
      if (unlistenSession) unlistenSession();
      if (unlistenCliMissing) unlistenCliMissing();
      if (unlistenSessionError) unlistenSessionError();
    };
  }, [notify, refetch]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        agents={agents}
        selectedAgentId={selectedAgentId}
        onSelectAgent={handleSelectAgent}
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
