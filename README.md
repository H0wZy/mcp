# 🚀 H0wZy/mcp — The Ultimate Multi-Agent MCP Hub & Go CLI

[![CI Pipeline](https://github.com/H0wZy/mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/H0wZy/mcp/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/H0wZy/mcp?color=04B575&label=release&logo=github)](https://github.com/H0wZy/mcp/releases)
[![npm](https://img.shields.io/npm/v/%40h0wzy%2Fmcp?color=CB3837&logo=npm)](https://www.npmjs.com/package/@h0wzy/mcp)
[![Go Version](https://img.shields.io/badge/Go-1.26+-00ADD8?logo=go)](cli)
[![Node Version](https://img.shields.io/badge/Node-20+-339933?logo=node.js)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/H0wZy/mcp)
[![Security Audit: Passed](https://img.shields.io/badge/Security_Audit-Passed-C084FC?logo=shield)](SECURITY_AUDIT.md)

Centralize, enhance, and distribute high-performance **MCP (Model Context Protocol)** servers connecting the world's leading AI developer CLIs:
- **Claude Code** (Anthropic)
- **OpenAI Codex CLI** (OpenAI GPT-5.6 / GPT-6 Astra)
- **Google Antigravity** (Gemini 3.1 Pro / Flash)

Cross-model code reviews, independent second opinions, and autonomous multi-agent validation — configured effortlessly via an interactive **Golang TUI CLI** and distributed via standalone binaries and `npx @h0wzy/mcp`.

🏷️ `#mcp` `#ai-agents` `#multi-agent` `#antigravity` `#claude-code` `#openai-codex` `#gemini` `#cli` `#go` `#bubbletea` `#tui` `#developer-tools` `#model-context-protocol`

---

## 🏛️ Interactive Architecture Diagram

Explore the full interactive system architecture with Light/Dark themes and semantic tracing:
👉 **[View Interactive Architecture Diagram](specs/001-multi-agent-mcp-hub/architecture.html)**

---

## 🌟 Why H0wZy/mcp?

1. **DRY Shared Core (`@h0wzy/mcp-shared`):**
   - Eliminates matrix code duplication across host agents. A single `createMcpServer()` engine manages 100% of JSON-RPC 2.0 stdio protocol handling, error catching, and lifecycle handshakes.
2. **Native Cross-Platform (Zero Windows Glitches):**
   - Eliminates POSIX-only bugs like `PATH.split(':')` by utilizing native path delimiters (`;` on Windows, `:` on POSIX).
   - Resolves executable extensions automatically (`.exe`, `.cmd`, `.bat` from `PATHEXT`), finding `agy.exe` and `codex.cmd` without requiring manual environment path overrides.
3. **Instant Performance (Zero `npx` Latency):**
   - Directly executes local binaries with sub-50ms invocation overhead, removing runtime `npx` network/cache-checking delays.
4. **Resilient Rate Limits & Quotas:**
   - Gracefully traps HTTP 429 and `ResourceExhausted` provider quota limits, returning structured `{ isError: true }` responses so host agents fall back seamlessly without crashing the session.
5. **Interactive Go CLI (`hmcp` / `h0wzy-mcp`):**
   - Auto-detects local CLI installations (`claude`, `codex`, `agy`), tests binary health, checks for updates, and guides the user through an interactive checklist to configure MCP connections globally or per-project.

---

## 📁 Repository Layout

```text
H0wZy/mcp/
├── .github/workflows/          # CI/CD pipelines & cross-platform testing
├── cli/                        # Interactive CLI in Go (Bubble Tea / Lip Gloss)
│   ├── cmd/                    # Commands: doctor, install, list, remove, setup-path, upgrade, version
│   ├── config/                 # Read/write ~/.claude.json, config.toml, and mcp_config.json
│   ├── detector/               # Discovers local claude, codex, and agy CLIs + health checks
│   ├── ui/                     # Terminal user interface, lilac ASCII banner, and interactive TUI
│   └── version/                # Background update detector & registry version cache
├── servers/                    # Decoupled, host-agnostic MCP servers
│   ├── antigravity/            # Google Antigravity bridge (Gemini 3.1 Pro / Flash)
│   ├── codex/                  # OpenAI Codex CLI bridge (GPT-5.6 / GPT-6 Astra)
│   └── claude/                 # Claude Code bridge
├── shared/                     # Reusable core (@h0wzy/mcp-shared)
│   ├── server.js               # createMcpServer() generic JSON-RPC 2.0 stdio engine
│   ├── executor.js             # Child process runner with timeouts and buffers
│   ├── resolver.js             # Cross-platform executable resolver
│   └── errors.js               # Resilient Quota, HTTP 429 handler & secret/token sanitizer
├── npm/                        # Lightweight npx runner wrapper & cross-platform binary installer
├── specs/                      # SpecKit feature specs & Archify diagrams
├── test/                       # Node.js integration & security resilience tests
├── SECURITY_AUDIT.md           # Security audit, credential double-check & hardening report
├── LICENSE                     # MIT License
└── package.json                # Monorepo workspaces configuration
```

---

## 🚀 Quick Start

### 1. Interactive Setup (Recommended)

Choose your preferred way to run H0wZy/mcp:

```bash
# 1. Instant execution via npx (Zero setup):
npx @h0wzy/mcp

# 2. Or install globally via npm (provides 'hmcp', 'hwzmcp', and 'h0wzy-mcp'):
npm install -g @h0wzy/mcp
hmcp

# 3. Or directly from source with Go:
go run ./cli setup-path
hmcp
```

#### 📦 Precompiled Standalone Binaries (v1.0.3)

Download zero-dependency native binaries directly from [Releases](https://github.com/H0wZy/mcp/releases):
- 🪟 **Windows (`amd64`):** [`h0wzy-mcp-windows-amd64.exe`](https://github.com/H0wZy/mcp/releases/download/v1.0.3/h0wzy-mcp-windows-amd64.exe)
- 🐧 **Linux (`amd64`):** [`h0wzy-mcp-linux-amd64`](https://github.com/H0wZy/mcp/releases/download/v1.0.3/h0wzy-mcp-linux-amd64)
- 🍏 **macOS Apple Silicon (`arm64`):** [`h0wzy-mcp-darwin-arm64`](https://github.com/H0wZy/mcp/releases/download/v1.0.3/h0wzy-mcp-darwin-arm64)
- 🍏 **macOS Intel (`amd64`):** [`h0wzy-mcp-darwin-amd64`](https://github.com/H0wZy/mcp/releases/download/v1.0.3/h0wzy-mcp-darwin-amd64)

The CLI will scan your system:
```text
🚀 H0wZy/mcp — Multi-Agent MCP Hub Setup
Scanning local AI developer CLIs...
  ✓ Claude Code (C:\Users\...\claude.exe)
  ✓ OpenAI Codex CLI (C:\Users\...\codex.cmd)
  ✓ Google Antigravity (C:\Users\...\agy.exe)

? Select MCP bridges to configure:
  [x] Claude Code -> Google Antigravity (Gemini 3.1 Pro/Flash)
  [x] Claude Code -> OpenAI Codex (GPT-5.6 / GPT-6 Astra)
  [ ] OpenAI Codex -> Google Antigravity (Gemini 3.1)

? Configuration Scope: User (Global across all projects)
? Apply configuration now? Yes

✅ All selected bridges configured successfully!
```

---

### 2. Commands & Management

```bash
# Launch interactive TUI setup and configuration
hmcp

# Check version and verify if updates are available
hmcp version

# Upgrade hmcp to latest release (or 'hmcp update')
hmcp upgrade

# Setup PATH and shims (~/.local/bin) so 'hmcp', 'hwzmcp', and 'h0wzy-mcp' work everywhere
hmcp setup-path

# Diagnose local environment, paths, and agent communication health
hmcp doctor

# Diagnose and output as JSON
hmcp doctor --json

# Install all supported integrations automatically
hmcp install --all

# Install a specific bridge globally or locally
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

H0wZy/mcp is built with privacy and execution safety as first-class guarantees:
- **Automatic Token Redaction**: Built-in regex sanitizers proactively scrub OpenAI keys, Google Gemini keys, GitHub/NPM tokens, and Bearer authorization headers before errors or diagnostic messages reach host agents.
- **Owner-Only File Permissions**: Configuration files (`.claude.json`, `.codex/config.toml`, `.gemini/config/mcp_config.json`) are secured with POSIX mode `0600` (`0700` for directories) on Unix systems to prevent unauthorized local reading.
- **Atomic Precompiled Downloads**: The npm binary installer streams release archives to unique temporary files and validates payloads before atomic renames, preventing corrupt or truncated executables.

For full audit methodology and double-check verification, read the [Security Audit & Codebase Integrity Report](SECURITY_AUDIT.md).

---

## 🧪 Testing

```bash
# Run all Node.js MCP server & resilience tests
npm test

# Run all Go CLI detector & config tests
go test -v ./cli/...
```

---

## 📄 License & Acknowledgements

Created and architected by **Marcos (H0wZy)** under the [MIT License](LICENSE).

This project unifies and enhances foundational work from the open-source MCP community:
- [antigravity-claude-mcp](https://github.com/arjunthilak05/antigravity-claude-mcp) by Arjun Thilak (MIT License)
- [codex-mcp-tool](https://github.com/trishchuk/codex-mcp-tool) by Taras Trishchuk (MIT License)
