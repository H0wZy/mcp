# Feature Specification: CLI Parity, PATH Aliases, and Auto-Update Engine

**Feature Directory**: `specs/003-cli-parity-and-updates`

**Created**: 2026-09-19

**Status**: Draft

**Input**: User description: "Global PATH binary setup, auto-update detection with version & upgrade commands (without -- prefix), and tool parity across Antigravity and Codex"

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Global Terminal Access via Frictionless Aliases (Priority: P1)

Developers want to interact with the MCP hub using short, memorable commands from any terminal without having to type full paths, long command strings, or `npx` prefixes every time.

**Why this priority**: Immediate usability. Developers will not adopt a tool if the friction to run it from their shell is too high.

**Independent Test**: Can be tested by opening any arbitrary terminal directory (e.g. `~` or an empty workspace) and executing `hmcp doctor` or `h0wzy-mcp doctor` and receiving instant CLI responses.

**Acceptance Scenarios**:

1. **Given** a user has installed the package or run the path setup, **When** they type `hmcp` in any terminal, **Then** the interactive hub interface starts immediately.
2. **Given** a user prefers alternative names, **When** they type `hwzmcp` or `h0wzy-mcp`, **Then** the exact same CLI starts without delay or discrepancies.
3. **Given** a fresh system where the binary is not yet in the system PATH, **When** the user runs `hmcp setup-path`, **Then** the binary shims are placed in the user's local PATH directory (`~/.local/bin` or npm bin) and are immediately executable.

---

### User Story 2 - Native Subcommands for Versioning and Upgrades (Priority: P1)

Users want to check their installed version, see if an update is available on npm/GitHub, and upgrade seamlessly using clean subcommands (`hmcp version`, `hmcp upgrade`, `hmcp update`) without needing awkward syntax like `--version` or `--upgrade`.

**Why this priority**: Maintainability and release lifecycle. Keeps all users on the latest release effortlessly as new bridges and agent capabilities are released.

**Independent Test**: Can be tested by running `hmcp version` (verifying current version and update status) and `hmcp upgrade` (verifying upgrade flow).

**Acceptance Scenarios**:

1. **Given** a user runs `hmcp version`, **When** the command executes, **Then** it displays the current version, target architecture, and checks whether an update is available on npm/GitHub.
2. **Given** an update is available, **When** the user runs `hmcp upgrade` (or `hmcp update`), **Then** the CLI automatically downloads and replaces the binary or invokes the package manager to upgrade to the latest version.
3. **Given** the user runs any regular command (e.g. `hmcp doctor` or interactive mode), **When** an update has been detected, **Then** a clean, non-intrusive update notification is shown with the command to upgrade.

---

### User Story 3 - Full Feature Parity between Antigravity and Codex MCP Servers (Priority: P1)

AI agent users (like Claude Code) want symmetrical capabilities when consulting different foundation model families. Rather than only having `ask_antigravity`, users need specialized tools for code review, architectural brainstorming, and implementation planning on both Google Antigravity (Gemini 3.1 Pro High) and OpenAI Codex (GPT-5.6 / GPT-6 Astra).

**Why this priority**: Unlocks deep multi-agent collaboration, allowing Claude Code to request independent reviews, brainstorm alternative architectures, and plan steps using different frontier models.

**Independent Test**: Can be tested by launching the MCP stdio servers and sending JSON-RPC `tools/list` and `tools/call` for `review_antigravity`, `brainstorm_antigravity`, `plan_antigravity`, `review_codex`, `brainstorm_codex`, and `plan_codex`.

**Acceptance Scenarios**:

1. **Given** Claude Code requests a code review via `review_antigravity`, **When** provided with a prompt and context files, **Then** Antigravity analyzes the code for correctness, security, performance, and architecture, returning actionable feedback.
2. **Given** Claude Code requests architectural ideation via `brainstorm_antigravity` or `brainstorm_codex`, **When** provided with an engineering problem, **Then** the server returns alternative design patterns, trade-offs, and pros/cons.
3. **Given** Claude Code requests a plan via `plan_antigravity` or `plan_codex`, **When** provided with a feature requirement, **Then** the server returns a structured implementation roadmap with dependency-ordered tasks.

---

### Edge Cases

- **Network Offline During Version Check**: If the system is offline or npm/GitHub is unreachable, `hmcp version` and regular commands MUST timeout quickly (< 1.5s) without crashing, falling back gracefully to reporting the local version.
- **Rate Limiting on Remote Registries**: Version checks must be cached locally in `~/.h0wzy/update-check.json` with a 4-hour cooldown to avoid rate-limiting or network latency during daily use.
- **Context Path Validation**: In `review_*`, `brainstorm_*`, and `plan_*`, invalid or non-existent file paths passed in `paths: []` must be ignored gracefully without halting execution of the prompt.
- **Permission Limitations**: `setup-path` must only modify user-scoped paths (e.g., `~/.local/bin` or user PATH) so that administrator/root privileges are never required.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide binary aliases so users can invoke the tool as `hmcp`, `hwzmcp`, and `h0wzy-mcp`.
- **FR-002**: System MUST provide a `setup-path` subcommand that registers the binary in the user's PATH directory (`~/.local/bin` on POSIX/Windows or npm global shims).
- **FR-003**: System MUST support `version` as a direct subcommand (e.g. `hmcp version`), while preserving compatibility with `-v` and `--version`.
- **FR-004**: System MUST check remote release registries (npm registry `@h0wzy/mcp` and GitHub releases) and indicate if a newer version is available.
- **FR-005**: System MUST support `upgrade` (with `update` as alias) as a direct subcommand to upgrade the installed tool.
- **FR-006**: Antigravity MCP server MUST expose four tools: `ask_antigravity`, `review_antigravity`, `brainstorm_antigravity`, and `plan_antigravity`.
- **FR-007**: Codex MCP server MUST expose four tools: `ask_codex`, `review_codex`, `brainstorm_codex`, and `plan_codex`.
- **FR-008**: All tools MUST support optional context file paths (`paths`) and model overrides (`model`).

### Key Entities

- **UpdateManifest**: Holds current version, latest version, release notes URL, and timestamp of last check.
- **ToolDefinition**: JSON-RPC MCP schema defining tool name, user-facing description, and JSON schema arguments (`prompt`, `paths`, `model`).
- **BinaryShim**: Symlink or executable wrapper installed in the user's PATH directory.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Typing `hmcp` in any terminal shell launches the CLI in under 50 milliseconds.
- **SC-002**: `hmcp version` checks version status and responds in under 1.5 seconds (or instant when cached).
- **SC-003**: Both Antigravity and Codex MCP servers expose 4 functional tools each, verified via JSON-RPC `tools/list`.
- **SC-004**: 100% of integration and resilience tests pass across Go and Node.js test suites.

---

## Assumptions

- Users have Node.js 18+ and Go 1.22+ installed for local compilation or rely on precompiled binaries.
- The user's operating system environment has `~/.local/bin` or npm global bin configured in PATH.
- `agy` CLI is accessible for Antigravity tools; `codex` CLI is accessible for Codex tools.
