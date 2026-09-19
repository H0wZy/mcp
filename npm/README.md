# 🚀 @h0wzy/mcp — The Ultimate Multi-Agent MCP Hub & Go CLI

[![CI Pipeline](https://github.com/H0wZy/mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/H0wZy/mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40h0wzy%2Fmcp?color=CB3837&logo=npm)](https://www.npmjs.com/package/@h0wzy/mcp)
[![GitHub Release](https://img.shields.io/github/v/release/H0wZy/mcp?color=04B575&label=release&logo=github)](https://github.com/H0wZy/mcp/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/H0wZy/mcp/blob/main/LICENSE)

Centralize, enhance, and distribute high-performance **MCP (Model Context Protocol)** servers connecting the world's leading AI developer CLIs:
- **Claude Code** (Anthropic)
- **OpenAI Codex CLI** (OpenAI GPT-5.6 / GPT-6 Astra)
- **Google Antigravity** (Gemini 3.1 Pro / Flash)

Cross-model code reviews, independent second opinions, and autonomous multi-agent validation — configured effortlessly via an interactive **Golang TUI CLI**.

---

## ⚡ Instant Run (Zero Setup Required)

Run directly with `npx` — no pre-installation of Go or local binaries required! The runner automatically retrieves the native binary for your OS and architecture:

```bash
npx @h0wzy/mcp
```

Or install globally via npm:

```bash
npm install -g @h0wzy/mcp
h0wzy-mcp
```

---

## 🎮 CLI Features & Commands

```bash
# Diagnose local environment, CLI installations, and paths
h0wzy-mcp doctor

# Diagnose and output as JSON
h0wzy-mcp doctor --json

# Install all supported integrations automatically
h0wzy-mcp install --all

# Install a specific bridge globally or per-project
h0wzy-mcp install claude-antigravity --scope user
h0wzy-mcp install claude-codex --scope project

# List available bridges
h0wzy-mcp list

# Remove an integration
h0wzy-mcp remove claude-antigravity
```

---

## 🔌 Available MCP Bridges & Tools

| Bridge | Tool Name | Description |
| :--- | :--- | :--- |
| **Antigravity** | `ask_antigravity` | Get an independent second opinion or code review from Gemini 3.1 Pro / Flash |
| **Codex** | `ask_codex` | Cross-verification with OpenAI Codex (GPT-5.6 / GPT-6 Astra) |
| **Codex** | `review_codex` | Structured repository code review from OpenAI Codex |

---

## 📄 Repository & Full Documentation

For interactive system architecture diagrams, source code, and release notes:
👉 **[GitHub Repository: H0wZy/mcp](https://github.com/H0wZy/mcp)**
