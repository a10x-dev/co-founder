import { X, Download } from "lucide-react";
import type { Agent, WorkSessionLog } from "@/types";

export interface JourneyExportViewProps {
  agent: Agent;
  sessions: WorkSessionLog[];
  onClose: () => void;
}

const OUTCOME_COLORS: Record<WorkSessionLog["outcome"], string> = {
  completed: "var(--status-active)",
  blocked: "var(--status-working)",
  timeout: "var(--status-idle)",
  error: "var(--status-error)",
};

function formatSessionDate(isoString: string): string {
  const d = new Date(isoString);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${day}, ${time}`;
}

function formatSessionDuration(started: string, ended: string | null): string {
  const end = ended ? new Date(ended).getTime() : Date.now();
  const start = new Date(started).getTime();
  const diffMins = Math.floor((end - start) / 60000);
  return `${diffMins} min`;
}

function formatDateRange(sessions: WorkSessionLog[]): string {
  if (sessions.length === 0) return "—";
  const first = new Date(sessions[sessions.length - 1].started_at);
  const last = new Date(sessions[0].started_at);
  return `${first.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – ${last.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function generateExportHtml(agent: Agent, sessions: WorkSessionLog[]): string {
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );
  const dateRange = formatDateRange(sortedSessions);

  const sessionEntries = sortedSessions
    .map((s, i) => {
      const color = OUTCOME_COLORS[s.outcome];
      const dateTime = formatSessionDate(s.started_at);
      const duration = formatSessionDuration(s.started_at, s.ended_at);
      const summary = (s.summary || "No summary").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const isLast = i === sortedSessions.length - 1;
      const line = isLast
        ? ""
        : '<div style="width: 2px; flex: 1; min-height: 20px; background: var(--border-default); margin-top: 4px;"></div>';
      return `
    <div style="display: flex; gap: 12px; padding-bottom: ${isLast ? 0 : 24}px;">
      <div style="flex-shrink: 0; display: flex; flex-direction: column; align-items: center;">
        <div style="width: 10px; height: 10px; border-radius: 50%; background: ${color};"></div>
        ${line}
      </div>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 14px; color: var(--text-tertiary); margin-bottom: 4px;">${dateTime}</div>
        <div style="font-size: 15px; color: var(--text-primary); line-height: 1.5; margin-bottom: 6px;">${summary}</div>
        <div style="font-size: 13px; color: var(--text-tertiary);">
          ${duration} · ${s.turns} turns
        </div>
      </div>
    </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${agent.name} – Journey</title>
  <style>
    @font-face {
      font-family: 'Geist';
      src: url('https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/Geist-Regular.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Geist';
      src: url('https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/Geist-SemiBold.woff2') format('woff2');
      font-weight: 600;
      font-style: normal;
      font-display: swap;
    }
    :root {
      --bg-app: #FAF9F7;
      --bg-surface: #FFFFFF;
      --bg-sidebar: #F5F3F0;
      --bg-inset: #F0EEEB;
      --bg-hover: #ECEAE6;
      --border-default: #E5E2DD;
      --border-strong: #D4D0CA;
      --text-primary: #1A1816;
      --text-secondary: #6B6560;
      --text-tertiary: #9C958E;
      --status-active: #3D8B5E;
      --status-idle: #9C958E;
      --status-working: #C47A1A;
      --status-error: #B84040;
      --status-paused: #7A7A8A;
      --accent: #1A1816;
      --accent-hover: #2E2A26;
      --accent-subtle: #F0EEEB;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Geist', system-ui, -apple-system, sans-serif;
      background: var(--bg-app);
      color: var(--text-primary);
      font-size: 15px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      padding: 40px 24px;
    }
  </style>
</head>
<body>
  <div style="max-width: 720px; margin: 0 auto;">
    <div style="background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 12px; padding: 24px; margin-bottom: 32px;">
      <h1 style="font-size: 24px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">${agent.name}</h1>
      <p style="font-size: 15px; color: var(--text-secondary); margin-bottom: 16px;">${agent.mission}</p>
      <div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: center;">
        <span style="font-size: 14px; color: var(--text-tertiary);">${agent.total_sessions} sessions</span>
        <span style="font-size: 14px; color: var(--text-tertiary);">${dateRange}</span>
        <span style="font-size: 13px; padding: 4px 10px; border-radius: 9999px; background: var(--bg-inset); color: var(--text-secondary);">${agent.personality}</span>
      </div>
    </div>

    <div style="padding-left: 4px;">
      ${sessionEntries}
    </div>

    <footer style="margin-top: 48px; font-size: 13px; color: var(--text-tertiary); font-style: italic;">
      Built with Agent Founder
    </footer>
  </div>
</body>
</html>`;
}

export default function JourneyExportView({
  agent,
  sessions,
  onClose,
}: JourneyExportViewProps) {
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );
  const dateRange = formatDateRange(sortedSessions);

  const handleDownload = () => {
    const html = generateExportHtml(agent, sessions);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${agent.name.replace(/[^a-zA-Z0-9-_]/g, "-")}-journey.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "var(--bg-app)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          borderBottom: "1px solid var(--border-default)",
          flexShrink: 0,
        }}
      >
        <h2
          style={{
            fontSize: 17,
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          Journey Preview
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={handleDownload}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              background: "var(--accent)",
              color: "white",
              border: "none",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--accent-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--accent)";
            }}
          >
            <Download size={16} strokeWidth={2} />
            Download HTML
          </button>
          <button
            onClick={onClose}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Preview area */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: 24,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            width: "100%",
          }}
        >
          {/* Header card */}
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: 12,
              padding: 24,
              marginBottom: 32,
            }}
          >
            <h1
              style={{
                fontSize: 24,
                fontWeight: 600,
                color: "var(--text-primary)",
                marginBottom: 8,
              }}
            >
              {agent.name}
            </h1>
            <p
              style={{
                fontSize: 15,
                color: "var(--text-secondary)",
                marginBottom: 16,
              }}
            >
              {agent.mission}
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 14, color: "var(--text-tertiary)" }}>
                {agent.total_sessions} sessions
              </span>
              <span style={{ fontSize: 14, color: "var(--text-tertiary)" }}>
                {dateRange}
              </span>
              <span
                style={{
                  fontSize: 13,
                  padding: "4px 10px",
                  borderRadius: 9999,
                  background: "var(--bg-inset)",
                  color: "var(--text-secondary)",
                }}
              >
                {agent.personality}
              </span>
            </div>
          </div>

          {/* Timeline */}
          <div style={{ paddingLeft: 4 }}>
            {sortedSessions.map((session, i) => {
              const color = OUTCOME_COLORS[session.outcome];
              const isLast = i === sortedSessions.length - 1;
              return (
                <div
                  key={session.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    paddingBottom: isLast ? 0 : 24,
                  }}
                >
                  <div
                    style={{
                      flexShrink: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: color,
                      }}
                    />
                    {!isLast && (
                      <div
                        style={{
                          width: 2,
                          flex: 1,
                          minHeight: 20,
                          background: "var(--border-default)",
                          marginTop: 4,
                        }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        color: "var(--text-tertiary)",
                        marginBottom: 4,
                      }}
                    >
                      {formatSessionDate(session.started_at)}
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        color: "var(--text-primary)",
                        lineHeight: 1.5,
                        marginBottom: 6,
                      }}
                    >
                      {session.summary || "No summary"}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text-tertiary)",
                      }}
                    >
                      {formatSessionDuration(session.started_at, session.ended_at)} · {session.turns} turns
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <footer
            style={{
              marginTop: 48,
              fontSize: 13,
              color: "var(--text-tertiary)",
              fontStyle: "italic",
            }}
          >
            Built with Agent Founder
          </footer>
        </div>
      </div>
    </div>
  );
}
