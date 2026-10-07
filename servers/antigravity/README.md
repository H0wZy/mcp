# 🌌 @h0wzy/mcp-server-antigravity

[![npm](https://img.shields.io/npm/v/%40h0wzy%2Fmcp-server-antigravity?color=CB3837&logo=npm)](https://www.npmjs.com/package/@h0wzy/mcp-server-antigravity)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/H0wZy/mcp/blob/main/LICENSE)

High-performance **Google Antigravity MCP Server** connecting any Model Context Protocol client (such as **Claude Code**, **OpenAI Codex**, or custom agents) to Google Antigravity's models (default **Gemini 3.8 Flash**).

Part of the **[H0wZy/mcp](https://github.com/H0wZy/mcp)** multi-agent ecosystem.

---

## 🔌 Available Tools

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `configure_antigravity` | `action` (`get` \| `set` \| `reset` \| `list`), `tier`, `model`, `effort` *(all optional)* | Inspect or change the session's model and reasoning effort; tiers `light` / `balanced` / `deep`. |
| `ask_antigravity` | `prompt` *(string)*, `paths`, `model`, `effort` *(optional)* | Independent second opinion or general question for Google Antigravity. |
| `review_antigravity` | `prompt` *(string)*, `paths`, `model`, `effort` *(optional)* | Structured code review with your focus areas. |
| `brainstorm_antigravity` | `prompt` *(string)*, `paths`, `model`, `effort` *(optional)* | Architectural alternatives, trade-offs and a recommendation. |
| `plan_antigravity` | `prompt` *(string)*, `paths`, `model`, `effort` *(optional)* | Dependency-ordered implementation plan with file paths and test steps. |
| `delegate_antigravity` | `prompt` *(string)*, `cwd` *(string)*, `paths` *(string[], optional)*, `model`, `effort` *(optional)*, `timeout_minutes` *(number, 1-60, default 30)* | **Edits files** inside `cwd`. Hand a self-contained implementation task to Antigravity and get its final report. Review the diff afterwards. |

> `delegate_antigravity` writes to disk and never commits. Review the diff (`git diff`) before keeping its changes.
>
> **Read-only tools** (`ask_*`, `review_*`, `brainstorm_*`, `plan_*`) run `agy` without `--dangerously-skip-permissions`. In print mode Antigravity then soft-denies anything that needs approval (file edits, and shell commands or MCP tools you haven't allowed): nothing is written, and any notice agy prints (skipped actions) is listed under "Antigravity notices" in the answer. These calls also tell the model up front that the request is read-only, which saves the turns it would spend trying. To let reviews run commands such as `git diff`, add rules like `"command(git)"` to `permissions.allow` in `~/.gemini/antigravity-cli/settings.json` ([permissions docs](https://antigravity.google/docs/permissions?tab=cli)). Only `delegate_antigravity` auto-approves.
>
> **Default model:** `Gemini 3.8 Flash (High)`. Override per call (`model`, `effort`), per session with `configure_antigravity`, or at startup with `AGY_MODEL` / `AGY_EFFORT`.

> **Loop guard (spec 006).** Every task tool goes through the shared loop guard before the agent starts. Each reply ends with a trace line such as `[chain claude→antigravity · depth 1/2 · calls 1/8 · run a1b2c3d4]`, and calls that would loop are refused with `⛔ [Loop guard: …]`. `hmcp install` adds `--host <agent>` to the launch arguments so the guard knows which agent is calling.

---

## 🚀 Installation & Usage

### 1. Automated Setup via `hmcp` CLI (Recommended)

The easiest way to install and register this bridge into Claude Code or OpenAI Codex:

```bash
# Install globally or per-project
hmcp install claude-antigravity --scope user
```

### 2. Standalone Execution via `npx`

You can run the server directly with zero prior setup:

```bash
npx @h0wzy/mcp-server-antigravity
```

### 3. Manual Configuration

#### In Claude Code (`~/.claude.json`):

```json
{
  "mcpServers": {
    "antigravity": {
      "command": "npx",
      "args": ["-y", "@h0wzy/mcp-server-antigravity"]
    }
  }
}
```

Or using local source:

```json
{
  "mcpServers": {
    "antigravity": {
      "command": "node",
      "args": ["<path-to-mcp>/servers/antigravity/bin/cli.js"]
    }
  }
}
```

---

## 🛡️ Requirements & Resilience

- **Google Antigravity CLI (`agy`)**: Must be installed and authenticated on your system.
- **Cross-Platform**: Automatically locates `agy.exe` (Windows) or `agy` (macOS/Linux) via native PATH resolution.
- **Rate Limit & Quota Resilience**: Gracefully traps HTTP 429 and `ResourceExhausted` errors, returning structured fallback responses rather than crashing the client session.
- **Privacy & Security**: Built-in credential redaction proactively masks API keys, Google tokens, and sensitive headers from error messages.
- **MCP servers that never connect**: `agy` loads every server in `~/.gemini/config/mcp_config.json` on each call and starts its turn only once all of them have connected. One unreachable server makes every call wait until its time limit and come back empty. The bridge reports that as `⏱️ Antigravity did not finish within N min…` and names the servers agy was still waiting for (from a private `--log-file`, deleted after the call). Bring the server back online or remove it with `agy mcp remove <name>`; `agy mcp disable` did not stop the wait in agy 1.3.1.

---

## 📄 License

Created by **Marcos (H0wZy)** under the [MIT License](https://github.com/H0wZy/mcp/blob/main/LICENSE).  
Full documentation and repository: 👉 **[H0wZy/mcp](https://github.com/H0wZy/mcp)**
