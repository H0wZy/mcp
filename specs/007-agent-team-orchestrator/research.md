# Pre-Plan Research: Multi-Vendor Agent Team Orchestrator

**Status**: Input for `/speckit-plan` Phase 0. Options, trade-offs and a phased path. Items marked **VERIFY** need confirmation against installed CLI versions.

**Date**: 2026-10-06

**Reference**: Claude Code Agent Teams docs, <https://code.claude.com/docs/en/agent-teams>

---

## 1. What Agent Teams does, and how this maps to the hub

| Agent Teams concept | How it works in Claude Code | Equivalent here |
|---|---|---|
| Team lead | The interactive session that spawned the team | Any host (Claude Code / Codex / Antigravity) calling the orchestrator's `team_*` tools |
| Teammate | A full Claude Code instance with its own context | A conversation with `claude`, `codex` or `agy`, continued across turns (`--resume <id>`, `codex exec resume <id>`, `agy --conversation <id>`, confirmed in `agy --help`) |
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

Each agent can be forced to emit this: Claude Code `--json-schema`, Antigravity `--json-schema` (confirmed in `agy --help`; with `--output-format json` the result lands in `structured_output`), Codex `--output-schema <FILE>` (confirmed in `codex exec --help`; `-o <FILE>` also writes the last message to a file). Without that, a fenced-JSON fallback parser does the job.

Other confirmed CLI features that fit teammates (2026-10-07):
- **Isolation (US7)**: Codex `--worktree` runs a session in a new managed git worktree.
- **Long-lived teammates**: `agy --input-format stream-json --output-format stream-json` keeps one process and runs a turn per NDJSON line on stdin. Each turn ends with its own `result` event, which is faster than re-spawning with `--conversation`.
- **Scoped teammates**: Antigravity custom agents (`--agent <name>`, `tools:` in the frontmatter) can limit a teammate's tools.
- **Cost (section 4)**: `agy --output-format json` reports `usage` tokens per run, and Codex `--json` emits token counts.

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

---

## 7. Invocation across harnesses (FR-013a/b)

All three harnesses reserve `@` for file references (in Codex, `@` only selects skills in the ChatGPT app, not in the CLI), so the team workflow is a **skill**: one `SKILL.md` in the open [Agent Skills](https://agentskills.io) format. It is installed where each harness discovers skills and invoked with that harness's own trigger. All three also load a skill on their own when the request matches its `description`.

Checked against each vendor's official docs on 2026-10-06:

| Harness | Explicit trigger | Implicit (from `description`) | Project skills | User skills |
|---|---|---|---|---|
| Claude Code ([docs](https://code.claude.com/docs/en/skills)) | `/<name>` | yes (opt out: `disable-model-invocation: true`) | `.claude/skills/<name>/` (cwd up to repo root) | `~/.claude/skills/<name>/` |
| Codex CLI / IDE ([docs](https://learn.chatgpt.com/docs/build-skills)) | `$<name>` (or pick from `/skills`) | yes (opt out: `agents/openai.yaml` → `policy.allow_implicit_invocation: false`) | `.agents/skills/<name>/` (cwd up to repo root) | `$HOME/.agents/skills/<name>/` (admin: `/etc/codex/skills`) |
| Antigravity CLI `agy` ([docs](https://antigravity.google/docs/skills/)) | `/<name>` (or mention the skill by name; `/skills` lists them) | yes | `.agents/skills/<name>/` | `~/.gemini/antigravity-cli/skills/<name>/` |
| Antigravity 2.0 / IDE ([docs](https://antigravity.google/docs/skills/)) | `/<name>` | yes | `.agents/skills/<name>/` | `~/.gemini/config/skills/<name>/` |

Consequences:

- **A project skill in `.agents/skills/` already reaches Codex and Antigravity.** Claude Code only reads `.claude/skills/`, so the installer must also place a copy there. This also explains why this repo's `speckit-*` skills (in `.agents/skills/`) show up in Antigravity and Codex but not in Claude Code.
- **Required frontmatter**: Codex requires `name` and `description`. Claude Code and Antigravity require only `description`. Ship both, and keep vendor-specific fields out of the shared file (Claude Code silently ignores unknown fields; claude.ai uploads reject them).
- **Install by copying, not symlinking**: Windows symlinks need elevated rights or developer mode. `hmcp doctor` reports drift between the copies.
- **Skill body**: short and procedural. Cover when to form a team versus a single `ask_*` call, how to pick tiers per role to save the lead's tokens, the limits, and the `team_*` call sequence (create → spawn → wait loop → collect → shutdown).

---

## 8. Decisions for the plan (2026-10-07)

### D1. One engine in `shared/team/`, one thin server

`servers/team` only declares tools. The engine is the store, the task graph, the report parser, the adapters and the scheduler. Keeping it in `shared/team/` means a later Option C (peer tools) and any host can reuse it.

### D2. Teammate turns through adapters

Each adapter builds the argv for one turn and reads the output. It reuses the read-only and edit flags that Phase 0 and spec 006 settled on:

| Agent | Read-only turn | Editing turn | Context across turns | Output read from |
|---|---|---|---|---|
| Claude Code | `--tools Read,Grep,Glob` | `--permission-mode acceptEdits` | First turn `--session-id <uuid>`, then `--resume <uuid>` | `--output-format json` → `result`, `total_cost_usd`, `num_turns` |
| Codex | `-c sandbox_mode=read-only -c approval_policy=never --ephemeral` | `-c sandbox_mode=workspace-write --approve-for-me` | A compact history of earlier turns in the prompt | `-o <file>` (last message), plus stdout as a fallback |
| Antigravity | No auto-approval, read-only notice | `--dangerously-skip-permissions` | `--conversation <id>` from `--output-format json` → `conversation_id` | `--output-format json` → `response`, `usage` |

Every turn runs through `executeProcess` with the hop's `childEnv`, `onSpawn` registration and capped timeout. Every turn passes `--permission-prompts none` to Claude Code. Antigravity's JSON envelope fields come from the official headless docs, and were confirmed on a real run (D9).

Like the bridges, a teammate's Claude Code and Codex load only the mesh bridges, not the user's other MCP servers (spec 006 FR-026): Claude Code gets `--strict-mcp-config` plus a temporary `--mcp-config`, Codex gets `-c mcp_servers.<name>.enabled=false` for every other server. Antigravity turns pass a private `--log-file` (D9).

### D3. Turn timeout

Each turn gets min(`H0WZY_TEAM_TURN_MINUTES`, default 20, cap 60; time left before the team deadline; time left in the hop's chain). An Antigravity turn's process limit is that plus 60 s, because agy needs about 25 s around `--print-timeout` to start and to return its partial output (spec 006 research §7).

### D4. Wake rules

The scheduler starts a turn for a member that is idle, not stopping, within its turn budget, within the team budget and before the deadline, when:
- **(a)** its assigned task is available (dependencies completed); or
- **(b)** it has unread messages; or
- **(c)** self-claim is on and an unassigned task is available. It takes the oldest available task.

A `continue` report keeps the same task and schedules another turn. Every limit hit emits a `limit` event, once per member and limit.

### D5. Events and waiting

Events are appended to `events.jsonl` and pushed to the in-memory queue. `team_wait` returns every event since the lead's last read. When there are none, it waits until the next event or the timeout. One wait call can return several events, which keeps the lead's call count low (SC-003).

### D6. Compact results

The teammate's answer, minus the report block, is saved in full to `results/<member>-<turn>.md`. Events carry the report `summary`, plus the first characters of the answer up to the result cap, plus a `ref` that `team_result` reads in pages.

### D7. Isolation

With `can_edit: true` and a git repository:
- `isolation: "worktree"` (the default): `git worktree add --detach <stateDir>/worktrees/<member> HEAD` once per member. Turns run there.
- `team_changes` returns `git status --porcelain` plus `git diff --stat`, and saves the full `git diff` to a result file.

`owns: [paths]`: after each turn the changed files (from `git status`) are compared with the declared paths, and anything outside them is flagged in the event.

`team_shutdown` keeps worktrees, so their changes are never lost. `team_changes` with `remove: true` removes one after the lead has taken what it needs.

### D8. Completion checks

`task_create` can take `check: ["npm", "test"]` (an argv array, never a shell string). It runs in the member's work folder with a 10-minute limit when the teammate reports `done`.
- **Pass**: the task completes.
- **Fail**: the task stays in progress, the output tail (≤ 4,000 chars) goes to the teammate's mailbox, and it wakes for another turn within its budget. With no turns left, the task fails with the last output.

### D9. Turn outputs checked on the real CLIs (2026-10-07)

Claude Code 2.1.293, Codex 0.161.0 and agy 1.3.1 on the maintainer's Windows machine (details in spec 006 research §7):

- **Claude Code**: the JSON result has `result`, `session_id`, `total_cost_usd`, `num_turns`; an error result has no `result` and carries `errors` (e.g. `Reached maximum budget ($0.05)`), which the adapter now reports.
- **Codex**: `exec --json` prints `thread.started` with a `thread_id`, and `-o` holds the last message. `codex exec resume [SESSION_ID] [PROMPT]` exists but has no `-C`, `--color`, `-s` or `--approve-for-me`, and read-only teammates run `--ephemeral` (nothing to resume). Teammates keep the history in the prompt until a resume path for editing turns is tested.
- **Antigravity**: `--output-format json` gives `{ conversation_id, status, response, num_turns, usage }`. After its own `--print-timeout`, agy exits 0 with status "SUCCESS" and whatever response it had, often none, and prints `[agy] print timeout after … with turn in progress` on stderr. The adapter treats that as a failed turn. When the turn never started because an MCP server could not connect, the error names the server, from the turn's `--log-file` (spec 006 FR-026).
