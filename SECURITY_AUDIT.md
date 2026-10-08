# Security Audit & Codebase Integrity Report

**Repository**: [H0wZy/mcp](https://github.com/H0wZy/mcp)  
**Date**: September 19, 2026  
**Auditor**: Antigravity Pair Programmer  
**Status**: ✅ All Audits Passed — Hardening & Sanitization Implemented

---

## 1. Executive Summary

A comprehensive, double-check security audit and code review was conducted across the entire codebase (`H0wZy/mcp`), encompassing:
1. **Repository Secret & Sensitive Data Audit**: Scanning working tree, commit history, configs, workflows, and specifications for leaked credentials, private tokens, API keys, and personal identifiers.
2. **Authentication Verification & Token Leakage Inspection**: Validating whether CLIs, health checks, or provider error messages leak access tokens, auth headers, or session cookies to host agents (Claude Code, Antigravity, Codex).
3. **Execution Safety & Process Integrity**: Reviewing child process spawners, shell invocations, and prebuilt binary downloaders for injection vectors or race conditions.
4. **Filesystem Permission Hardening**: Hardening configuration read/write operations across Unix and Windows environments.

---

## 2. Sensitive Data & Remote Secret Audit

### 2.1 Pattern Search Results
Scanned across all repository files for potential secret indicators:
- **API Keys & Tokens**: `sk-...`, `AIza...`, `ghp_...`, `npm_...`, `Bearer ...`, `xoxb-...`
- **Keywords**: `password`, `secret`, `api_key`, `apikey`, `private_key`
- **User Information**: `h0wzy`, personal filesystem paths, private environment variables

| Check | Result | Findings / Details |
| :--- | :---: | :--- |
| **API Keys / Secrets in Code** | 🟢 Clean | Zero private API keys, client secrets, or private certificates detected. |
| **User Identifiers / Paths** | 🟢 Clean | No hardcoded personal paths (e.g. `C:\Users\h0wzy\...`). All paths dynamically resolve via `os.UserHomeDir()` or `homedir()`. |
| **Public Author Metadata** | 🟢 Verified | `Marcos (H0wZy) <h0wzymarcos@gmail.com>` is present in `package.json` and `LICENSE` as standard public open-source author metadata. |
| **Environment Files (`.env`)** | 🟢 Ignored | `.gitignore` explicitly ignores `.env`, `.env.local`, `*.pem`, `vendor/`, `node_modules/`, `dist/`, and compiled binaries. |

---

## 3. Deep-Dive: Authentication Check & Error Output Leakage

### 3.1 The Potential Leakage Vector
When an external CLI tool (`agy` or `codex`) executes or undergoes health checks:
- If a command fails due to invalid credentials, session expiration, or quota exhaustion, external CLIs occasionally output the failed request dump, headers, or environment variables to `stderr`.
- Previously, `formatResilientResponse` in `shared/errors.js` and `CheckHealth` in `cli/detector/health.go` relayed raw output strings directly into tool outputs or diagnostics.

### 3.2 Implemented Fixes & Protections

#### A. Node.js MCP Server Output Sanitizer (`shared/errors.js`)
We implemented `sanitizeOutput(text)` that proactively redacts sensitive tokens before any error message is delivered to the host MCP agent:
- **OpenAI Keys**: Redacts `sk-[a-zA-Z0-9_-]{20,}` → `[REDACTED_OPENAI_KEY]`
- **Google / Gemini Keys**: Redacts `AIza[0-9A-Za-z_-]{30,}` → `[REDACTED_GOOGLE_KEY]`
- **GitHub Tokens**: Redacts `gh[pousr]_[a-zA-Z0-9]{36}` → `[REDACTED_GITHUB_TOKEN]`
- **NPM Tokens**: Redacts `npm_[a-zA-Z0-9]{36}` → `[REDACTED_NPM_TOKEN]`
- **Bearer Tokens**: Redacts `Bearer <token>` → `Bearer [REDACTED_BEARER_TOKEN]`
- **Parameter Secrets**: Redacts `(?:password|secret|token|api_key|auth)=<value>` → `[REDACTED]`

#### B. Go CLI Diagnostics Sanitizer (`cli/detector/health.go`)
We introduced `SanitizeHealthMessage(msg)`:
- Strips any tokens, API keys, or authorization headers from `tool --version` failure messages.
- Truncates verbose multi-line crash dumps to a clean single line (max 120 runes) so stack traces never spill into terminal output or `hmcp doctor --json`.

---

## 4. Additional Hardening & Structural Improvements

### 4.1 Insecure Config File Permissions (`cli/config/`)
- **Before**: `os.WriteFile` wrote `.claude.json`, `.codex/config.toml`, and `.gemini/config/mcp_config.json` with mode `0644` (world-readable on Unix/POSIX).
- **Hardening**: Updated to mode `0600` (read/write by owner only) and parent directories to `0700`. This prevents other local users on shared systems from reading bridge configurations and associated command arguments.

### 4.2 Atomic Binary Downloader (`npm/bin/h0wzy-mcp.js`)
- **Before**: Downloaded prebuilt binaries directly to the final cache path. An interrupted download left a corrupt zero-byte binary that caused repeated crashes on subsequent runs.
- **Hardening**: Downloads are now streamed to a unique temporary file (`${cachedBinary}.tmp-${Date.now()}`) and atomically renamed (`renameSync`) upon verification of HTTP 200 and complete stream flush.

### 4.3 GitHub Actions npm Publish Workflow (`.github/workflows/publish-packages.yml`)
- **Before**: `publish-packages.yml` lacked `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` and had `continue-on-error: true` on all publish steps, silently passing even when npm publish failed with 404/401.
- **Hardening**: Added `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` and removed `continue-on-error: true`, ensuring publishing failures are surfaced immediately.

### 4.4 v1.0.6 hardening (Phase 0 review, spec 006 and the real-CLI checks)
- **Least privilege for read-only tools**:
  - Codex read tools run with `sandbox_mode=read-only` and `approval_policy=never`.
  - Antigravity read tools run without `--dangerously-skip-permissions`, so print mode soft-denies edits and unapproved commands. **Known gap**: agy 1.3.1 runs MCP tools without a prompt in every mode (read-only, `--mode accept-edits`, a custom `--agent` with a `tools` list), and loads every server in its config. Any Antigravity bridge call or agy teammate can therefore reach the user's agy MCP servers (a shop, a paid generator, a 3D app). There is no per-call switch; the tool descriptions and the README warn about it, and the fix is to keep such servers out of agy's config.
  - Claude read tools start with only `Read`, `Grep` and `Glob`.
  - Context `paths` are no longer passed to Codex as `--add-dir`, which would make those folders writable.
- **Process lifecycle** (`shared/executor.js`, `shared/server.js`):
  - Timeouts and MCP cancellation kill the agent's whole process tree.
  - Output is capped.
  - Closing the server stops its agents.
- **Windows command lines**:
  - npm and pnpm `.cmd` shims run as `node <script>`, without `cmd.exe`.
  - Any other `.cmd` gets quoted arguments, and values `cmd.exe` would expand (`"`, `%`, `!`, line breaks) are refused.
- **Loop guard** (`shared/chain-guard.js`, spec 006): bridge chains are capped by depth, revisits, call budget and deadline before anything is spawned. The guard fails closed when a nested call can't be traced. Its state files (`~/.h0wzy-mcp/`) are written with mode `0600`, and the opt-in log never contains prompt text.
- **Inherited session variables**: the Claude bridge drops a Claude Code ancestor's session variables, including `CLAUDE_CODE_MESSAGING_TOKEN` and `CLAUDE_CODE_SESSION_ATTENDED`, before it starts `claude`.
- **MCP scope of nested agents** (`shared/mcp-scope.js`, spec 006 FR-026): a nested Claude Code or Codex loads only the H0wZy/mcp agent bridges, never the user's other servers (opt-in with `H0WZY_MCP_USER_SERVERS=1`), so a bridge call can't reach the tools of unrelated servers.
  - The bridges passed to Claude Code come only from the user's own `~/.claude.json` (user scope, and the local scope of the working folder). A project's `.mcp.json` is never read: Claude Code asks before it starts a project server, and passing one through `--mcp-config` would skip that approval for whatever a cloned repository calls "codex".
  - Their definitions travel in a temp file (`h0wzy-mcp-*/mcp.json` in a `mkdtemp` folder, mode `0700`/`0600`, removed when the call ends), not on the command line, where other local processes could read any env values they carry. On Windows the mode bits do nothing: privacy comes from the ACL of `%TEMP%`, which is per-user by default (`%LOCALAPPDATA%\Temp`) but not if `TEMP`/`TMP` point to a shared folder. A bridge killed mid-call (SIGKILL, TerminateProcess) leaves the file behind.
  - Only the read-only bridge tools (`ask_*`, `review_*`, `brainstorm_*`, `plan_*`) are pre-allowed (`--allowedTools`). A read-only call (`ask_*`, `review_*`, …, and read-only teammates) also denies `delegate_*` and `configure_*` of every mesh bridge: Claude Code gets `--disallowedTools` (deny rules hold in every permission mode, and the nested run otherwise inherits the user's; with `defaultMode: "auto"` a read-only `ask_claude` was seen starting `delegate_codex`, which wrote a file), Codex gets `-c mcp_servers.<name>.disabled_tools=[…]`. An editing call (`delegate_*`) may use them only under the user's own permission rules.
  - Codex scoping is best effort: a server whose name `-c` can't address (a dot in a quoted name), dotted keys under `[mcp_servers]`, or project-layer Codex config stay as Codex loads them. The runtime guard (L2) still bounds bridge calls.
- **Antigravity logs** (`shared/agy.js`): a bridge run gets a private `--log-file` in a fresh temp folder; a team turn writes it next to the team's results in `~/.h0wzy-mcp/teams/…` and deletes it after the turn. Only tokens that look like server names (`[A-Za-z0-9_.-]`) are read from the "still connecting" line, and the file is removed when the call ends (the log holds the account e-mail and permission lists). Team errors (provider stderr, these hints) pass through `sanitizeOutput` before they are stored or shown to the lead.
- **Config writers** (`cli/config/`):
  - A file that fails to parse is refused instead of overwritten.
  - Writes are atomic.
  - TOML sections are edited by lines (RE2 has no lookahead).

---

## 5. Summary Table of Files Hardened

| File | Type | Hardening Description |
| :--- | :--- | :--- |
| [`shared/errors.js`](file:///c:/Users/h0wzy/projects/mcp/shared/errors.js) | Security / Privacy | Added regex-based token & credential redaction (`sanitizeOutput`) to prevent leaking auth headers in resilient responses. |
| [`cli/detector/health.go`](file:///c:/Users/h0wzy/projects/mcp/cli/detector/health.go) | Security / Privacy | Added `SanitizeHealthMessage` to scrub tokens and truncate error output in `doctor` diagnostics. |
| [`cli/config/claude.go`](file:///c:/Users/h0wzy/projects/mcp/cli/config/claude.go) | Security / POSIX | Changed permissions from `0644` / `0755` to `0600` / `0700` (owner only). |
| [`cli/config/codex.go`](file:///c:/Users/h0wzy/projects/mcp/cli/config/codex.go) | Security / POSIX | Changed permissions from `0644` / `0755` to `0600` / `0700` (owner only). |
| [`cli/config/antigravity.go`](file:///c:/Users/h0wzy/projects/mcp/cli/config/antigravity.go) | Security / POSIX | Changed permissions from `0644` / `0755` to `0600` / `0700` (owner only). |
| [`npm/bin/h0wzy-mcp.js`](file:///c:/Users/h0wzy/projects/mcp/npm/bin/h0wzy-mcp.js) | Resilience / DoS | Implemented atomic download via temporary file and atomic rename. Removed redundant `shell` option. |
| [`.github/workflows/publish-packages.yml`](file:///c:/Users/h0wzy/projects/mcp/.github/workflows/publish-packages.yml) | CI / CD | Added `NODE_AUTH_TOKEN` environment variable and removed silent `continue-on-error`. |
| [`test/resilience.test.js`](file:///c:/Users/h0wzy/projects/mcp/test/resilience.test.js) | Test Suite | Added automated test verifying redaction of OpenAI, Google, GitHub, NPM, and Bearer tokens. |
| [`cli/detector/detector_test.go`](file:///c:/Users/h0wzy/projects/mcp/cli/detector/detector_test.go) | Test Suite | Added unit test verifying Go health check message sanitization. |
