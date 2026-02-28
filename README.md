# Agent Founder

Desktop app for creating and managing autonomous AI coding agents powered by Claude Code.

Point an agent at a project, give it a mission, and let it build — with configurable autonomy, check-in schedules, and working styles.

## Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite
- **Backend**: Rust, Tauri 2, SQLite

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable)
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

## Project Structure

```
src/                    # React frontend
  components/           # Reusable UI components (Sidebar)
  views/                # Full-page views (Home, CreateAgent, ImportAgent, AgentDetail)
  hooks/                # React hooks (useAgents, useNotifications)
  lib/                  # API layer, shared constants, templates
  types/                # TypeScript interfaces

src-tauri/src/          # Rust backend
  commands.rs           # Tauri command handlers
  models.rs             # Data models
  db.rs                 # SQLite operations
  state_manager.rs      # Workspace initialization
  process_pool.rs       # Agent process management
  heartbeat.rs          # Agent check-in system
```

## How It Works

1. **Create or import** a project — describe your idea or point to an existing codebase
2. **Configure** working style (fast/careful/creative), check-in frequency, and autonomy level
3. **Launch** — the agent runs Claude Code sessions against your project
4. **Monitor** — track status, view work sessions, pause/resume anytime

Each agent gets a `.founder/` directory in its workspace with `SOUL.md`, `MISSION.md`, and session logs.
