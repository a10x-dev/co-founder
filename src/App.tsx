import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import HomeView from "@/views/HomeView";
import AgentDetailView from "@/views/AgentDetailView";
import CreateAgentView from "@/views/CreateAgentView";
import { useAgents } from "@/hooks/useAgents";

type View = "home" | "create" | "settings";

export default function App() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const { agents, loading, refetch } = useAgents();

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

  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId)
    : null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        agents={agents}
        selectedAgentId={selectedAgentId}
        onSelectAgent={handleSelectAgent}
        onNewAgent={handleNewAgent}
        onSettings={handleSettings}
      />

      <main
        className="flex-1 min-w-0 overflow-y-auto"
        style={{ background: "var(--bg-app)" }}
      >
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
        ) : view === "settings" ? (
          <div className="p-8">
            <h1
              className="text-[20px] font-semibold mb-2"
              style={{ color: "var(--text-primary)" }}
            >
              Settings
            </h1>
            <p
              className="text-[14px]"
              style={{ color: "var(--text-secondary)" }}
            >
              Global settings coming soon.
            </p>
          </div>
        ) : selectedAgent ? (
          <AgentDetailView agent={selectedAgent} onRefetch={refetch} />
        ) : (
          <HomeView
            agents={agents}
            onSelectAgent={handleSelectAgent}
            onNewAgent={handleNewAgent}
            onRefetch={refetch}
          />
        )}
      </main>
    </div>
  );
}
