# Implementation Plan: CLI ASCII Banner & Visual Identity

**Branch**: `002-cli-ascii-banner` | **Date**: 2026-09-19 | **Spec**: [specs/002-cli-ascii-banner/spec.md](file:///c:/Users/h0wzy/projects/mcp/specs/002-cli-ascii-banner/spec.md)

**Input**: Feature specification from `specs/002-cli-ascii-banner/spec.md` with Claude Code CLI chunky blocky/square typography design.

## Summary

Implement a polished visual startup banner for the `H0wZy/mcp` Go CLI inspired by the iconic blocky/square 3D-shadow typography of Claude Code CLI. The banner will be stored as a static zero-dependency raw string, feature interactive TTY detection to ensure safe stdout piping/redirection, adapt responsively to narrow terminal viewports (< 80 columns) via a sleek compact fallback, respect `NO_COLOR` environment settings, and display application metadata and supported agent bridges.

## Technical Context

**Language/Version**: Go 1.26.7 (Windows/Linux/macOS cross-platform)

**Primary Dependencies**: Standard library (`os`, `strings`, `fmt`), `github.com/charmbracelet/lipgloss` (existing, handles ANSI styling and automatic `NO_COLOR` stripping), `github.com/charmbracelet/x/term` (existing, handles terminal detection and dimensions)

**Storage**: N/A (In-memory static constants)

**Testing**: Standard Go testing framework (`go test -v ./cli/...`)

**Target Platform**: Windows (PowerShell, Windows Terminal, cmd.exe), Linux, macOS

**Project Type**: CLI tool & developer hub

**Performance Goals**: Banner evaluation & render overhead < 1ms on startup; 0 allocations in hot paths

**Constraints**:
- Zero new third-party dependencies in `cli/go.mod`
- Must never print banner or ANSI escape sequences when stdout is redirected to a file or pipe
- Subcommands (`doctor`, `doctor --json`, `install`, `list`, `remove`) must maintain clean non-interactive output
- Safe fallback when terminal width < 80 columns or undetectable

**Scale/Scope**: ~100 lines of Go code in `cli/ui/banner.go` and comprehensive unit tests in `cli/ui/banner_test.go`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Library/DRY)**: Reuses existing `lipgloss` and `term` modules in `cli/go.mod`. No external FIGlet libraries. PASS.
- **Principle II (CLI Interface)**: Text-in/out protocols preserved. `doctor --json` prints only JSON. Non-TTY invocations emit 0 banner bytes. PASS.
- **Principle III (Test-First & Verification)**: Unit tests for TTY suppression, narrow terminal fallback, line width boundaries, and metadata validation. PASS.
- **Principle IV (Simplicity & YAGNI)**: Static raw string constant avoids runtime parsing, FIGlet font files, or regex overhead. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/002-cli-ascii-banner/
├── spec.md              # Feature specification
├── plan.md              # This implementation plan
├── research.md          # Typography research & technical decisions
├── data-model.md        # Banner state & layout entities
├── quickstart.md        # Verification scenarios & validation guide
├── contracts/
│   └── cli-banner.md    # Interface contract for visual output
└── tasks.md             # Actionable, dependency-ordered tasks
```

### Source Code (repository root)

```text
cli/
├── cmd/
│   ├── root.go          # Root cobra command invoking ui.RunInteractive()
│   └── doctor.go        # Doctor command (clean output, supports --json)
├── ui/
│   ├── banner.go        # ASCII art constant, TTY check, width detection, RenderBanner()
│   ├── banner_test.go   # Unit test suite covering all render scenarios
│   └── tui.go           # Interactive huh wizard invoking PrintBanner()
└── main.go
```

**Structure Decision**: Keep all banner rendering logic encapsulated in `cli/ui/banner.go` and tested in `cli/ui/banner_test.go`. The interactive wizard (`cli/ui/tui.go`) invokes `PrintBanner()` once upon startup.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | Fully complies with all constitutional principles |
