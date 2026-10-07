# 👥 @h0wzy/mcp-server-team

[![npm](https://img.shields.io/npm/v/%40h0wzy%2Fmcp-server-team?color=CB3837&logo=npm)](https://www.npmjs.com/package/@h0wzy/mcp-server-team)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/H0wZy/mcp/blob/main/LICENSE)

**Agent team orchestrator.** It lets **Claude Code, OpenAI Codex or Google Antigravity** lead a team of teammates from **any mix of those vendors**. Teammates work in the background and share a task list with dependencies. They message each other and report back through compact events. It works like Claude Code's Agent Teams, but across vendors and from any host.

Part of the **[H0wZy/mcp](https://github.com/H0wZy/mcp)** multi-agent ecosystem.

---

## 🔌 Tools (for the lead)

| Tool | What it does |
| :--- | :--- |
| `team_create` | Create a team (or resume a saved one) with optional lower limits |
| `team_spawn` | Start a teammate in the background: `agent` (`claude` \| `codex` \| `antigravity`), `role`, `tier` / `model` / `effort`, `can_edit`, `isolation`, `owns`, `task` or `task_id` |
| `task_create` / `task_update` / `task_list` | The shared task list: dependencies (`depends_on`), assignees, optional completion `check` (argv, no shell) |
| `team_wait` | Long-poll: returns every new event (finished, failed, task completed, message to the lead, limit hit) as soon as one happens |
| `team_status` | Everything in one call: members, turns, cost, unread messages, task list |
| `team_message` | Message a teammate; an idle teammate wakes for one turn |
| `team_result` | Read a saved full output by `ref` (e.g. `reviewer#2`), page by page |
| `team_changes` | Change set of an editing teammate's git worktree (status, diff stat, full diff) |
| `team_shutdown` | Stop one teammate or the whole team (grace period, then kill) |

## ⚙️ How it works

- **Each teammate turn** is one run of the vendor CLI: `claude -p`, `codex exec` or `agy -p`. It uses the vendor's read-only flags unless the teammate was spawned with `can_edit: true`.
- **Context between turns**: Claude Code teammates resume their session, Antigravity continues its conversation, and Codex gets a compact history of its earlier turns.
- **End-of-turn report**: every turn ends with a `team-report` block (status, summary, messages, `claim_next`). The orchestrator owns the task statuses, so a task is never left "in progress" with no one working on it.
- **Isolation**: editing teammates in a git repository work in their own worktree under `~/.h0wzy-mcp/teams/…/worktrees/` by default. The lead reviews each change set with `team_changes`.
- **Loop guard**: every turn is a spec-006 hop, so a teammate's own bridge calls are limited. Teammates can't create teams.
- **State** lives in `~/.h0wzy-mcp/teams/<project>/<team>/` (`H0WZY_MCP_STATE_DIR` changes the root). It survives the lead's session, and `team_status` reloads it.

## 🛡️ Limits (developer ceilings)

| Variable | Default | Hard cap |
| :--- | :--- | :--- |
| `H0WZY_TEAM_MAX_TEAMMATES` | 3 | 6 |
| `H0WZY_TEAM_MAX_TURNS` (per teammate) | 10 | 50 |
| `H0WZY_TEAM_MAX_TOTAL_TURNS` | 30 | 150 |
| `H0WZY_TEAM_DEADLINE_MINUTES` | 60 | 240 |
| `H0WZY_TEAM_TURN_MINUTES` | 20 | 60 |
| `H0WZY_TEAM_RESULT_CAP` (chars returned to the lead) | 8000 | 50000 |

A lead can lower these per team, never raise them. Per-vendor model and effort ceilings (`CODEX_*`, `AGY_*`, `CLAUDE_BRIDGE_*`) apply to teammates too.

## 🚀 Install

```bash
hmcp install team
```

This registers the server in every detected CLI and copies the **`agent-team` skill** where each one looks for skills. Start a team with `/agent-team` in Claude Code and Antigravity, `$agent-team` in Codex, or just ask for a team in plain language.

Manual setup: run `npx -y @h0wzy/mcp-server-team --host <your-agent>` as a stdio MCP server.

## 📄 License

Created by **Marcos (H0wZy)** under the [MIT License](https://github.com/H0wZy/mcp/blob/main/LICENSE).
