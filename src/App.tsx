import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "@/components/Sidebar";
import HomeView from "@/views/HomeView";
import AgentDetailView from "@/views/AgentDetailView";
import CreateAgentView from "@/views/CreateAgentView";
import ImportAgentView from "@/views/ImportAgentView";
import JourneyExportView from "@/views/JourneyExportView";
import OnboardingView from "@/views/OnboardingView";
import SettingsView from "@/views/SettingsView";
import PairView from "@/views/PairView";
import SetupView from "@/views/SetupView";
import { useAgents } from "@/hooks/useAgents";
import { useNotifications } from "@/hooks/useNotifications";
import { useUpdater } from "@/hooks/useUpdater";
import { UpdateNotification } from "@/components/UpdateNotification";
import {
  getGlobalSettings,
  getWorkSessionsExport,
  startPairSession,
  endPairSession as endPairSessionApi,
  getPairSessionMessages,
  checkClaudeCliStatus,
} from "@/lib/api";
import type { Agent, PairSessionEndedEvent, WorkSessionLog } from "@/types";

type View = "home" | "create" | "import" | "settings" | "journey" | "pair";

interface PairSessionState {
  agentId: string;
  sessionId: string;
}

export default function App() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [journeyData, setJourneyData] = useState<{
    agent: Agent;
    sessions: WorkSessionLog[];
  } | null>(null);
  const [pairSession, setPairSession] = useState<PairSessionState | null>(null);
  const [pairInitialMessages, setPairInitialMessages] = useState<Array<{ id: string; role: "user" | "agent"; text: string; timestamp: number }> | undefined>(undefined);
  const [readOnlyMessages, setReadOnlyMessages] = useState<Array<{ id: string; role: "user" | "agent"; text: string; timestamp: number }> | null>(null);
  const [cliReady, setCliReady] = useState<boolean | null>(null); // null = checking
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { agents, loading, refetch } = useAgents();
  const { notify } = useNotifications();
  const { status: updateStatus, updateInfo, downloadProgress, downloadAndInstall, dismiss: dismissUpdate } = useUpdater();

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

  const pairSessionRef = useRef(pairSession);
  pairSessionRef.current = pairSession;

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

  const handleReturnToPair = () => {
    if (pairSession) {
      setSelectedAgentId(pairSession.agentId);
      setView("pair");
    }
  };

  const handleStartPair = async (agent: Agent) => {
    try {
      setPairInitialMessages(undefined);
      const started = await startPairSession(agent.id, "");
      setSelectedAgentId(agent.id);
      setPairSession({
        agentId: agent.id,
        sessionId: started.session_id,
      });
      setView("pair");
      refetch();
    } catch (err) {
      console.error("Failed to start pair session:", err);
      notify("Pair session failed", "Could not start a pair session for this co-founder.");
      setPairSession(null);
      setSelectedAgentId(agent.id);
      setView("home");
      refetch();
    }
  };

  const handleAgentCreated = async (agent: Agent) => {
    refetch();
    await handleStartPair(agent);
  };

  const handleAgentImported = () => {
    refetch();
    setView("home");
  };

  const cleanupPair = async (continueAutonomous: boolean) => {
    const prev = pairSession;
    if (!prev) return;
    setPairSession(null);
    try {
      await endPairSessionApi(prev.agentId, prev.sessionId, continueAutonomous);
    } catch {
      // best-effort — session may have already ended server-side
    }
  };

  const stableRefetch = useCallback(() => refetch(), [refetch]);

  const handleEndPair = async () => {
    const agentId = pairSession?.agentId;
    await cleanupPair(true);
    if (agentId) setSelectedAgentId(agentId);
    setView("home");
    refetch();
  };

  const handleNewPair = async () => {
    if (!pairAgent) return;
    const agent = pairAgent;
    await cleanupPair(false);
    await handleStartPair(agent);
  };

  const handleViewPastSession = async (pastSessionId: string) => {
    if (!pairAgent) return;
    try {
      const msgs = await getPairSessionMessages(pairAgent.id, pastSessionId);
      const chatMsgs = msgs.map((m: { role: string; content: string; created_at: string }, i: number) => ({
        id: `history-${i}-${Date.now()}`,
        role: m.role as "user" | "agent",
        text: m.content,
        timestamp: new Date(m.created_at).getTime(),
      }));
      setReadOnlyMessages(chatMsgs);
    } catch (err) {
      console.error("Failed to load past session:", err);
      notify("Load failed", "Could not load the past session.");
    }
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
  const pairAgent = pairSession
    ? agents.find((a) => a.id === pairSession.agentId) ?? null
    : null;

  useEffect(() => {
    let unlistenSession: (() => void) | null = null;
    let unlistenCliMissing: (() => void) | null = null;
    let unlistenSessionError: (() => void) | null = null;
    let active = true;

    checkClaudeCliStatus()
      .then((status) => {
        if (!active) return;
        if (status.installed) {
          setCliReady(true);
        } else {
          // detect_claude_path already checked common locations;
          // only extra value is a user-configured path in settings
          return getGlobalSettings().then((settings) => {
            if (!active) return;
            setCliReady(!!settings.claude_cli_path);
          });
        }
      })
      .catch(() => {
        if (active) setCliReady(false);
      });

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

    listen<{ message?: string }>("cli-missing", () => {
      // If CLI goes missing at runtime, flip back to setup
      setCliReady(false);
    }).then((fn) => {
      if (active) unlistenCliMissing = fn;
    }).catch(() => {});

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

  useEffect(() => {
    let active = true;
    let unlistenLiveEnded: (() => void) | null = null;

    listen<PairSessionEndedEvent>("pair-session-ended", (event) => {
      if (!active || !pairSession) return;
      const payload = event.payload;
      if (
        payload.agent_id !== pairSession.agentId ||
        payload.session_id !== pairSession.sessionId
      ) {
        return;
      }
      refetch();
      // View stays on PairView; the component shows end state + "Back to Agent" button.
    })
      .then((fn) => {
        if (active) unlistenLiveEnded = fn;
      })
      .catch(() => {});

    return () => {
      active = false;
      if (unlistenLiveEnded) unlistenLiveEnded();
    };
  }, [pairSession, notify, refetch]);

  // Gate on CLI setup
  if (cliReady === null) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: "var(--bg-app)" }}>
        <div className="text-[14px]" style={{ color: "var(--text-tertiary)" }}>Loading…</div>
      </div>
    );
  }

  if (cliReady === false) {
    return (
      <div className="h-screen" style={{ background: "var(--bg-app)" }}>
        <SetupView onComplete={() => setCliReady(true)} />
      </div>
    );
  }

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
        {/* PairView stays mounted while session is active — hidden when not in pair view */}
        {pairSession && pairAgent && (
          <div className={view === "pair" ? "h-full" : "hidden"}>
            <PairView
              agent={pairAgent}
              sessionId={pairSession.sessionId}
              onManualEnd={handleEndPair}
              onNewSession={() => void handleNewPair()}
              onSessionEnded={stableRefetch}
              onViewPastSession={(pastSessionId) => void handleViewPastSession(pastSessionId)}
              readOnlyMessages={readOnlyMessages}
              onCloseReadOnly={() => setReadOnlyMessages(null)}
              initialMessages={pairInitialMessages}
            />
          </div>
        )}

        {/* Return to session pill — shown when pair is active but user navigated away */}
        {pairSession && pairAgent && view !== "pair" && (
          <button
            onClick={handleReturnToPair}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-medium cursor-pointer shadow-lg"
            style={{
              background: "var(--accent)",
              color: "white",
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            }}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "rgba(255,255,255,0.6)" }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "white" }} />
            </span>
            Return to pair session
          </button>
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
            onImported={handleAgentImported}
            onCancel={() => setView("home")}
          />
        ) : view === "pair" ? (
          null /* PairView rendered above, always mounted */
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
            onStartPair={handleStartPair}
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
      <UpdateNotification
        status={updateStatus}
        updateInfo={updateInfo}
        downloadProgress={downloadProgress}
        onDownload={downloadAndInstall}
        onDismiss={dismissUpdate}
      />
    </div>
  );
}
