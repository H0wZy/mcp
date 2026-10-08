# Data Model: Bidirectional Agent Mesh & Loop Guard

All state is small JSON files under the guard state dir (`~/.h0wzy-mcp/`, override `H0WZY_MCP_STATE_DIR`) or env vars passed to child agents. Nothing contains prompt text.

## Policy

The effective loop-guard limits.

| Field | Type | Default | Hard cap | Source |
|---|---|---|---|---|
| `maxDepth` | int ≥ 1 | 2 | 4 | `H0WZY_MCP_MAX_DEPTH` |
| `maxCalls` | int ≥ 1 | 8 | 32 | `H0WZY_MCP_MAX_CALLS` |
| `allowRevisit` | bool | false | n/a | `H0WZY_MCP_ALLOW_REVISIT` (`1`/`true`) |
| `deadlineMinutes` | int ≥ 1 | 60 | 240 | `H0WZY_MCP_DEADLINE_MINUTES` |

Validation:
- A value that isn't a number, or is below 1, falls back to the default.
- Values above the cap are clamped. The clamp is reported as a `⚠️` line right after the trace line.
- A nested bridge uses `min(chain policy, own policy)` field by field. `allowRevisit` is true only if both say so.

## Chain

| Field | Type | Notes |
|---|---|---|
| `runId` | string, 8 hex chars | Random, made at depth 0 |
| `agents` | string[] | Ordered, host first, e.g. `["claude", "codex"]`. Names: `claude`, `codex`, `antigravity`, `team`, or the host label |
| `depth` | int ≥ 0 | Depth of the current host (= `agents.length - 1`) |
| `deadline` | epoch ms | Fixed at depth 0: now + `deadlineMinutes` |
| `policy` | Policy | Stored once in `runs/<runId>/policy.json` |

Identity: `runId`. Lifetime: until the deadline. Run directories older than 24 h are swept when a new chain starts.

## Hop

One bridge call, created by `beginHop()`.

| Field | Type | Notes |
|---|---|---|
| `target` | string | The agent this bridge starts (`codex`, …) |
| `targetDepth` | int | `chain.depth + 1` |
| `slot` | int | Budget slot claimed (1…maxCalls) |
| `timeoutMs` | int | min(tool limit, deadline − now) |
| `atMaxDepth` | bool | `targetDepth === policy.maxDepth` → apply L1 |
| `childEnv` | object | The chain context for the child (see contracts/chain-context.md) |
| `outcome` | enum | `ran` · `failed` · `timed-out` · `cancelled` · `refused` |
| `durationMs` | int | Set on finish |

States: `checking → refused` (no slot is claimed when a rule fails before budget) or `checking → running → ran|failed|timed-out|cancelled`.

## AgentRecord (`agents/<pid>.json`)

| Field | Type | Notes |
|---|---|---|
| `pid` | int | Pid of the process `executeProcess` spawned |
| `runId`, `agents`, `depth`, `deadline` | as in Chain | `agents` includes the target, and `depth` is the target depth |
| `startedAt` | epoch ms | |

Written right after spawn, deleted when the child exits. A record is stale when the pid is not alive or `now > deadline + 10 min`. Stale records are ignored and deleted.

## Refusal

| Field | Type | Notes |
|---|---|---|
| `rule` | enum | `depth` · `cycle` · `budget` · `deadline` · `nesting-unknown` |
| `chain` | string[] | Including the refused target |
| `text` | string | User-facing message, ends with recovery advice and the trace line |

## BridgeEdge (Go, `hmcp doctor`)

| Field | Type | Notes |
|---|---|---|
| `host` | `claude` \| `codex` \| `antigravity` | Owner of the config file |
| `target` | `claude` \| `codex` \| `antigravity` \| `team` | From the launch args (`@h0wzy/mcp-server-<x>` or `servers/<x>/bin/cli.js`) |
| `name` | string | Server key in the host config |
| `scope` | string | `user` / `project` (Claude only) |
| `guardReady` | bool | Codex: `env_vars` lists the chain vars. Others: true |

Cycles are simple directed cycles over the host → target graph. With 3 nodes, they are found by DFS.
