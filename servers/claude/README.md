# 🟠 @h0wzy/mcp-server-claude

[![npm](https://img.shields.io/npm/v/%40h0wzy%2Fmcp-server-claude?color=CB3837&logo=npm)](https://www.npmjs.com/package/@h0wzy/mcp-server-claude)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/H0wZy/mcp/blob/main/LICENSE)

**Claude Code MCP Server**. It lets **OpenAI Codex**, **Google Antigravity** or any Model Context Protocol client consult and delegate to **Claude Code** (Anthropic). The default model is `opus` at `medium` effort.

Part of the **[H0wZy/mcp](https://github.com/H0wZy/mcp)** multi-agent ecosystem.

---

## 🔌 Available Tools

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `configure_claude` | `action` (`get` \| `set` \| `reset` \| `list`), `tier`, `model`, `effort` *(all optional)* | Inspect or change the session's model and effort. Tiers: `light` (sonnet, low), `balanced` (opus, medium), `deep` (fable, high). |
| `ask_claude` | `prompt` *(string)*, `paths`, `model`, `effort` *(optional)* | Independent second opinion or explanation. **Read-only**. |
| `review_claude` | `prompt` *(string)*, `paths`, `model`, `effort` *(optional)* | Structured code review. **Read-only**: pass the files in `paths`. |
| `brainstorm_claude` | `prompt` *(string)*, `paths`, `model`, `effort` *(optional)* | Architectural alternatives, trade-offs and a recommendation. **Read-only**. |
| `plan_claude` | `prompt` *(string)*, `paths`, `model`, `effort` *(optional)* | Dependency-ordered implementation plan. **Read-only**. |
| `delegate_claude` | `prompt` *(string)*, `cwd` *(string)*, `paths` *(string[], optional)*, `model`, `effort` *(optional)*, `timeout_minutes` *(number, 1-60, default 30)* | **Edits files** inside `cwd` and the `paths` folders. Hand a self-contained task to Claude Code and get its final report. |

- **Read-only tools** start `claude -p` with only the `Read`, `Grep` and `Glob` tools. No edit or shell tool exists in that session. The session is not saved to your Claude Code history.
- **`delegate_claude`** auto-approves file edits (`--permission-mode acceptEdits`). Anything else that would ask for permission is denied (`--permission-prompts none`), so a run never waits for an answer nobody can give. Shell commands only run if your Claude Code settings already allow them. To let Claude Code's own classifier approve safe actions, set `CLAUDE_BRIDGE_DELEGATE_PERMISSION_MODE=auto`. It never commits; review the diff afterwards.
- **Models**: use the aliases `opus`, `sonnet`, `haiku` and `fable`, which follow new releases, or full ids such as `claude-opus-5-5`. The `haiku` alias (Haiku 5.5) takes effort levels; the pinned `claude-haiku-4-5` has none, so `--effort` is not sent for it.
- **Lean sessions**: the Claude Code it starts loads only the H0wZy/mcp bridges registered in your user config (`--strict-mcp-config` plus a temporary `--mcp-config`), not your other MCP servers or claude.ai connectors. On a real setup that cut a one-line answer from ~380k tokens (US$ 0.38) to US$ 0.004. A project's `.mcp.json` is never passed on. `H0WZY_MCP_USER_SERVERS=1` restores your servers.
- Every reply ends with the execution footer (`[claude · model=… · effort=… · source=… · cost=$… · turns=…]`) and the loop-guard trace line (`[chain codex→claude · depth 1/2 · calls 1/8 · run …]`).

---

## ⚙️ Environment

| Variable | Effect |
| :--- | :--- |
| `CLAUDE_CLI_PATH` | Path to the `claude` executable, if it is not on `PATH` |
| `CLAUDE_BRIDGE_MODEL`, `CLAUDE_BRIDGE_EFFORT` | Startup model and effort (default `opus` / `medium`) |
| `CLAUDE_BRIDGE_MAX_TIER`, `CLAUDE_BRIDGE_MAX_EFFORT` | Ceilings that a `configure_claude` call can't exceed |
| `CLAUDE_BRIDGE_TIER_LIGHT` / `_BALANCED` / `_DEEP` | Override a tier, e.g. `sonnet:medium` |
| `CLAUDE_BRIDGE_MAX_TURNS` | Turn cap for every call (`--max-turns`) |
| `CLAUDE_BRIDGE_MAX_BUDGET_USD` | Spending cap per call in USD (`--max-budget-usd`) |
| `CLAUDE_BRIDGE_DELEGATE_PERMISSION_MODE` | `acceptEdits` (default), `auto` or `dontAsk` |
| `H0WZY_MCP_USER_SERVERS` | `1` lets the nested Claude Code load your own MCP servers too |
| `H0WZY_MCP_*` | Loop-guard limits; see the main README |

These variables use the `CLAUDE_BRIDGE_` prefix, not `CLAUDE_`, because Claude Code exports `CLAUDE_EFFORT` and other `CLAUDE_*` variables to the processes it starts.

---

## 🚀 Installation & Usage

### 1. With the `hmcp` CLI (recommended)

```bash
hmcp install codex-claude         # Codex → Claude Code
hmcp install antigravity-claude   # Antigravity → Claude Code
```

The installer adds `--host <agent>` to the launch arguments so the loop guard knows who is calling. For Codex it also writes the `env_vars` allow-list and long tool timeouts.

### 2. Manual: Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.claude]
command = "npx"
args = ["-y", "@h0wzy/mcp-server-claude", "--host", "codex"]
env_vars = ["H0WZY_MCP_RUN_ID", "H0WZY_MCP_CHAIN", "H0WZY_MCP_DEPTH", "H0WZY_MCP_DEADLINE", "H0WZY_MCP_STATE_DIR"]
tool_timeout_sec = 3900
startup_timeout_sec = 60
```

### 3. Manual: Antigravity (`~/.gemini/config/mcp_config.json`)

```json
{
  "mcpServers": {
    "claude": { "command": "npx", "args": ["-y", "@h0wzy/mcp-server-claude", "--host", "antigravity"] }
  }
}
```

---

## 🛡️ Requirements

- **Claude Code CLI (`claude`)**, installed and signed in (native installer or `npm install -g @anthropic-ai/claude-code`).
- Node.js ≥ 20.

## 📄 License

Created by **Marcos (H0wZy)** under the [MIT License](https://github.com/H0wZy/mcp/blob/main/LICENSE).
