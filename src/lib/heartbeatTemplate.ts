export const defaultHeartbeatMd = `# Heartbeat Protocol
1. Read STATE.md — what's the current focus?
2. If there are unblocked tasks, pick the highest priority one and begin working
3. If all tasks are blocked, check if any blockers have been resolved
4. If nothing to do, reply HEARTBEAT_OK
`;

export const defaultStateMd = `# Current Focus
Starting fresh — review MISSION.md and plan initial tasks.

# Active Tasks
- [ ] Review mission and break down into concrete tasks
- [ ] Set up project structure

# Blocked
Nothing currently blocked.

# Recently Completed
Nothing yet — just getting started.
`;

export const defaultMissionMd = (mission: string) => `# Mission
${mission}

# Objectives
Your co-founder will break this down into concrete objectives during the first work session.

# Success Criteria
- Working, deployable product
- Clean, maintainable codebase
- All core features functional
`;

export const defaultJournalMd = `# Journal
Each work session appends an entry below.

---
`;
