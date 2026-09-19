# Implementation Plan: CLI Parity, PATH Aliases, and Auto-Update Engine

**Branch**: `003-cli-parity-and-updates` | **Date**: 2026-09-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-cli-parity-and-updates/spec.md`

## Summary

Expand the H0wZy/mcp multi-agent ecosystem with:
1. Global terminal PATH availability with frictionless aliases: `hmcp` (4 letters, recommended), `hwzmcp`, and `h0wzy-mcp`.
2. Native subcommands for versioning and upgrades (`hmcp version` and `hmcp upgrade` / `hmcp update`), eliminating `--` prefix requirements while supporting cached background update notifications.
3. Complete 4-tool capability parity between Google Antigravity (Gemini 3.1 Pro High) and OpenAI Codex (GPT-5.6 / GPT-6 Astra), enabling Claude Code to request specialized reviews, brainstorming, and planning across model families.

---

## Technical Context

**Language/Version**: Go 1.22+ (for CLI Hub binary) & Node.js 18+ (ES modules for MCP stdio servers)

**Primary Dependencies**:
- Go: `github.com/spf13/cobra` (CLI routing), `github.com/charmbracelet/huh` (interactive TUI), `github.com/charmbracelet/lipgloss` (terminal styling).
- Node.js: Native `node:child_process`, `node:readline`, `node:fs`, `node:path`, `node:https`. Zero 3rd-party runtime npm dependencies.

**Storage**:
- Local cache: `~/.h0wzy/update-check.json` (stores version check cache with 4h TTL).
- Agent configs: `~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/config/mcp_config.json`.
- Global binaries/shims: `~/.local/bin/` and npm global bin.

**Testing**:
- Go: `go test -v ./cli/...` (unit + integration).
- Node.js: `node --test ./test/*.test.js` (stdio JSON-RPC resilience tests).

**Target Platform**: Cross-platform (Windows PowerShell / cmd, macOS zsh / bash, Linux bash / zsh).

**Project Type**: Multi-Agent Hub CLI + MCP Stdio Protocol Servers.

**Performance Goals**:
- Sub-50ms cold startup for binary and aliases.
- Sub-1.5s network check for remote updates with instant local fallback.

**Constraints**:
- Zero administrator/elevated permissions required for PATH configuration.
- Strict backward compatibility with standard flags (`-v`, `--version`).

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I: Library-First**: Shared server logic resides in `@h0wzy/mcp-shared`, keeping individual servers dry and focused. (Pass)
- **Principle II: CLI Interface**: Clean text-in/text-out protocol; subcommands support both human-readable TUI/colored output and structured machine readability. (Pass)
- **Principle III: Test-First**: Stdio protocol tests assert tool schemas and JSON-RPC compliance before and after implementation. (Pass)
- **Principle IV: Simplicity**: No bloated background daemons or unnecessary frameworks. Local cache uses plain JSON with timestamp TTL. (Pass)

---

## Project Structure

### Documentation (this feature)

```text
specs/003-cli-parity-and-updates/
├── spec.md              # Feature specification
├── plan.md              # This implementation plan
├── research.md          # Phase 0 decisions and rationale
├── data-model.md        # Phase 1 data entities and schemas
├── quickstart.md        # Phase 1 validation walk-through
├── contracts/           # Phase 1 interface contracts
│   ├── cli-subcommands.md
│   └── mcp-tools.json
└── tasks.md             # Phase 2 tasks breakdown
```

### Source Code Layout

```text
cli/
├── cmd/
│   ├── doctor.go
│   ├── install.go
│   ├── list.go
│   ├── remove.go
│   ├── root.go
│   ├── setuppath.go     # [NEW] hmcp setup-path command
│   ├── upgrade.go       # [NEW] hmcp upgrade / update command
│   └── version.go       # [NEW] hmcp version command
├── config/
│   ├── antigravity.go
│   ├── claude.go
│   ├── codex.go
│   └── resolver.go
├── detector/
│   └── detector.go
├── ui/
│   ├── banner.go
│   └── tui.go           # Updated to display update alerts
└── version/             # [NEW] Version metadata & update checker engine
    └── version.go

npm/
├── bin/
│   └── h0wzy-mcp.js     # Updated runner
└── package.json         # Updated bin entries for hmcp, hwzmcp, h0wzy-mcp

servers/
├── antigravity/
│   └── src/index.js     # Exposes ask_, review_, brainstorm_, plan_antigravity
└── codex/
    └── src/index.js     # Exposes ask_, review_, brainstorm_, plan_codex

test/
└── stdio-verification.test.js # Updated with full tool parity assertions
```

---

## Complexity Tracking

No constitution violations detected. Architecture remains DRY, lightweight, and single-binary.
