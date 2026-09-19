# Feature Specification: CLI ASCII Banner & Visual Identity

**Feature Branch**: `002-cli-ascii-banner`

**Created**: 2026-09-19

**Status**: Ready for Review

**Input**: User description: "Implement a modern, stylish ASCII/FIGlet terminal banner in the Go CLI on startup, similar to Claude Code, Codex CLI, Kiro CLI, and Agy. Use a zero-dependency static string approach, detect TTY/non-TTY for clean pipes/redirection, adapt to narrow terminals with a compact fallback, respect NO_COLOR, and display application metadata."

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Modern Terminal Visual Identity (Priority: P1)

As a developer launching `h0wzy-mcp` in my interactive terminal, I want to be greeted with a polished, modern ASCII art banner and application identity, so that the CLI feels like a professional, first-class AI developer tool rather than a generic utility.

**Why this priority**: Immediate visual brand identity and polish is the primary objective of this feature.

**Independent Test**: Launch the CLI directly in an interactive terminal session (`h0wzy-mcp` or `go run ./cli`); observe the formatted ASCII banner, styled typography, and metadata header before the interactive prompts appear.

**Acceptance Scenarios**:

1. **Given** an interactive terminal (TTY) with standard width (>= 80 columns), **When** the developer launches `h0wzy-mcp`, **Then** the system displays the styled ASCII art banner followed by the application description, version, and interactive checklist.
2. **Given** a terminal supporting colors, **When** the banner renders, **Then** it uses modern accent styling (cyan/teal highlight) consistent with the project's visual theme without rainbow or blinking effects.

---

### User Story 2 - Clean Automation, Redirection & Pipeline Safety (Priority: P2)

As a developer or automation script executing `h0wzy-mcp` in a pipeline or redirected to a file (`h0wzy-mcp > output.txt`, `h0wzy-mcp | grep ...`, or CI/CD), I want the banner to be automatically suppressed, so that my script output and logs remain clean, parseable, and free of ASCII art or ANSI escape sequences.

**Why this priority**: Non-interactive usability must never be compromised by visual enhancements.

**Independent Test**: Run `go run ./cli doctor > output.txt` or pipe into a command; inspect the output file to verify that zero banner art or ANSI color escape sequences are present.

**Acceptance Scenarios**:

1. **Given** a non-interactive standard output (such as file redirection or pipe), **When** any CLI command runs, **Then** the ASCII banner is completely omitted.
2. **Given** the `doctor` command executed with `--json`, **When** the output is produced, **Then** only pure, valid JSON is printed to stdout.

---

### User Story 3 - Responsive Terminal Adaptation & `NO_COLOR` Compliance (Priority: P3)

As a developer working in constrained environments (such as a split terminal pane, narrow mobile terminal, or an environment with `NO_COLOR=1`), I want the banner to gracefully adapt without horizontal line wrapping and respect accessibility color preferences.

**Why this priority**: Prevents broken, visually scrambled text on small screens and respects terminal accessibility standards.

**Independent Test**: Resize terminal window to < 60 columns and run `h0wzy-mcp` to verify the compact text fallback; run `NO_COLOR=1 h0wzy-mcp` to verify absence of ANSI color codes.

**Acceptance Scenarios**:

1. **Given** a terminal window narrower than the ASCII art width (< 72 columns), **When** the banner renders, **Then** the system automatically falls back to a sleek, compact single-line header (`H0wZy/mcp — Multi-Agent MCP Hub`) without line-wrapping artifacts.
2. **Given** the environment variable `NO_COLOR` is set (any non-empty value), **When** the banner or header renders, **Then** all ANSI color escape sequences are disabled.

---

### Edge Cases

- **Undetectable Terminal Size**: If the terminal width query returns an error or 0 columns (e.g. esoteric pseudo-terminals), the system safely defaults to the compact header to avoid potential visual wrapping.
- **Subcommands Execution**: When executing headless subcommands (`h0wzy-mcp install`, `h0wzy-mcp remove`), the visual banner is bypassed or kept minimal so that command-specific output takes precedence.
- **Fast Exit (`Ctrl+C`)**: Rendering the banner must be instantaneous (< 2ms) and purely static, introducing zero latency or asynchronous delays to startup or abort signals.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST render an ASCII art banner representing the project name (`H0wZy/mcp` / `H0wZy`) when launched in an interactive terminal.
- **FR-002**: The banner MUST be stored as a static raw string constant within the Go codebase to guarantee zero runtime generation overhead and zero new third-party dependencies.
- **FR-003**: The system MUST detect whether stdout is an interactive terminal (TTY) and suppress the banner when output is redirected to a file or piped into another process.
- **FR-004**: The system MUST query the terminal width and automatically display a compact single-line text header if the terminal width is less than the ASCII banner width.
- **FR-005**: The system MUST adhere to the `NO_COLOR` standard, disabling all ANSI color styling when the `NO_COLOR` environment variable is present.
- **FR-006**: The system MUST display the application name, version tag, and brief description directly beneath the banner.
- **FR-007**: The banner logic MUST be encapsulated in a dedicated visual rendering function/file (e.g. `cli/ui/banner.go`) to keep `main.go` and `root.go` clean and maintainable.
- **FR-008**: The banner rendering MUST NOT alter the execution logic, flag handling, or exit codes of any existing commands (`doctor`, `install`, `list`, `remove`).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Banner rendering execution overhead is under 2 milliseconds upon CLI launch.
- **SC-002**: 0 bytes of ASCII art or ANSI escape sequences emitted when stdout is redirected (`h0wzy-mcp > file.txt`).
- **SC-003**: 0 horizontal line wraps or visual corruption when running on a 60-column terminal window.
- **SC-004**: 0 new third-party dependencies added to `cli/go.mod` (reusing existing `lipgloss`, `term`, `isatty`).
- **SC-005**: 100% test pass rate across `go test ./cli/...`.

---

## Assumptions

- Users executing in an interactive TTY have a terminal that supports standard UTF-8 block/box-drawing characters.
- For non-interactive environments, standard output redirection detection via standard Go terminal libraries (`os.Stdout.Fd()`) is accurate across Windows, Linux, and macOS.
