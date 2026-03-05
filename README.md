<p align="center">
  <h1 align="center">Co-Founder</h1>
  <p align="center">
    <strong>Your AI co-founder that runs 24/7, makes strategic decisions, and ships while you sleep.</strong>
  </p>
  <p align="center">
    <a href="https://agentfounder.ai">Website</a> |
    <a href="https://github.com/a10x-dev/co-founder/releases/latest">Download</a> |
    <a href="https://agentfounder.ai/docs/getting-started">Docs</a> |
    <a href="https://agentfounder.ai/changelog">Changelog</a>
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/platform-macOS-blue" alt="Platform">
    <img src="https://img.shields.io/badge/built_with-Tauri_2-orange" alt="Tauri 2">
    <img src="https://img.shields.io/badge/powered_by-Claude_Code-purple" alt="Claude Code">
    <img src="https://img.shields.io/github/v/release/a10x-dev/co-founder" alt="Release">
    <img src="https://img.shields.io/github/license/a10x-dev/co-founder" alt="License">
  </p>
</p>

---

> Not an assistant. Not an employee. A **co-founder** — one that owns outcomes, makes strategic decisions, sets its own priorities, controls its own work tempo, and grinds 24/7 toward the mission you define together.

## What is Co-Founder?

Co-Founder is a desktop app that turns Claude Code into a fully autonomous AI co-founder. Point it at a project, give it a mission like "grow this to $10K MRR", and let it build.

It doesn't wait for instructions. It decides what to work on, executes, tracks its own progress, learns from failures, and adjusts strategy — all on its own schedule.

**This is not another AI coding assistant.** This is an autonomous agent framework that thinks in outcomes (revenue, users, impact), not tasks.

### Key Differences from Copilots/Assistants

| | Copilot/Assistant | Co-Founder |
|---|---|---|
| **Autonomy** | Waits for prompts | Sets its own agenda |
| **Memory** | Forgets between sessions | Persistent memory across all sessions |
| **Strategy** | Follows instructions | Makes strategic decisions |
| **Scheduling** | Manual | Self-scheduling (5min to 24h intervals) |
| **Scope** | Code completion | Full product: code, marketing, SEO, ops |
| **Reviews** | None | Auto strategic reviews every ~24h |

## How It Works

### The Co-Founder Loop

```
You define a mission
    |
    v
Agent wakes up on its schedule
    |
    v
Reads state -> Reviews mission -> Decides priority -> Executes
    |
    v
Updates memory, metrics, artifacts
    |
    v
Sets NEXT_CHECKIN (5m if grinding, 4h if stable)
    |
    v
Sleeps until next check-in
    |
    v
Every ~24h: Strategic Review (assess progress, adjust strategy)
```

1. **Create** a co-founder agent with a mission ("grow this project to $10K MRR")
2. **The agent checks in** on its own schedule (every 10m when grinding, every 4h when stable)
3. **Each session**: reads its state, reviews its mission, decides what to do, executes
4. **Every ~24 hours**: strategic review — assess progress, adjust strategy, reprioritize
5. **Communication**: leave messages in INBOX.md — the agent processes them next session

### Two Distinct Cycles

- **Work cycle** (5m-4h): Execute on the highest-priority task. Fast heartbeat. Grinding.
- **Review cycle** (~24h): Step back. What worked? What didn't? What's the strategy now?

## Features

### Autonomy Engine
- Agent-controlled scheduling via `NEXT_CHECKIN` directives
- Two autonomy modes: "Full Auto" (yolo) and "Ask Permission"
- Co-founder framing in all prompts — agents own outcomes, not follow instructions
- Strategic review loop triggered automatically every ~24 hours
- 30-minute sessions, 40 turns max — serious work time

### Persistent Brain
- `.founder/` workspace — the agent's memory, state, and tools
- SOUL.md (personality), MISSION.md (goals), MEMORY.md (learnings), STATE.md (current status)
- Artifacts system — agents create their own dashboards, metrics, checklists
- Agent Toolbox — self-built scripts registered and reused across sessions
- INBOX.md — async communication between you and your AI co-founder

### Reliability & Security
- Auto-recovery with exponential backoff (up to 5 retries)
- Rate limit detection and classification
- AES-256-GCM encrypted environment variables at rest
- Secret values redacted from session logs and live output
- Workspace health checks with auto-repair

### Desktop App
- Live streaming output from Claude CLI sessions
- Session progress indicator (turn counter + elapsed timer)
- Batch operations across multiple co-founders
- Journey export — full session history
- Auto-updates via Tauri updater

## Quick Start

### Download (Recommended)

Grab the latest release for macOS:

**[Download Co-Founder](https://github.com/a10x-dev/co-founder/releases/latest)**

- Apple Silicon (M1/M2/M3/M4): `.dmg` (aarch64)
- Intel Mac: `.dmg` (x64)

### Build from Source

#### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) installed and authenticated
- Tauri CLI: `cargo install tauri-cli`

#### Development

```bash
git clone https://github.com/a10x-dev/co-founder.git
cd co-founder
npm install
npm run tauri dev
```

#### Production Build

```bash
npm run tauri build
```

The bundled app will be in `src-tauri/target/release/bundle/`.

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite
- **Backend**: Rust, Tauri 2, SQLite
- **Crypto**: AES-256-GCM for secrets at rest
- **AI**: Claude Code CLI (autonomous mode)
- **Icons**: Lucide React
- **Font**: Geist

## Architecture

```
src/                    # React frontend
  components/           # Reusable UI components
  views/                # Full-page views
    HomeView.tsx        # Command center — health indicators, batch ops
    AgentDetailView.tsx # Co-founder dashboard — live output, tabs, progress
    CreateAgentView.tsx # New co-founder wizard
    ImportAgentView.tsx # Import existing project
    SettingsView.tsx    # Global settings
  hooks/                # React hooks (useAgents, useNotifications)
  lib/                  # API layer, shared constants, templates
  types/                # TypeScript interfaces

src-tauri/src/          # Rust backend
  commands.rs           # Tauri command handlers
  models.rs             # Data models (Agent, Session, EnvVar, etc.)
  db.rs                 # SQLite with encrypted env vars
  crypto.rs             # AES-256-GCM encryption for secrets
  cli_adapter.rs        # Claude CLI wrapper with retry + secret redaction
  state_manager.rs      # Workspace init + health checks + repair
  work_session.rs       # Session engine — co-founder loop
  process_pool.rs       # Concurrent agent process management
  heartbeat.rs          # Dynamic scheduling — agent-controlled intervals
  event_translator.rs   # Claude CLI event parsing
  lib.rs                # App setup, event handling, error recovery
```

## The `.founder/` Workspace

Each co-founder gets a `.founder/` directory — their persistent brain:

```
.founder/
  SOUL.md         # Co-founder DNA — personality, principles, operating rhythm
  MISSION.md      # The goal, success criteria, authority definition
  STATE.md        # Current status, key metrics, strategic notes
  MEMORY.md       # Long-term knowledge — decisions, what worked, what failed
  INBOX.md        # Messages from human partner
  TASKS.md        # Self-managed task board
  SCHEDULE.md     # Self-managed calendar with timed commitments
  HEARTBEAT.md    # Check-in protocol and scheduling guide
  JOURNAL.md      # Session history
  artifacts/      # Agent-generated dashboards, metrics, charts
  tools/          # Agent-built reusable scripts and automations
```

## Use Cases

- **Solo founders**: Get a technical co-founder that codes, deploys, and iterates 24/7
- **Side projects**: Ship while you sleep — the agent grinds on your project overnight
- **Prototyping**: Go from idea to deployed MVP in hours, not weeks
- **Content & SEO**: Agent writes blog posts, builds free tools, optimizes for search
- **DevOps**: Automated deployments, monitoring, incident response

## FAQ

**Q: How is this different from just using Claude Code?**
A: Claude Code is a tool — you prompt it, it responds. Co-Founder is an autonomous agent framework. It has persistent memory, self-scheduling, strategic reviews, and a mission-driven operating loop. It decides what to work on and when.

**Q: Does it need me to be online?**
A: No. Once you set a mission, the agent runs autonomously on its schedule. Check in whenever you want — it'll keep working.

**Q: What can it actually build?**
A: Anything a skilled developer + marketer could. We built [agentfounder.ai](https://agentfounder.ai) — 20+ pages, payment system, blog, free tools, desktop app — almost entirely with a Co-Founder agent.

**Q: Is it safe?**
A: Environment variables are AES-256-GCM encrypted at rest. Secrets are redacted from logs. You can run in "Ask Permission" mode for full control. The agent operates within its project directory.

## Contributing

We welcome contributions! This is an open project building the future of autonomous AI agents.

1. Fork it
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

MIT License — see [LICENSE](LICENSE) for details.

## Links

- **Website**: [agentfounder.ai](https://agentfounder.ai)
- **Download**: [Latest Release](https://github.com/a10x-dev/co-founder/releases/latest)
- **Docs**: [Getting Started](https://agentfounder.ai/docs/getting-started)
- **Twitter**: Follow for updates

---

<p align="center">
  <strong>Built by an AI co-founder, for AI co-founders.</strong><br>
  <em>The first product that was largely built by its own product.</em>
</p>
