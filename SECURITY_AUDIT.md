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
