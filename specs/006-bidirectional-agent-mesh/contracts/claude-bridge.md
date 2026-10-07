# Contract: Claude Code Bridge (`@h0wzy/mcp-server-claude`)

Server name `claude`, version in lockstep (1.0.6). The binary is found with `resolveBinary('claude', 'CLAUDE_CLI_PATH')`.

## Tools

Same family and parameter names as the Codex and Antigravity bridges.

| Tool | Required | Optional | Writes files | Annotations |
|---|---|---|---|---|
| `configure_claude` | `action` (`get`\|`set`\|`reset`\|`list`) | `tier`, `model`, `effort` | no | readOnly false, destructive false, idempotent true, openWorld false |
| `ask_claude` | `prompt` | `paths`, `model`, `effort` | no | readOnly true, openWorld true |
| `review_claude` | `prompt` | `paths`, `model`, `effort` | no | readOnly true, openWorld true |
| `brainstorm_claude` | `prompt` | `paths`, `model`, `effort` | no | readOnly true, openWorld true |
| `plan_claude` | `prompt` | `paths`, `model`, `effort` | no | readOnly true, openWorld true |
| `delegate_claude` | `prompt`, `cwd` | `paths`, `model`, `effort`, `timeout_minutes` (1–60, default 30) | inside `cwd` + `paths` | readOnly false, destructive true, openWorld true |

`effort` enum: `low|medium|high|xhigh|max`. Every tool except `configure_claude` is marked `spawnsAgent: true` and goes through the loop guard.

## Command lines (exact order, asserted in `test/argv.test.js`)

The prompt is written to stdin. `<m>` is the resolved model (an alias or a full id).

Read-only tools:

```
claude -p --output-format json --model <m> [--effort <e>] --permission-prompts none
       --tools Read,Grep,Glob --no-session-persistence
       [--add-dir <dir>]...                 # one per context folder (file → its folder)
       [--max-turns <n>] [--max-budget-usd <x>]
       [--strict-mcp-config --disable-slash-commands]   # only at max depth (L1)
```

`delegate_claude` (spawn cwd = validated `cwd`):

```
claude -p --output-format json --model <m> [--effort <e>] --permission-prompts none
       --permission-mode <acceptEdits|auto|dontAsk>
       [--add-dir <dir>]...                 # extra folders from `paths`
       [--max-turns <n>] [--max-budget-usd <x>]
       [--strict-mcp-config --disable-slash-commands]
```

Timeouts:
- Read-only tools: min(10 min, time left in the chain).
- Delegate: min(`timeout_minutes`, time left in the chain).

## Prompt prefixes

`review_`, `brainstorm_` and `plan_` use the same prefixes as the other bridges. The L3 chain notice comes first, then `Context files/folders to read and consider in full:` (if any `paths`), then the prefix and the prompt.

## Environment knobs (developer-set)

| Variable | Effect |
|---|---|
| `CLAUDE_CLI_PATH` | Path to the `claude` executable |
| `CLAUDE_BRIDGE_MODEL`, `CLAUDE_BRIDGE_EFFORT` | Startup model / effort (default `opus` / `medium`) |
| `CLAUDE_BRIDGE_MAX_TIER`, `CLAUDE_BRIDGE_MAX_EFFORT`, `CLAUDE_BRIDGE_TIER_LIGHT|BALANCED|DEEP` | Spec 005 ceilings and tier overrides |
| `CLAUDE_BRIDGE_MAX_TURNS` | Adds `--max-turns` to every call |
| `CLAUDE_BRIDGE_MAX_BUDGET_USD` | Adds `--max-budget-usd` to every call |
| `CLAUDE_BRIDGE_DELEGATE_PERMISSION_MODE` | `acceptEdits` (default), `auto` or `dontAsk`. Any other value is ignored, with a warning |

The child's environment drops the session variables a Claude Code ancestor exports (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_MESSAGING_*`, `CLAUDE_EFFORT`, `CLAUDE_PID`). A nested `claude -p` must not attach to the outer session, and `CLAUDE_EFFORT` must not compete with `--effort`.

## Reply

- **Success**: the JSON `result`, then the execution footer `[claude · model=<m> · effort=<e|n/a> · source=<s> · cost=$<x> · turns=<n>]` (cost and turns only when reported), then the chain trace line.
- **`is_error` true or a non-zero exit**: `formatResilientResponse` (auth / rate limit / generic). An `error_max_turns` or `error_max_budget_usd` subtype adds `Stopped: the <turn|budget> cap set by CLAUDE_BRIDGE_MAX_* was reached.`
- **Binary missing**: install guidance (`npm install -g @anthropic-ai/claude-code` or the native installer, or set `CLAUDE_CLI_PATH`).
