# 🌌 @h0wzy/mcp-server-antigravity

[![npm](https://img.shields.io/npm/v/%40h0wzy%2Fmcp-server-antigravity?color=CB3837&logo=npm)](https://www.npmjs.com/package/@h0wzy/mcp-server-antigravity)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/H0wZy/mcp/blob/main/LICENSE)

High-performance **Google Antigravity MCP Server** connecting any Model Context Protocol client (such as **Claude Code**, **OpenAI Codex**, or custom agents) to Google Antigravity's **Gemini 3.1 Pro / Flash** models.

Part of the **[H0wZy/mcp](https://github.com/H0wZy/mcp)** multi-agent ecosystem.

---

## 🔌 Available Tools

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `ask_antigravity` | `question` *(string)* | Independent second opinion or general inquiry from Gemini 3.1 Pro / Flash. |
| `review_antigravity` | `diff` *(string)*, `instruction` *(string)* | Comprehensive code and security review inspecting correctness, potential regressions, and edge cases. |
| `brainstorm_antigravity` | `topic` *(string)*, `context` *(string)* | Architectural exploration, trade-offs, and design pattern ideation with Gemini. |
| `plan_antigravity` | `goal` *(string)*, `requirements` *(string)* | Structured implementation roadmaps with dependency-ordered execution steps. |

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

---

## 📄 License

Created by **Marcos (H0wZy)** under the [MIT License](https://github.com/H0wZy/mcp/blob/main/LICENSE).  
Full documentation and repository: 👉 **[H0wZy/mcp](https://github.com/H0wZy/mcp)**
