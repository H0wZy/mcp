# 🤖 @h0wzy/mcp-server-codex

[![npm](https://img.shields.io/npm/v/%40h0wzy%2Fmcp-server-codex?color=CB3837&logo=npm)](https://www.npmjs.com/package/@h0wzy/mcp-server-codex)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/H0wZy/mcp/blob/main/LICENSE)

High-performance **OpenAI Codex MCP Server** connecting any Model Context Protocol client (such as **Claude Code**, **Google Antigravity**, or custom agents) to OpenAI's **GPT-5.6 Terra / GPT-6 Astra** models.

Part of the **[H0wZy/mcp](https://github.com/H0wZy/mcp)** multi-agent ecosystem.

---

## 🔌 Available Tools

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `ask_codex` | `question` *(string)* | Cross-verification or second opinion from OpenAI Codex (GPT-5.6 / GPT-6 Astra). |
| `review_codex` | `diff` *(string)*, `instruction` *(string)* | Structured repository code review from OpenAI Codex inspecting safety, tests, and diffs. |
| `brainstorm_codex` | `topic` *(string)*, `context` *(string)* | Architectural exploration, trade-offs, and system design ideation with Codex. |
| `plan_codex` | `goal` *(string)*, `requirements` *(string)* | Step-by-step implementation planning, checklists, and dependency roadmaps. |

---

## 🚀 Installation & Usage

### 1. Automated Setup via `hmcp` CLI (Recommended)

The easiest way to install and register this bridge into Claude Code or Google Antigravity:

```bash
# Install globally or per-project
hmcp install claude-codex --scope user
```

### 2. Standalone Execution via `npx`

You can run the server directly with zero prior setup:

```bash
npx @h0wzy/mcp-server-codex
```

### 3. Manual Configuration

#### In Claude Code (`~/.claude.json`):

```json
{
  "mcpServers": {
    "codex": {
      "command": "npx",
      "args": ["-y", "@h0wzy/mcp-server-codex"]
    }
  }
}
```

Or using local source:

```json
{
  "mcpServers": {
    "codex": {
      "command": "node",
      "args": ["<path-to-mcp>/servers/codex/bin/cli.js"]
    }
  }
}
```

---

## 🛡️ Requirements & Resilience

- **OpenAI Codex CLI (`codex`)**: Must be installed and authenticated on your system.
- **Cross-Platform**: Automatically locates `codex.cmd` (Windows) or `codex` (macOS/Linux) via native PATH resolution.
- **Rate Limit & Quota Resilience**: Gracefully traps HTTP 429 and rate-limit errors, returning structured fallback responses rather than crashing the client session.
- **Privacy & Security**: Built-in credential redaction proactively masks API keys, OpenAI tokens (`sk-...`), and authorization headers from error messages.

---

## 📄 License

Created by **Marcos (H0wZy)** under the [MIT License](https://github.com/H0wZy/mcp/blob/main/LICENSE).  
Full documentation and repository: 👉 **[H0wZy/mcp](https://github.com/H0wZy/mcp)**
