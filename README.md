# 🚀 H0wZy/mcp — The Ultimate Multi-Agent MCP Hub & Go CLI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.26+-00ADD8?logo=go)](cli)
[![Node Version](https://img.shields.io/badge/Node-20+-339933?logo=node.js)](package.json)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/H0wZy/mcp)

Centralize, enhance, and distribute high-performance **MCP (Model Context Protocol)** servers connecting the world's leading AI developer CLIs:
- **Claude Code** (Anthropic)
- **OpenAI Codex CLI** (OpenAI GPT-5.6 / GPT-6 Astra)
- **Google Antigravity** (Gemini 3.1 Pro / Flash)

Cross-model code reviews, independent second opinions, and autonomous multi-agent validation — configured effortlessly via an interactive **Golang TUI CLI** and distributed via standalone binaries and `npx @h0wzy/mcp`.

---

## 🌟 Why H0wZy/mcp?

1. **Native Cross-Platform (Zero Windows Glitches):**
   - Eliminates POSIX-only assumptions like `PATH.split(':')` by utilizing native path delimiters (`;` on Windows, `:` on POSIX).
   - Resolves executable extensions automatically (`.exe`, `.cmd`, `.bat` from `PATHEXT`), finding `agy.exe` and `codex.cmd` without requiring manual environment path overrides.
2. **Instant Performance (Zero `npx` Latency):**
   - Directly executes local binaries with sub-millisecond invocation times, removing runtime `npx` cache-checking or network overhead.
3. **Resilient Rate Limits & Quotas:**
   - Gracefully traps HTTP 429 and `ResourceExhausted` provider quota limits, returning structured `{ isError: true }` responses so host agents fall back seamlessly without crashing the session.
4. **Interactive Go CLI (`h0wzy-mcp`):**
   - Auto-detects local CLI installations (`claude`, `codex`, `agy`), tests binary health, and guides the user through an interactive checklist to configure MCP connections globally or per-project.

---

## 🏛️ Monorepo Architecture

```text
H0wZy/mcp/
├── .github/workflows/          # CI/CD, GoReleaser & cross-platform testing
├── cli/                        # Interactive CLI in Go (Bubble Tea / Huh)
│   ├── cmd/                    # Commands: install, doctor, list, remove
│   ├── detector/               # Discovers local claude, codex, and agy CLIs
│   ├── config/                 # Read/write ~/.claude.json, ~/.codex/config.toml, etc.
│   └── ui/                     # Terminal user interface
├── servers/                    # Decoupled MCP servers
│   ├── claude/
│   │   ├── antigravity/        # Claude Code -> Google Antigravity bridge
│   │   └── codex/              # Claude Code -> Codex CLI bridge
│   ├── codex/
│   │   └── antigravity/        # Codex CLI -> Google Antigravity bridge
│   └── agy/                    # Google Antigravity -> Codex / Claude bridges
├── shared/                     # Platform resolvers, error handling, logging
├── npm/                        # Lightweight npx runner wrapper
├── LICENSE                     # MIT License
└── package.json                # Workspace configuration
```

---

## 🚀 Quick Start

### Option 1: Run via `npx` (No installation needed)
```bash
npx @h0wzy/mcp
```

### Option 2: Run via Go CLI
```bash
# Clone the monorepo
git clone https://github.com/H0wZy/mcp.git
cd mcp

# Run the interactive CLI
go run ./cli
```

### Option 3: Headless Commands
```bash
# Verify environment health and installed CLIs
h0wzy-mcp doctor

# Install all supported integrations automatically
h0wzy-mcp install --all

# Install specific bridge with custom scope (user or local project)
h0wzy-mcp install claude-antigravity --scope user

# List installed & available MCP servers
h0wzy-mcp list
```

---

## 🔌 Supported MCP Bridges

| Host Agent | Target Model / CLI | Tool Name | Description |
| :--- | :--- | :--- | :--- |
| **Claude Code** | **Google Antigravity** | `ask_antigravity` | Independent second opinion from Gemini 3.1 Pro / Flash |
| **Claude Code** | **OpenAI Codex** | `ask_codex`, `review_codex` | Cross-verification with GPT-5.6 / GPT-6 Astra |
| **Codex CLI** | **Google Antigravity** | `ask_antigravity` | Gemini-powered validation inside OpenAI Codex |
| **Antigravity** | **OpenAI Codex** | `ask_codex` | OpenAI reasoning inside Google Antigravity |

---

## 📄 License & Acknowledgements

Created and architected by **Marcos (H0wZy)** under the [MIT License](LICENSE).

This project unifies and enhances foundational work from the open-source MCP community:
- [antigravity-claude-mcp](https://github.com/arjunthilak05/antigravity-claude-mcp) by Arjun Thilak (MIT License)
- [codex-mcp-tool](https://github.com/trishchuk/codex-mcp-tool) by Taras Trishchuk (MIT License)
