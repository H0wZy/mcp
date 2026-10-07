# Contract: Team Server Tools (`@h0wzy/mcp-server-team`)

Server name `team`, version 1.0.6. Launch: `node servers/team/bin/cli.js --host <agent>` or `npx -y @h0wzy/mcp-server-team --host <agent>`.

## Common rules

- `team` (string) is optional on every tool except `team_create`. Without it, the call uses the team this server created last. Names match `^[a-z][a-z0-9-]{0,31}$`.
- Member names match the same pattern. `lead` is reserved for the lead.
- Every reply is text, kept under the result cap (default 8,000 chars) except `team_result`, which pages.
- Errors are `isError: true` with a one-line reason and the fix (for example the valid member names).
- **Nested call guard**: if this server runs inside a chain (inherited `H0WZY_MCP_*` context, or a registry-plus-ancestry match), `team_create` and `team_spawn` are refused with `⛔ Teammates can't create teams or spawn teammates (FR-017).` The other tools only read, so they work.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `team_create` | `name`, `cwd?` (absolute; default: server cwd), `limits?` {`max_teammates`, `max_turns_per_teammate`, `max_total_turns`, `deadline_minutes`, `result_cap_chars`}, `self_claim?` (default true) | Team summary with the effective limits. A lead value above the developer ceiling is lowered, with a note. |
| `team_spawn` | `name`, `agent` (`claude`\|`codex`\|`antigravity`), `role`, `tier?`, `model?`, `effort?`, `can_edit?` (false), `isolation?` (`worktree`\|`none`; default `worktree` when `can_edit` in a git repo), `owns?` (string[]), `task?` (text: creates a task assigned to this member), `task_id?` (assign an existing task), `max_turns?` | Within 3 s: `Spawned <name> (<agent>, <model>/<effort>, read-only\|edits in <path>) — working on T3` or `— idle, waiting for a task`. Refused when the team is full or the name is taken. |
| `task_create` | `tasks`: [{`id?`, `title`, `description?`, `assignee?`, `depends_on?`: [ids], `check?`: [argv]}] | Created ids. Refused, with nothing created, on unknown dependencies, duplicate ids or a cycle (the cycle is named). |
| `task_update` | `id`, `status?` (`pending`\|`cancelled`\|`completed`\|`failed`), `assignee?`, `description?`, `note?` | The updated task. The lead's override; reassigning a running task takes effect after the current turn. |
| `task_list` | none | One compact line per task: `T3 [in_progress] @reviewer "Review auth" ← T1,T2`. |
| `team_status` | none | Members (state, agent/model/effort, current task, turns used/max, cost and tokens when known, unread messages), team totals vs limits, the task list, and a reminder of which tasks teammates own. |
| `team_wait` | `timeout_seconds?` (default 300, 1–1800) | Every event not yet read by the lead, oldest first. If there are none, it waits for the next event or the timeout. On timeout: `No events in <n>s.` plus a one-line status. |
| `team_message` | `to` (member name), `text` | `Queued for <to>`. Wakes an idle member for one turn, if its budget allows. Unknown names fail with the list of valid names. |
| `team_result` | `ref` (e.g. `reviewer#2`), `offset?` (0), `limit?` (20,000) | A page of the full saved output, with `offset`/`total` so the lead can read the next page. |
| `team_changes` | `member`, `remove?` (false) | The isolated member's change set: `git status --porcelain`, `git diff --stat`, and a `ref` for the full diff. `remove: true` removes the worktree after reporting. |
| `team_shutdown` | `member?` (default: whole team), `grace_seconds?` (60) | Members are marked `stopping`. Running turns get the grace period, then are killed. They end `stopped`. |

## Events (from `team_wait`)

One line each, with its type first:

```
[idle] reviewer finished T2 (done) — "Found 2 issues in auth.js" · ref reviewer#1 · turns 1/10
       <compact answer, ≤ result cap>
[failed] coder: Codex quota exhausted (429) · T3 released to pending
[task] T4 completed by coder · T5, T6 now available
[message] tester → lead: "Need the API keys path"
[limit] coder reached max_turns_per_teammate (10) · T3 left in_progress → unreported
[unreported] architect ended turn 2 without a team-report block · T1 marked unreported
[check] T3 check failed (exit 1) · sent back to coder
[ownership] coder changed files outside its declared set: src/db.js
```

## Limits (developer ceilings, env on the team server)

| Env | Default | Hard cap |
|---|---|---|
| `H0WZY_TEAM_MAX_TEAMMATES` | 3 | 6 |
| `H0WZY_TEAM_MAX_TURNS` (per teammate) | 10 | 50 |
| `H0WZY_TEAM_MAX_TOTAL_TURNS` | 30 | 150 |
| `H0WZY_TEAM_DEADLINE_MINUTES` | 60 | 240 |
| `H0WZY_TEAM_TURN_MINUTES` | 20 | 60 |
| `H0WZY_TEAM_RESULT_CAP` | 8000 | 50000 |

Per-teammate spending caps for Claude Code reuse `CLAUDE_BRIDGE_MAX_BUDGET_USD` / `CLAUDE_BRIDGE_MAX_TURNS`. Model and effort settings for each vendor are validated with that vendor's spec-005 catalog and ceilings (`AGY_*`, `CODEX_*`, `CLAUDE_BRIDGE_*`).
