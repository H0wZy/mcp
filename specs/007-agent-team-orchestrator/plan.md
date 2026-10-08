# Implementation Plan: Multi-Vendor Agent Team Orchestrator

**Branch**: `claude/trusting-cray-vso3rf` (feature `007-agent-team-orchestrator`) | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-agent-team-orchestrator/spec.md` (clarified 2026-10-07)

---

## Summary

A new MCP server, `servers/team` (npm `@h0wzy/mcp-server-team`), is Option B from research.md: a hub-coordinated orchestrator that any host (Claude Code, Codex, Antigravity) can lead. It owns the team state and the teammate processes.

- **Teammates** are background CLI runs of `claude`, `codex` or `agy`, one turn at a time, run through per-vendor adapters in `shared/team/adapters.js`. Each turn is a spec-006 hop rooted at the `team`, so the loop guard limits what teammates delegate. A teammate's own team server refuses to create teams (FR-017).
- **Reports**: teammates have no team tools. Every turn ends with a fenced `team-report` JSON block, from which the orchestrator applies task status, messages and claims (FR-011, FR-014).
- **Scheduler**: one in-process scheduler per team serializes every state change, so a task claim is atomic by construction (FR-009). It starts turns when a teammate has an available assigned task, unread messages, or self-claims the next available task, all within the team's limits.
- **Lead tools**:
  - `team_create`, `team_spawn`, `team_status`, `team_wait` (long-poll for events), `team_message`, `team_result` (full output on demand), `team_changes` (isolated change sets), `team_shutdown`;
  - `task_create`, `task_update`, `task_list`.
- **Compact replies**: results, events and status are capped (8,000 chars per result by default). The full output stays on disk (FR-012a).
- **Isolation (P3)**: editing teammates in a git repo get a worktree under the state dir (FR-020). **Checks (P3)**: a task may carry a command (argv, no shell) that must pass before "done" counts (FR-021).
- **`agent-team` skill**: one `SKILL.md` that `hmcp install team` places in each harness's user skill folder, and registers the team server in each detected host (FR-013a/b).

---

## Technical Context

**Language/Version**: Node.js ≥ 20 (ES modules). Go for `hmcp`.

**Primary Dependencies**: Node built-ins only. The server reuses `shared/` (executor, chain guard, agent config, validate, errors).

**Storage**: `~/.h0wzy-mcp/teams/<project-key>/<team>/`:
- `team.json`: config, limits, members, usage;
- `tasks.json`;
- `events.jsonl`;
- `results/<member>-<turn>.md`: full outputs;
- `worktrees/<member>/`.

Writes are atomic: a temp file, then rename. One owning server process per team at a time, recorded in `owner.json` (pid). Another process may read the team but not change it.

**Testing**: `node:test` with fake `claude` / `codex` / `agy` binaries. A `FAKE_AGENT_MODE=teammate` mode answers with scripted `team-report` blocks, reading its script from env or a file. Scheduler unit tests use an injected runner, so no processes start.

**Target Platform**: Linux, macOS, Windows. Worktrees need `git` on `PATH`; without it, editing teammates fall back to `isolation: "none"` with a warning.

**Project Type**: MCP stdio server + CLI installer + Agent Skill.

**Performance Goals**:
- `team_spawn` returns in < 3 s; the turn starts asynchronously.
- `team_wait` resolves within 1 s of an event, using in-process notification with no polling.

**Constraints**:
- Default limits: 3 teammates (cap 6), 10 turns per teammate (cap 50), 30 total turns (cap 150), 60 min deadline (cap 240), 8,000-char result cap.
- Developer env sets the ceilings. A lead can only lower them.
- `team_wait` defaults to 300 s, max 1,800 s, which stays under the Codex `tool_timeout_sec = 3900` that `hmcp install` writes.

**Scale/Scope**: ≤ 6 concurrent teammates per team; any number of teams per project. Teams are independent.

---

## Constitution Check

The gates are the AGENTS.md rules, because the constitution file is still the template.

| Rule | Compliance |
|---|---|
| No third-party runtime deps | `node:*` only |
| Shared logic in `shared/` | The team engine (store, scheduler, adapters, report parser) lives in `shared/team/`. `servers/team` is only the tool layer. |
| Tool parity | The team server is a new kind of server, not a vendor bridge. Its tools use the same parameter names where they overlap (`model`, `effort`, `cwd`, `paths`). |
| Spawn via `executeProcess`, prompts on stdin | Codex and Claude prompts go on stdin. Antigravity takes `-p <prompt>` (its CLI has no text stdin); the prompt length is capped. |
| Least privilege | Teammates are read-only unless `can_edit`. Read-only adapters use each vendor's read-only flags from Phase 0 and 006. |
| Loop safety | Each turn is a `beginHop` (spec 006). Nested team creation is refused, and teammates have no team tools. |
| Tests without real agents | Fake binaries plus an injected runner |

Result: **pass**.

---

## Project Structure

```text
specs/007-agent-team-orchestrator/
├── spec.md · research.md · plan.md · data-model.md · quickstart.md · tasks.md
└── contracts/
    ├── team-tools.md          # MCP tools of the team server
    ├── teammate-protocol.md   # turn prompt + team-report block
    └── installer-team.md      # hmcp install team, skill locations, doctor

shared/team/
├── store.js        # TeamStore: paths, atomic JSON, owner lock, load/save
├── tasks.js        # task graph: create (cycle check), availability, claim, transitions
├── report.js       # parse the team-report block; compact summaries
├── adapters.js     # claude / codex / antigravity turn argv + output parsing
├── scheduler.js    # Team: members, mailboxes, limits, turn loop, events, wait
└── index.js
servers/team/       # package.json, bin/cli.js, src/index.js (tools), README.md
cli/skills/agent-team/SKILL.md   # embedded in hmcp, copied to every harness
test/team.*.test.js · shared/test/team-*.test.js
```

---

## Phase 0 / Phase 1 outputs

- [research.md](./research.md) §8: decisions D1–D8 for this plan.
- [data-model.md](./data-model.md): Team, Member, Task, Message, Event, Turn.
- [contracts/team-tools.md](./contracts/team-tools.md)
- [contracts/teammate-protocol.md](./contracts/teammate-protocol.md)
- [contracts/installer-team.md](./contracts/installer-team.md)
- [quickstart.md](./quickstart.md)

Post-design check: **pass**.

## Complexity Tracking

| Choice | Why | Simpler alternative rejected |
|---|---|---|
| End-of-turn report blocks instead of teammate tools (Option C) | Works on every host today, and teammates can't reach team tools | Peer MCP tools need identity forwarding on all hosts (006 shows Codex strips env), which is deferred to a later version |
| One owning process per team | An in-process scheduler makes claims atomic without cross-process locks | A multi-writer store needs file locking on every mutation for a case (two leads, one team) the spec doesn't need |
