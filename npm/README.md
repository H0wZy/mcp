# 🚀 @h0wzy/mcp — The Ultimate Multi-Agent MCP Hub & Go CLI

[![CI Pipeline](https://github.com/H0wZy/mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/H0wZy/mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40h0wzy%2Fmcp?color=CB3837&logo=npm)](https://www.npmjs.com/package/@h0wzy/mcp)
[![GitHub Release](https://img.shields.io/github/v/release/H0wZy/mcp?color=04B575&label=release&logo=github)](https://github.com/H0wZy/mcp/releases)
[![Security Audit: Passed](https://img.shields.io/badge/Security_Audit-Passed-C084FC?logo=shield)](https://github.com/H0wZy/mcp/blob/main/SECURITY_AUDIT.md)
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

Or install globally via npm (provides `hmcp`, `hwzmcp`, and `h0wzy-mcp` commands):

```bash
npm install -g @h0wzy/mcp
hmcp
```

---

## 🎮 CLI Features & Commands

```bash
# Launch interactive TUI configuration
hmcp

# Check version and verify if updates are available
hmcp version

# Upgrade hmcp to latest release (or 'hmcp update')
hmcp upgrade

# Setup PATH and shims (~/.local/bin) so 'hmcp' works everywhere
hmcp setup-path

# Diagnose local environment, CLI installations, and paths
hmcp doctor

# Diagnose and output as JSON
hmcp doctor --json

# Install all supported integrations automatically
hmcp install --all

# Install a specific bridge globally or per-project
hmcp install claude-antigravity --scope user
hmcp install claude-codex --scope project

# List available bridges
hmcp list

# Remove an integration
hmcp remove claude-antigravity
```

---

## 🔌 Available MCP Tools (Symmetrical Parity)

| Provider | Tool Name | Description |
| :--- | :--- | :--- |
| **Antigravity** | `ask_antigravity` | Independent second opinion or general inquiry from Gemini 3.1 Pro / Flash |
| **Antigravity** | `review_antigravity` | Comprehensive code & security review inspecting correctness, edge cases, and diffs |
| **Antigravity** | `brainstorm_antigravity` | Architectural exploration, trade-offs, and design patterns with Gemini |
| **Antigravity** | `plan_antigravity` | Structured implementation roadmaps and dependency-ordered execution steps |
| **Codex** | `ask_codex` | Cross-verification with OpenAI Codex (GPT-5.6 Terra / GPT-6 Astra) |
| **Codex** | `review_codex` | Structured repository code review from OpenAI Codex |
| **Codex** | `brainstorm_codex` | Architectural exploration, trade-offs, and system design ideation with Codex |
| **Codex** | `plan_codex` | Step-by-step implementation planning and checklist generation |

---

## 🔒 Security & Privacy

- **Automatic Token Redaction**: Built-in regex sanitizers proactively scrub OpenAI keys, Google Gemini keys, GitHub/NPM tokens, and Bearer authorization headers before errors or diagnostic messages reach host agents.
- **OIDC Trusted Publishing**: Distributed directly via GitHub Actions using OpenID Connect (OIDC) and SLSA Provenance attestations with zero static tokens.
- **Owner-Only File Permissions**: Configuration files (`.claude.json`, `.codex/config.toml`, `mcp_config.json`) are secured with mode `0600` (`0700` for directories) on Unix systems.

---

## 📄 Repository & Full Documentation

For interactive system architecture diagrams, source code, and release notes:  
👉 **[GitHub Repository: H0wZy/mcp](https://github.com/H0wZy/mcp)**
