# MCP Tool Contract: `configure_antigravity` & `configure_codex`

**Feature**: `specs/005-agent-model-effort-control` | **Date**: 2026-10-05

Each MCP server (`antigravity`, `codex`) exposes a dedicated configuration tool that lets host agents like Claude Code read current settings, switch pre-configured tiers, or set custom model/reasoning effort combinations.

---

## 1. Tool Identifiers & Schemas

| Server | Tool Name | Scope |
|---|---|---|
| `antigravity` | `configure_antigravity` | Process/session-scoped configuration for all Antigravity tools |
| `codex` | `configure_codex` | Process/session-scoped configuration for all Codex tools |

### Input Schema (Shared Structure)

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": ["get", "set", "reset", "list"],
      "default": "get",
      "description": "Action to perform. 'get' inspects current settings; 'set' applies updates; 'reset' returns to startup defaults; 'list' shows catalog and available tiers."
    },
    "tier": {
      "type": "string",
      "enum": ["light", "balanced", "deep"],
      "description": "Preset tier. 'light' (quick lookups/summaries), 'balanced' (routine reviews/plans), 'deep' (heavy refactors/architecture/security)."
    },
    "model": {
      "type": "string",
      "description": "Target model identifier, family, or display name."
    },
    "effort": {
      "type": "string",
      "description": "Target reasoning effort level."
    }
  }
}
```

*Note on Effort Enum*:
- Antigravity accepts: `["low", "medium", "high", "xhigh", "max"]`
- Codex accepts: `["low", "medium", "high", "xhigh", "max", "ultra"]`

---

## 2. Actions & Semantics

### `get` (Default)
Returns current effective model, effort, tier (if active), startup defaults, ceiling status, and valid options without modifying session state.
- If called with `{}` or `{ "action": "get" }`, it executes `get`.

### `set`
Modifies the session defaults for all subsequent tool calls to this agent.
- Accepts `tier`, `model`, `effort`, or combinations.
- If `tier` is provided alongside explicit `model` or `effort`, the explicit values take precedence for those fields.
- Fails atomically if validation fails (e.g. unknown model name when live catalog is ready, invalid effort string).
- Applies ceiling clamping if configured (`<PROVIDER>_MAX_EFFORT`, `<PROVIDER>_MAX_TIER`).

### `reset`
Restores the session to the initial startup values (derived from process environment variables `AGY_MODEL`, `CODEX_MODEL`, `AGY_EFFORT`, `CODEX_EFFORT`, or built-in defaults).

### `list`
Returns the available models catalog, supported effort levels, and built-in tier definitions with guidance notes.

---

## 3. Output Formats

### 3.1. Successful Response Format
All actions return a structured response comprising a human-readable header followed by formatted JSON data:

```text
⚙️ [Google Antigravity Configuration Updated]
Previous: gemini-3.8-flash (effort: high, source: startup)
Active:   gemini-3.8-flash (effort: high, tier: deep, source: tier:deep)

{
  "provider": "antigravity",
  "status": "ok",
  "active": {
    "model": "gemini-3.8-flash",
    "effort": "high",
    "tier": "deep",
    "source": "tier:deep"
  },
  "previous": {
    "model": "gemini-3.8-flash",
    "effort": "high",
    "source": "startup"
  },
  "ceiling": {
    "maxEffort": null,
    "maxTier": null
  },
  "warnings": []
}
```

### 3.2. Clamping & Mapping Warnings
When a requested effort or model is mapped to a supported equivalent or clamped by a ceiling, warnings are included in both the text and JSON:

```text
⚙️ [OpenAI Codex Configuration Updated (Clamped)]
⚠️ Effort 'max' clamped to ceiling 'high' (CODEX_MAX_EFFORT)
Active: gpt-6-astra (effort: high, source: explicit)

{
  "provider": "codex",
  "status": "ok",
  "active": {
    "model": "gpt-6-astra",
    "effort": "high",
    "source": "explicit"
  },
  "warnings": [
    "Effort 'max' clamped to ceiling 'high' by CODEX_MAX_EFFORT"
  ]
}
```

### 3.3. Task Tool Execution Footer
Every task tool (`ask_*`, `review_*`, `brainstorm_*`, `plan_*`, `delegate_*`) appends a standardized metadata footer as the final line of output:

```text
[antigravity · model=gemini-3.8-flash · effort=low · source=tier:light]
```
Or for Codex with a per-call override:
```text
[codex · model=gpt-6-astra · effort=max · source=override]
```

### 3.4. Validation Error Format
If validation fails, `isError: true` is returned with guidance:

```text
❌ [Invalid Model Selection]
Model 'gpt-nonexistent' not recognized for OpenAI Codex.

Valid alternatives:
  - gpt-6-astra (Frontier intelligence, deep)
  - gpt-6-sol (Workhorse model, balanced)
  - gpt-6-luna (Fast and affordable, light)

To view all available models, run configure_codex with action 'list'.
```

---

## 4. Concurrency & Lifetime Guarantees

1. **Isolation**: Modifying Antigravity does not alter Codex settings and vice versa.
2. **Immutability of In-Flight Calls**: Calls currently executing in the background or awaiting completion retain the `CallSnapshot` captured when the call began.
3. **Session Volatility**: Terminating the MCP server process discards session configuration, ensuring zero leakage across distinct client launches.
