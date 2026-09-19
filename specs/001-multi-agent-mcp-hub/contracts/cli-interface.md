# Contract: `h0wzy-mcp` CLI Interface

This document specifies the CLI command syntax, flags, exit codes, and behavioral contracts for the Go CLI.

---

## 1. Global Commands & Syntax

```text
h0wzy-mcp [command] [flags]
```

When run with no arguments in an interactive terminal (TTY), `h0wzy-mcp` launches the **Interactive TUI Mode**.

---

## 2. Command Specifications

### `h0wzy-mcp` (Default Interactive Mode)
- **Description**: Scans the workstation for supported AI developer CLIs (`claude`, `codex`, `agy`), displays detection results, prompts the user via a checklist to select desired bridges, prompts for scope (`user` or `project`), and applies configurations.
- **Flags**:
  - `--non-interactive`: Abort if not in a TTY instead of prompting.
- **Exit Codes**:
  - `0`: Success (bridges applied or exit without changes).
  - `1`: Unexpected failure during scan or configuration write.

---

### `h0wzy-mcp doctor`
- **Description**: Probes local CLI installations, verifies binary paths, checks authentication status, and tests communication with installed MCP bridges.
- **Flags**:
  - `--json`: Output diagnostic report as JSON.
- **Exit Codes**:
  - `0`: All detected tools and bridges are healthy.
  - `1`: One or more tools failed health checks or are missing required authentication.

---

### `h0wzy-mcp list`
- **Description**: Lists all available bridges and shows which ones are currently installed in the current environment or global scope.
- **Flags**:
  - `--scope <user|project>`: Filter by scope (default: both).
  - `--json`: Output as JSON list.
- **Exit Codes**:
  - `0`: Success.

---

### `h0wzy-mcp install [bridge-name]`
- **Description**: Headless installation of one or all bridges.
- **Arguments**:
  - `[bridge-name]`: Name of bridge (e.g. `claude-antigravity`, `claude-codex`, `codex-antigravity`).
- **Flags**:
  - `--all`: Install all bridges supported by the currently detected CLIs.
  - `--scope <user|project>`: Scope to register within (default: `user`).
- **Exit Codes**:
  - `0`: Successfully registered.
  - `1`: Specified bridge not supported or target CLI not found.

---

### `h0wzy-mcp remove <bridge-name>`
- **Description**: Unregisters a bridge from the specified scope.
- **Flags**:
  - `--scope <user|project>`: Scope to remove from (default: `user`).
- **Exit Codes**:
  - `0`: Successfully removed.
  - `1`: Bridge not found in configuration.
