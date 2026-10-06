# Quickstart & Validation Guide: Agent Model & Reasoning-Effort Control

**Feature**: `specs/005-agent-model-effort-control` | **Date**: 2026-10-05

This guide provides runnable scenarios to validate that Claude Code can discover, query, configure, and override models and reasoning effort across Antigravity and Codex MCP servers.

---

## Prerequisites

- Node.js >= 20.0.0
- Google Antigravity CLI (`agy`) and OpenAI Codex CLI (`codex`) installed or mocked in PATH.
- Repository root: `C:\Users\h0wzy\projects\mcp`

---

## Scenario 1: Verify 6-Tool MCP Parity on Both Servers

Verify that both `antigravity` and `codex` stdio servers expose `configure_*` alongside the 5 existing task tools (`ask`, `review`, `brainstorm`, `plan`, `delegate`).

### Command
```bash
node --test test/stdio-verification.test.js
```

### Expected Output
- Antigravity reports 6 tools: `configure_antigravity`, `ask_antigravity`, `review_antigravity`, `brainstorm_antigravity`, `plan_antigravity`, `delegate_antigravity`.
- Codex reports 6 tools: `configure_codex`, `ask_codex`, `review_codex`, `brainstorm_codex`, `plan_codex`, `delegate_codex`.
- All tests pass with exit code 0.

---

## Scenario 2: Query Current Configuration (`get` / `list`)

Simulate Claude Code inspecting active settings before making a delegation decision.

### Input JSON-RPC (stdio to `servers/antigravity/bin/cli.js`)
```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"configure_antigravity","arguments":{"action":"get"}}}
```

### Expected Result
- Returns `status: "ok"`
- `active.model`: `gemini-3.8-flash` (or current `AGY_MODEL`)
- `active.effort`: `high`
- `active.source`: `startup`
- Lists available tiers (`light`, `balanced`, `deep`) with tier descriptions.

---

## Scenario 3: Switch Tier to `deep` for Heavy Task

Simulate Claude Code encountering a difficult architectural refactoring task and escalating Antigravity to `deep`.

### Step 3A: Set Tier
```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"configure_antigravity","arguments":{"action":"set","tier":"deep"}}}
```
**Expected**:
- Confirmation header indicating switch to `deep`.
- `active.model`: `gemini-3.8-flash`
- `active.effort`: `high`
- `active.source`: `tier:deep`

### Step 3B: Execute Task Without Per-Call Model
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ask_antigravity","arguments":{"prompt":"Evaluate race conditions in auth cache."}}}
```
**Expected**:
- Tool output ends with footer:
  `[antigravity · model=gemini-3.8-flash · effort=high · source=tier:deep]`

---

## Scenario 4: Per-Call Override vs. Session State

Simulate Claude Code needing a one-off quick check while the session remains configured for `deep`.

### Call with Override
```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"ask_antigravity","arguments":{"prompt":"Syntax check","model":"gemini-3.8-flash","effort":"low"}}}
```
**Expected**:
- Footer reflects override:
  `[antigravity · model=gemini-3.8-flash · effort=low · source=override]`

### Verify Session Unchanged
```json
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"configure_antigravity","arguments":{"action":"get"}}}
```
**Expected**:
- `active.tier` is still `deep` (`gemini-3.8-flash`, `high`).

---

## Scenario 5: Reset Session Defaults

Claude Code resets configuration back to startup defaults once the complex workflow is done.

### Input
```json
{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"configure_antigravity","arguments":{"action":"reset"}}}
```
**Expected**:
- `active.model` restored to startup default (`gemini-3.8-flash`).
- `active.effort` restored to startup default (`high`).
- `active.source`: `startup`.

---

## Scenario 6: Developer Guardrails (Ceiling Clamping)

Simulate running with an environment ceiling: `CODEX_MAX_EFFORT=medium`.

### Step 6A: Start server with ceiling
```bash
CODEX_MAX_EFFORT=medium node servers/codex/bin/cli.js
```

### Step 6B: Claude Code requests max effort
```json
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"configure_codex","arguments":{"action":"set","effort":"max"}}}
```
**Expected**:
- Warning message returned: `Effort 'max' clamped to ceiling 'medium' by CODEX_MAX_EFFORT`.
- `active.effort` is `medium`.

---

## Scenario 7: Validation Failure & Graceful Degradation

Request an invalid or misspelled model name while the live catalog is active.

### Input
```json
{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"configure_codex","arguments":{"action":"set","model":"gpt-6-astrax"}}}
```
**Expected**:
- `isError: true`
- Message: `Model 'gpt-6-astrax' not recognized for OpenAI Codex.`
- Suggests `gpt-6-astra`.
- Previous session settings remain completely intact and unaffected.
