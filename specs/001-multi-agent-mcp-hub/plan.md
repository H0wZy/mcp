# Implementation Plan: Multi-Agent MCP Hub & Go CLI

**Branch**: `001-multi-agent-mcp-hub` | **Date**: 2026-09-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from [specs/001-multi-agent-mcp-hub/spec.md](spec.md)

---

## Summary

Build the unified multi-agent MCP hub monorepo (`H0wZy/mcp`) that connects **Claude Code**, **OpenAI Codex CLI**, and **Google Antigravity/Gemini** for cross-model code reviews and independent validations.

The architecture eliminates boilerplate and client-specific duplication by implementing a DRY shared engine in `@h0wzy/mcp-shared` (`createMcpServer()`), universal cross-platform binary resolution (`PATHEXT`, `.exe`, `.cmd`), resilient HTTP 429 quota handling, and a high-performance interactive **Go CLI** (`h0wzy-mcp` / `npx @h0wzy/mcp`) for automated environment discovery and zero-config setup.

---

## Technical Context

**Language/Version**:
- **Go 1.26** for the standalone CLI (`cli/`)
- **Node.js 20+** (ES Modules) for the MCP servers and shared core

**Primary Dependencies**:
- Go: `github.com/spf13/cobra` (command structure), `github.com/charmbracelet/huh` (interactive TUI checklist & prompts), `github.com/charmbracelet/lipgloss` (styling), `github.com/pelletier/go-toml/v2` (for Codex TOML config parsing)
- Node: Zero external runtime dependencies (relies on native `node:readline`, `node:child_process`, `node:fs`, `node:path`)

**Storage**:
- User configuration files:
  - Claude Code: `~/.claude.json` (global) or `.mcp.json` (project)
  - OpenAI Codex CLI: `~/.codex/config.toml`
  - Google Antigravity: `~/.gemini/config/mcp_config.json`

**Testing**:
- Go CLI unit and detector tests: `go test ./...` in `cli/`
- Node servers and shared resolver tests: `node --test test/*.test.js`

**Target Platform**:
- Windows 10/11 (PowerShell/CMD), macOS (Darwin arm64/amd64), and Linux (x86_64/arm64)

**Project Type**:
- Monorepo containing a standalone compiled Go CLI and decoupled, host-agnostic Node.js MCP servers

**Performance Goals**:
- Sub-50ms local MCP invocation overhead (zero `npx` network/cache latency)
- Sub-second cold-start for the Go CLI interactive scanner

**Constraints**:
- Must not overwrite or corrupt unrelated keys in user configuration files
- Must safely handle HTTP 429 / ResourceExhausted errors without crashing host agent sessions

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Self-Contained & Modular**: Individual MCP servers declare only schemas and dispatch logic, importing protocol handling from `@h0wzy/mcp-shared`.
- [x] **CLI-First**: All capabilities accessible via interactive TUI and scriptable non-interactive flags (`install --all`, `doctor`, `list`).
- [x] **Zero External Runtime Overhead**: MCP servers use native Node APIs without heavy third-party bundles.
- [x] **Cross-Platform Parity**: Full Windows path support (`path.delimiter`, `PATHEXT`, `.exe`, `.cmd`).
- [x] **Preserved Attribution**: Original upstream authors credited in `LICENSE` and server notices under MIT terms.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-multi-agent-mcp-hub/
├── spec.md                  # Feature requirements & acceptance criteria
├── checklists/
│   └── requirements.md      # Spec quality checklist
├── architecture.json        # Archify machine-readable specification
├── architecture.html        # Archify interactive standalone diagram (showcase quality)
├── architecture.visual-check.html # Multi-viewport visual verification
├── plan.md                  # This implementation plan
├── research.md              # Phase 0: Technology decisions & evaluations
├── data-model.md            # Phase 1: Core entities & state transitions
├── contracts/               # Phase 1: Interface contracts
│   ├── mcp-stdio.json       # MCP stdio JSON-RPC 2.0 schema
│   └── cli-interface.md     # h0wzy-mcp CLI command specifications
└── quickstart.md            # Phase 1: Validation and testing guide
```

### Source Code (repository root)

```text
H0wZy/mcp/
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Node test & Go test across OSes
│       └── release.yml            # GoReleaser multi-arch build
├── cli/                           # Interactive Go CLI
│   ├── cmd/
│   │   ├── root.go                # Root command & interactive TUI launcher
│   │   ├── install.go             # 'install' command (--all, --scope)
│   │   ├── doctor.go              # 'doctor' health probe command
│   │   ├── list.go                # 'list' bridges command
│   │   └── remove.go              # 'remove' bridge command
│   ├── detector/
│   │   ├── detector.go            # Binary and version discovery for claude, codex, agy
│   │   └── health.go              # Ping and probe checks
│   ├── config/
│   │   ├── claude.go              # Read/write ~/.claude.json & .mcp.json
│   │   ├── codex.go               # Read/write ~/.codex/config.toml
│   │   └── antigravity.go         # Read/write ~/.gemini/config/mcp_config.json
│   ├── ui/
│   │   └── tui.go                 # Huh interactive checklist and form
│   ├── go.mod
│   └── main.go
├── shared/                         # Reusable core engine (@h0wzy/mcp-shared)
│   ├── server.js                  # createMcpServer() generic JSON-RPC stdio engine
│   ├── executor.js                # Child process runner with timeout and buffer
│   ├── resolver.js                # Universal cross-platform executable resolver
│   ├── errors.js                  # Resilient Quota / HTTP 429 error handler
│   ├── index.js
│   └── package.json
├── servers/                       # Decoupled MCP servers
│   ├── antigravity/               # Exposes Google Antigravity (Gemini 3.1 Pro/Flash)
│   │   ├── src/index.js
│   │   ├── bin/cli.js
│   │   └── package.json
│   └── codex/                     # Exposes OpenAI Codex (GPT-5.6 / GPT-6 Astra)
│       ├── src/index.js
│       ├── bin/cli.js
│       └── package.json
├── npm/                           # Lightweight npx runner
│   ├── bin/h0wzy-mcp.js
│   └── package.json
├── package.json                   # Root workspace config
├── LICENSE                        # MIT License
└── README.md                      # Hub overview & documentation
```

---

## Complexity Tracking

| Mechanism | Why Needed | Simpler Alternative Rejected Because |
| :--- | :--- | :--- |
| **Shared MCP Engine (`shared/server.js`)** | Centralizes JSON-RPC 2.0 stdio handling for all servers | Duplicate server implementations would create 6–9 copies of the same boilerplate |
| **Go CLI (`cli/`)** | Instant native TUI with zero prerequisites; standalone binaries | Node-based CLI has slower startup and requires Node pre-installed for the setup tool |
| **Direct Node Paths** | Sub-50ms tool invocation latency | `npx -y` adds 1–4 seconds of cache and network checks on every tool call |
