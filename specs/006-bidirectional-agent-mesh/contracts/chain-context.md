# Contract: Chain Context Between Bridges

Every bridge (codex, antigravity, claude, and later team) follows this contract. Implemented once in `shared/chain-guard.js`.

## 1. Environment passed to a started agent

| Variable | Example | Meaning |
|---|---|---|
| `H0WZY_MCP_RUN_ID` | `a1b2c3d4` | Chain id (8 hex) |
| `H0WZY_MCP_CHAIN` | `claude>codex` | Agents so far, host first, the started agent last |
| `H0WZY_MCP_DEPTH` | `1` | Depth of the started agent |
| `H0WZY_MCP_DEADLINE` | `1791345600000` | Epoch ms. No hop may run past it |

The started agent passes these on to the bridges it runs (Claude Code passes its env; Codex needs `env_vars`, see installer contract). A bridge that receives them treats the last name in the chain as its host.

Invalid values (non-numeric depth, a chain that doesn't match `^[a-z][a-z0-9-]{0,31}(>[a-z][a-z0-9-]{0,31}){0,15}$`, a deadline that isn't a number) are treated as **nesting-unknown**: the call is refused (fail closed).

## 2. Bridge launch arguments

`node servers/<x>/bin/cli.js --host <name>` or `npx -y @h0wzy/mcp-server-<x> --host <name>`. `<name>` ∈ `claude|codex|antigravity`. `H0WZY_MCP_HOST` is the env equivalent; the argument wins.

## 3. Developer policy (env on the bridge server)

`H0WZY_MCP_MAX_DEPTH` (2, cap 4), `H0WZY_MCP_MAX_CALLS` (8, cap 32), `H0WZY_MCP_ALLOW_REVISIT` (`0`), `H0WZY_MCP_DEADLINE_MINUTES` (60, cap 240), `H0WZY_MCP_CHAIN_LOG` (`0`), `H0WZY_MCP_STATE_DIR` (`~/.h0wzy-mcp`).

## 4. Decision order (before anything is spawned)

1. Resolve the chain: valid env context, then the registry plus ancestry, then a new chain.
2. `deadline` passed → refuse `deadline`.
3. Target already in the chain and revisits not allowed → refuse `cycle`.
4. `depth + 1 > maxDepth` → refuse `depth`.
5. Claim a budget slot. None left → refuse `budget`.
6. Run with `timeoutMs = min(tool limit, deadline − now)`, `childEnv`, the L1 flags if `depth + 1 == maxDepth`, and the L3 notice.

## 5. Text formats

**Trace line.** It comes last in every bridge reply, including errors and refusals:

```
[chain claude→codex · depth 1/2 · calls 1/8 · run a1b2c3d4]
```

**L3 notice.** It is the first paragraph of the delegated prompt:

```
[H0wZy/mcp chain] You are codex, called by claude (chain claude → codex, depth 1 of 2, bridge call 1 of 8). Do this task yourself. Do not call back claude or any agent already in the chain; other bridge calls are limited and may be refused.
```

At max depth, the last sentence is replaced by: `You are at the maximum depth: bridge tools are disabled or will be refused.`

**Refusal.** The reply has `isError: true` and this text:

```
⛔ [Loop guard: <rule>] Not started: <reason>.
💡 Finish this task yourself without delegating to another agent.

[chain claude→codex→antigravity · depth 2/2 · calls 3/8 · run a1b2c3d4]
```

Reasons:
- `depth`: `antigravity is at depth 2 of 2, the maximum, so it can't start claude`.
- `cycle`: `claude is already in the chain claude → codex (set H0WZY_MCP_ALLOW_REVISIT=1 to allow)`.
- `budget`: `the chain already used its 8 bridge calls`.
- `deadline`: `the chain's 60-minute deadline has passed`.
- `nesting-unknown`: `this bridge looks nested inside another agent call, but the chain context is missing or unreadable`.

## 6. Chain log (opt-in)

When `H0WZY_MCP_CHAIN_LOG=1`, one JSON object per line is appended to `<stateDir>/chain.log`:

```json
{"ts":"2026-10-07T04:00:00.000Z","run":"a1b2c3d4","caller":"claude","agent":"codex","depth":1,"tool":"ask_codex","outcome":"ran","ms":8123}
```

The log never contains prompt text, paths, file contents or output.
