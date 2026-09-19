# Quickstart Validation Guide: Multi-Agent MCP Hub & Go CLI

This guide outlines runnable scenarios to validate the multi-agent hub and Go CLI locally.

---

## Prerequisites

- **Node.js**: `v20.0.0+` (`node -v`)
- **Go**: `1.24+` (`go version`)
- **Git**: Installed and configured
- **Local CLIs** (one or more):
  - Claude Code: `claude`
  - OpenAI Codex CLI: `codex`
  - Google Antigravity: `agy`

---

## Scenario 1: Verify Environment with `h0wzy-mcp doctor`

1. Navigate to the monorepo root:
   ```bash
   cd c:\Users\h0wzy\projects\mcp
   ```
2. Run the diagnostic doctor:
   ```bash
   go run ./cli doctor
   ```
3. **Expected Outcome**:
   - A formatted table or status list showing:
     - `Claude Code`: Detected path + Version
     - `OpenAI Codex CLI`: Detected path + Version
     - `Google Antigravity`: Detected path + Status
   - Zero missing-binary errors on Windows when `agy.exe` and `codex.cmd` exist.

---

## Scenario 2: Interactive TUI Configuration

1. Launch the interactive CLI:
   ```bash
   go run ./cli
   ```
2. **Steps in TUI**:
   - The CLI displays discovered CLIs.
   - Select desired bridges (e.g. `[x] Claude Code -> Google Antigravity`, `[x] Claude Code -> OpenAI Codex`).
   - Select scope: `Global (User)` or `Current Project (Local)`.
   - Confirm application.
3. **Expected Outcome**:
   - Configuration files (`~/.claude.json`, `~/.codex/config.toml`, or `.gemini/config/mcp_config.json`) are updated.
   - Server commands point directly to local Node execution paths (`node <path>`).
   - Existing unrelated configurations are preserved untouched.

---

## Scenario 3: Verify MCP Stdio JSON-RPC Communication

1. Test Antigravity Server via stdio:
   ```bash
   node -e "const cp = require('child_process'); const p = cp.spawn('node', ['./servers/antigravity/bin/cli.js']); p.stdout.on('data', d => console.log('MCP OUT:', d.toString())); p.stdin.write(JSON.stringify({jsonrpc:'2.0', id: 1, method: 'tools/list'}) + '\n'); setTimeout(() => p.kill(), 1000);"
   ```
2. **Expected Outcome**:
   - Server returns valid JSON-RPC 2.0 response advertising `ask_antigravity` tool.
   - Exit code `0`.

---

## Scenario 4: Cross-Model Review in Claude Code

1. Start Claude Code in a terminal:
   ```bash
   claude
   ```
2. Type `/mcp` to confirm `antigravity` and `codex` tools are loaded.
3. Request a second opinion:
   ```text
   Use ask_antigravity to review our error handling strategy in shared/errors.js.
   ```
4. **Expected Outcome**:
   - Claude invokes `ask_antigravity`.
   - Google Antigravity (Gemini 3.1 Pro) evaluates the file and returns an independent review.
   - Claude displays the peer review seamlessly.
