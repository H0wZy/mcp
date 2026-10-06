# Pre-Plan Research: Multi-Vendor Agent Team Orchestrator

**Status**: Input for `/speckit-plan` Phase 0. Options, trade-offs and a phased path. Items marked **VERIFY** need confirmation against installed CLI versions.

**Date**: 2026-10-06

**Reference**: Claude Code Agent Teams docs, <https://code.claude.com/docs/en/agent-teams>

---

## 1. What Agent Teams does, and how this maps to the hub

| Agent Teams concept | How it works in Claude Code | Equivalent here |
|---|---|---|
| Team lead | The interactive session that spawned the team | Any host (Claude Code / Codex / Antigravity) calling the orchestrator's `team_*` tools |
| Teammate | A full Claude Code instance with its own context | A conversation with `claude`, `codex` or `agy`, continued across turns (`--resume <id>`, `codex exec resume <id>`, `agy --conversation <id>`; **VERIFY** agy) |
| Shared task list | `~/.claude/tasks/{team}/`, file locking for claims | `<state>/teams/<team>/tasks.json` + exclusive lock file, atomic rename |
| Mailbox | `~/.claude/teams/{team}/inboxes/{agent}.json` | `<state>/teams/<team>/inboxes/<member>.jsonl` |
| Idle notification with final answer | Pushed to the lead automatically | Event queue consumed by `team_wait` (long-poll) |
| Hooks `TeammateIdle` / `TaskCompleted` | Exit 2 keeps working / blocks completion | Completion checks (FR-021) |
| Limits | No nested teams, one team per session, lead fixed | Same rules, but any vendor can lead and teams are per project |

---

## 2. Three ways to build it

### Option A: "Proxy teammates" on native Agent Teams (zero code, Claude-only lead)

Enable `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and ship subagent definitions such as `.claude/agents/codex-teammate.md` whose `tools` list is limited to `mcp__codex__*` plus the team tools Claude Code adds. Each native teammate is a thin Claude instance that relays its task to Codex or Antigravity through the existing bridges, and uses Claude Code's own task list and `SendMessage`.

- ✅ Works this week, and the shared task list, mailboxes and UI come for free.
- ❌ Only Claude Code can lead. Each proxy burns Claude tokens on top of the vendor's (use a cheap model and low effort for the proxy). Codex and Antigravity never see the task list directly. It is experimental (no resume, status can lag). The bridge's own 60-minute and blocking-call limits still apply.
- **Verdict**: ship it as a **recipe** (docs + optional `hmcp install --team-recipes`) so users get value now. Not the product.

### Option B: Hub-coordinated orchestrator (recommended v1)

A new MCP server (`servers/team`, name TBD) that any host can use. It owns state and processes. Teammates are plain CLI runs started by the orchestrator. They don't need any team tools: each turn ends with a **structured report** that the orchestrator parses:

```json
{ "status": "done|failed|blocked|working",
  "task_id": "T3", "summary": "...",
  "messages": [{ "to": "reviewer", "text": "..." }],
  "claim_next": true }
```

Each agent can be forced to emit this: Claude Code `--json-schema`, Antigravity `--json-schema` (**VERIFY**), Codex `--output-schema` (**VERIFY**). Without that, a fenced-JSON fallback parser does the job.

- ✅ Vendor-neutral lead. The orchestrator owns all task-status changes, which fixes Agent Teams' "status lags" limitation (FR-011). Teammates have no team tools, so they can't spawn teams by construction (FR-017). Deterministic and testable with fake CLIs.
- ❌ Messages land at the next turn, not mid-turn. Coordination is only as smart as the lead.

### Option C: Peer-to-peer tools (v2, on top of B)

The same state, also exposed to teammates as MCP tools (`task_claim`, `task_update`, `message_send`, `inbox_read`) through a teammate-scoped server instance. That instance knows its team and member identity from the spec-006 chain context, and never offers `team_spawn`. This mirrors the diagram exactly, with teammates claiming and talking mid-turn.

- ✅ Closest to Agent Teams' behavior, and faster convergence on debate-style work.
- ❌ Depends on every host forwarding identity and context to MCP servers (see spec 006 research: Codex needs `env_vars`). Teammates can now spend turns talking instead of working, so stricter budgets are needed.

**Recommendation**: A now (recipe), B as this spec's MVP (US1–US3 + US5), C as a follow-up once spec 006's context forwarding is proven on all three hosts.

---

## 3. Option B architecture sketch

```
host (lead) ──stdio──► team server
                         ├─ TeamStore     (JSON files + lock, atomic rename; per-project dir)
                         ├─ Scheduler     (assign / self-claim, dependency resolution, limits)
                         ├─ Runner pool   (≤ max_teammates concurrent CLI runs)
                         │    └─ Adapters: claude | codex | agy
                         │         buildArgs(turn) · resumeArgs(sessionId) · readOnly / isolation flags
                         │         parseReport(stdout) · parseUsage(stdout)
                         ├─ EventQueue    (team_wait long-poll; resolves on first event)
                         └─ ChainGuard    (spec 006: each turn is a hop rooted at the team)
```

- **Adapters**: extract today's `executeCodexCommand` / `executeAgyPrompt` into `shared/adapters/*` so the bridges and the orchestrator share one implementation per vendor. This is also the review's de-duplication recommendation.
- **Per-teammate config**: `createAgentConfig` is a per-process singleton today, so two subagents sharing one bridge process overwrite each other's `set`. The orchestrator must keep a config snapshot per teammate and call `resolveCall` with explicit overrides.
- **Process control**: teammates are long-running, so the executor needs process-group / tree kill, `exit`-based resolution, an output cap and cancellation before this is safe (see the code review's executor findings).
- **Waiting**: `team_wait` is a tool call that stays open until an event arrives. MCP clients enforce tool timeouts (Codex `tool_timeout_sec` default 60 s; **VERIFY** Claude Code's `MCP_TOOL_TIMEOUT`), so the default wait must stay below the host's limit, or the installer must raise it. Later, MCP's async *tasks* utility can replace long-polling once hosts support it.
- **State location**: `<project>/.hmcp/teams/<team>/` (git-ignored), or under the user's home keyed by project path. Per-project matches "teams are scoped to one project".
- **Isolation (US6)**: `git worktree add` per editing teammate under `.hmcp/worktrees/<member>`. The lead gets `git diff` per worktree.

---

## 4. Token-cost model and guardrails

Cost ≈ Σ over teammates of (turns × (system + carried context + new input + output)). The levers, in order of impact:

1. **Fewer teammates**: default 3, cap 6 (Agent Teams' guidance is 3–5).
2. **Fewer turns**: per-teammate and team-wide caps, and no wake-ups from chatter without budget.
3. **Cheaper tiers per role**: spec 005 tiers per teammate. Reviewers on deep, scouts on light.
4. **Resume instead of re-sending context**: provider prompt caching makes resumed turns cheaper than rebuilding context.
5. **Hard stops**: deadline, per-call spending caps where supported (Claude Code `--max-budget-usd`).
6. **Lead discipline**: `team_wait` instead of status polling (SC-003).

---

## 5. Phases and effort (one developer + AI pair, part-time)

| Phase | Scope | Size |
|---|---|---|
| 0 | Fix review blockers that touch this path: executor tree-kill, cancellation, output cap; npm packaging of `shared` | **S–M**, ~3–4 days |
| 1 | Spec 006 MVP (loop guard + Claude bridge) | **M**, ~1–1.5 weeks |
| 2 | Option A recipe (docs + agent definitions) | **S**, ~1 day |
| 3 | Option B MVP: store, scheduler, adapters, spawn / status / wait / shutdown, limits (US1–3, US5) | **L**, ~2–3 weeks |
| 4 | Messaging + resumed conversations (US4) | **M**, ~1 week |
| 5 | Worktree isolation + completion checks (US6–7) | **M**, ~1 week |
| 6 | Option C peer tools | **M–L**, ~1–2 weeks |

**Total to an Agent-Teams-equivalent (phases 0–5)**: roughly **6–8 weeks part-time**. A usable cross-vendor team (phases 0–3) takes about 4–5 weeks.

---

## 6. Main risks

| Risk | Mitigation |
|---|---|
| Host tool timeouts cut `team_wait` / long turns | Wait < host limit; installer raises Codex `tool_timeout_sec`; async design (spawn returns immediately) |
| Agent CLIs change flags or output formats | Adapter per vendor + contract tests with fake binaries (the code review's argv-test approach) |
| Context forwarding not available on a host | Option B doesn't need it. Option C waits for spec 006 forwarding plus the ancestry fallback |
| Cost blow-up | Conservative defaults, hard caps, budgets surfaced in every `team_status` |
| Teammates edit the same files | Worktree isolation or declared ownership; reviews and research first, as Agent Teams also advises |
