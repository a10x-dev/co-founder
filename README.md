# Agent Founder

Desktop app that turns Claude Code into a fully autonomous AI co-founder.

Not an assistant. Not an employee. A co-founder — one that owns outcomes, makes strategic decisions, sets its own priorities, controls its own work tempo, and grinds 24/7 toward the mission you define together.

Point it at a project, give it a mission, and let it build.

## Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite
- **Backend**: Rust, Tauri 2, SQLite
- **Crypto**: AES-256-GCM for secrets at rest
- **Icons**: Lucide React
- **Font**: Geist (CDN)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) installed and authenticated
- Tauri CLI: `cargo install tauri-cli`

### Development

```bash
npm install
npm run tauri dev
```

### Production Build

```bash
npm run tauri build
```

The bundled app will be in `src-tauri/target/release/bundle/`.

## How It Works

### The Co-Founder Loop

1. You create a co-founder agent with a mission ("grow this project to $10K MRR")
2. The agent checks in on its own schedule (every 10m when grinding, every 4h when stable)
3. Each session: it reads its state, reviews its mission, decides what to do, and executes
4. Every ~24 hours: a strategic review — assess progress, adjust strategy, reprioritize
5. The agent controls its own tempo via `NEXT_CHECKIN` directives in its output
6. You communicate through INBOX.md — leave messages, the agent processes them next session

### Two Distinct Cycles

- **Work cycle** (5m–4h): Execute on the highest-priority task. Fast heartbeat. Grinding.
- **Review cycle** (~24h): Step back. What worked? What didn't? What's the strategy now? Triggered automatically when 20+ hours have passed since last session.

### Agent-Controlled Scheduling

The agent decides its own tempo. After each session, it outputs `NEXT_CHECKIN: Xm` or `NEXT_CHECKIN: Xh` to tell the system when to wake it up next. A co-founder launching a product might request 5-minute check-ins. One waiting for user feedback might request 8 hours. The system respects the agent's judgment, clamped between 1 minute and 24 hours.

## Project Structure

```
src/                    # React frontend
  components/           # Reusable UI components (Sidebar)
  views/                # Full-page views
    HomeView.tsx        # Command center — health indicators, batch ops
    AgentDetailView.tsx # Co-founder dashboard — live output, tabs, progress
    CreateAgentView.tsx # New co-founder wizard
    ImportAgentView.tsx # Import existing project
    SettingsView.tsx    # Global settings
    JourneyExportView   # Export session history
  hooks/                # React hooks (useAgents, useNotifications)
  lib/                  # API layer, shared constants, templates
  types/                # TypeScript interfaces

src-tauri/src/          # Rust backend
  commands.rs           # Tauri command handlers
  models.rs             # Data models (Agent, Session, EnvVar, etc.)
  db.rs                 # SQLite with encrypted env vars
  crypto.rs             # AES-256-GCM encryption for secrets
  cli_adapter.rs        # Claude CLI wrapper with retry + secret redaction
  state_manager.rs      # Workspace init + health checks + repair + soul templates
  work_session.rs       # Session engine — co-founder prompts, review loop, NEXT_CHECKIN parsing
  process_pool.rs       # Concurrent agent process management
  heartbeat.rs          # Dynamic scheduling — agent-controlled intervals
  event_translator.rs   # Claude CLI event parsing
  lib.rs                # App setup, event handling, error recovery, tempo changes
```

## Features

### Core
- Create co-founder agents from scratch or import existing projects
- Configure working style (fast/careful/creative), initial check-in frequency, autonomy level
- Live streaming output from Claude CLI sessions
- Session progress indicator (turn counter + elapsed timer)
- Agent-controlled scheduling via NEXT_CHECKIN directives

### Autonomy
- Two modes: "Full Auto" (yolo — `--dangerously-skip-permissions`) and "Ask Permission" (semi)
- Co-founder framing in all prompts — agents own outcomes, not follow instructions
- Strategic review loop triggered automatically every ~24 hours
- 30-minute default sessions, 40 turns max — serious work time

### Reliability
- Auto-recovery with exponential backoff (up to 5 retries)
- Rate limit detection and classification
- Workspace health checks with auto-repair

### Security
- AES-256-GCM encrypted environment variables at rest
- Secret values redacted from session logs and live output
- Path traversal protection on file read/write commands

### Communication
- Message co-founders via INBOX.md (processed on next heartbeat)
- SOUL.md / MISSION.md / MEMORY.md inline editors
- Persistent memory across sessions — decisions, learnings, failures, wins

### Extensibility
- Artifacts system — agents create dashboards, metrics, checklists in .founder/artifacts/
- Agent Toolbox — self-built scripts registered in .founder/tools/
- MCP connector support planned

## Workspace Layout

Each co-founder gets a `.founder/` directory — their brain:

```
.founder/
  SOUL.md         # Co-founder DNA — personality, principles, operating rhythm
  MISSION.md      # The goal, success criteria, authority definition
  STATE.md        # Current status, key metrics, strategic notes
  MEMORY.md       # Long-term knowledge — decisions, what worked, what failed
  INBOX.md        # Messages from human partner
  TASKS.md        # Self-managed task board
  HEARTBEAT.md    # Check-in protocol and scheduling guide
  JOURNAL.md      # Session history
  artifacts/      # Agent-generated dashboards and metrics
  tools/          # Agent-built reusable scripts
```
