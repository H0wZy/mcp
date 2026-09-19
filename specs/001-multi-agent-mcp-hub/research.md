# Phase 0 Research: Multi-Agent MCP Hub & Go CLI

This document captures technology selections, design rationales, and evaluation of alternatives for the H0wZy/mcp architecture.

---

## 1. MCP Core Architecture: Reusable Engine vs Per-Client Servers

- **Decision**: Implement a centralized, reusable MCP engine in `@h0wzy/mcp-shared` (`createMcpServer`) that manages the entire JSON-RPC 2.0 stdio lifecycle, error boundaries, and tool dispatch. Individual servers (`servers/antigravity`, `servers/codex`, `servers/claude`) declare only their unique tool schemas and command dispatchers.
- **Rationale**:
  - MCP over stdio is an identical protocol regardless of the host agent (Claude Code, OpenAI Codex, Antigravity IDE, Cursor, VS Code).
  - Isolating stdio reading (`readline`), parsing, error trapping, and response formatting in `shared/` eliminates duplicated boilerplate and ensures bugfixes (e.g. protocol compliance, unhandled promise rejections) apply to all servers instantly.
  - Keeps community contributions lightweight: adding a new model provider requires only declaring the tool schema and invocation command.
- **Alternatives Considered**:
  - *Per-Client Matrix (`servers/claude/antigravity`, `servers/codex/antigravity`, etc.)*: Rejected because it duplicates 80% identical protocol code across 6–9 directories and makes maintenance error-prone.
  - *Using the heavy official `@modelcontextprotocol/sdk`*: Evaluated, but opted for a zero-dependency native Node.js implementation to ensure instant cold-start execution with sub-millisecond overhead and zero package vulnerability baggage.

---

## 2. Platform-Agnostic Executable Resolution

- **Decision**: Implement `resolveBinary(name, overrideEnvVar)` in `@h0wzy/mcp-shared/resolver.js` utilizing `path.delimiter`, inspecting `PATHEXT` on Windows (`.exe`, `.cmd`, `.bat`), prioritizing standard installation directories (`%LOCALAPPDATA%\agy\bin`, `%APPDATA%\npm`, `~/.local/bin`), and falling back to PATH lookups.
- **Rationale**:
  - Windows systems fail when scripts use Unix-style `PATH.split(':')` because Windows uses `;`.
  - Windows binaries in global npm (like `codex`) exist as `codex.cmd`, while `agy` resides at `%LOCALAPPDATA%\agy\bin\agy.exe`. Searching without extension or executing the extensionless bash script on Windows yields `ENOENT` / `ENOEXEC`.
  - Automated resolution removes the need for manual user environment variables (`AGY_BIN`, `CODEX_CLI_PATH`).
- **Alternatives Considered**:
  - *Relying solely on `where.exe` / `which` via child_process*: Slower because it spawns a separate OS process on every startup. Direct filesystem stat checks (`statSync`) in known directories and PATHEXT are ~20x faster.

---

## 3. Quota & Rate Limit Resilience (HTTP 429 / ResourceExhausted)

- **Decision**: Intercept rate limit, quota exhaustion, and authentication errors in `@h0wzy/mcp-shared/errors.js` and format them into structured `{ isError: true, content: [{ type: 'text', text: ... }] }` tool responses.
- **Rationale**:
  - When a host agent (e.g. Claude Code) invokes a peer tool, an unhandled subprocess failure or JSON-RPC protocol error (`code: -32603`) can abort the agent's active reasoning session.
  - Returning a well-formatted diagnostic text with `isError: true` signals to the host agent that the external tool failed due to quotas, allowing the agent to gracefully fall back to its internal knowledge and keep the user productive.
- **Alternatives Considered**:
  - *Throwing JSON-RPC internal errors*: Rejected because host agents treat protocol-level errors as unrecoverable tool failures.
  - *Silent failure with empty text*: Rejected because the developer would not know why their second opinion was missing.

---

## 4. Go CLI & TUI Library Selection

- **Decision**: Scaffold `cli/` using **Go 1.26**, utilizing `github.com/spf13/cobra` for command-line structure and `github.com/charmbracelet/huh` (built on Bubble Tea) for the interactive terminal checklist and prompts.
- **Rationale**:
  - Single standalone binary compilation with zero runtime dependencies.
  - `huh` provides accessible, beautiful form fields (multiselect checklists, confirms, selects) ideal for scanning and configuring MCP servers.
  - `cobra` provides clean subcommands (`install`, `doctor`, `list`, `remove`) and flag parsing (`--all`, `--scope`).
  - Distributable both as standalone binaries via GoReleaser and via `npx @h0wzy/mcp` using a lightweight npm wrapper runner.
- **Alternatives Considered**:
  - *Node.js CLI (Inquirer / Prompts)*: Slower startup times, requires Node runtime preinstalled for the installer itself, and npm dependency trees can be bloated.
  - *Pure Bubble Tea without Huh*: Requires handwriting extensive boilerplate for form state machines; `huh` provides identical visual polish with 70% less code.

---

## 5. Direct Local Execution vs `npx -y` Runtime Invocation

- **Decision**: Configure all host agents (Claude Code, Codex, Antigravity) to execute servers via direct local Node paths (`node /path/to/server/bin/cli.js`) rather than `npx -y <package>`.
- **Rationale**:
  - `npx -y` introduces a 1–4 second delay on every single invocation while checking npm registry manifests and local cache.
  - Direct local `node` execution has near-zero latency (<25ms startup), delivering instant responsiveness during pair programming.
- **Alternatives Considered**:
  - *Publishing each server separately to npm and running `npx -y`*: Maintained as an optional alternative for remote users, but local direct registration is the recommended default.
