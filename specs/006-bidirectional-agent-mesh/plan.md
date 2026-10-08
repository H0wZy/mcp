# Implementation Plan: Bidirectional Agent Mesh & Loop Guard

**Branch**: `claude/trusting-cray-vso3rf` (feature `006-bidirectional-agent-mesh`) | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-bidirectional-agent-mesh/spec.md` (clarified 2026-10-07)

---

## Summary

1. **Loop guard in the shared core.** `shared/chain-guard.js` decides, before any agent is started, whether a bridge call may run. It reads the chain context from environment variables. When a host strips those variables, it falls back to a registry of running bridge-started agents plus the process ancestry. It refuses calls that are too deep, revisit an agent, exceed the chain's call budget or start after the deadline. `createMcpServer` runs it for every tool marked `spawnsAgent`, so the three bridges behave the same. The guard has three layers:
   - **L1**: an agent started at the maximum depth gets no bridge tools where its CLI allows it.
   - **L2**: the runtime check above.
   - **L3**: a position notice at the top of the prompt.

   Below the maximum depth, an agent started by a bridge loads only the mesh bridges, not the user's other MCP servers (FR-026, `shared/mcp-scope.js`, added after the real-CLI checks in research §7).
2. **Claude Code bridge** (`servers/claude`, npm `@h0wzy/mcp-server-claude`). It has the same six tools as the other bridges, runs `claude -p` with prompts on stdin and `--output-format json`, and uses `createAgentConfig({ provider: 'claude' })` for spec 005 parity.
   - Read-only tools run with only `Read`, `Grep` and `Glob`.
   - Delegation uses `acceptEdits` with `--permission-prompts none`.
   - Calls never wait on a prompt.
3. **Installer and doctor** (Go):
   - New directions `codex-claude` and `antigravity-claude`.
   - Each host entry tells the bridge who its host is (`--host <name>`). Codex entries also get `env_vars`, `tool_timeout_sec` and `startup_timeout_sec`.
   - `--all` asks before creating cycles (`--allow-cycles` when non-interactive).
   - `doctor` prints the bridge graph, its cycles and the guard limits.
4. **Trace and log.** Every bridge reply ends with `[chain … · depth d/max · calls n/budget · run id]`. An opt-in JSON Lines log records one line per call, with no prompt text.

---

## Technical Context

**Language/Version**: Node.js ≥ 20 (ES modules) for `shared/` and `servers/`. Go (version from `cli/go.mod`) for the `hmcp` CLI.

**Primary Dependencies**: Node built-ins only (`node:fs`, `node:path`, `node:os`, `node:crypto`, `node:child_process`). Go: the existing cobra + lipgloss stack. No new third-party runtime dependencies.

**Storage**: Small JSON files under the guard state dir, `~/.h0wzy-mcp/` by default (override `H0WZY_MCP_STATE_DIR`):
- `runs/<runId>/policy.json`: the chain's limits, fixed when the chain starts.
- `runs/<runId>/calls/<n>`: one exclusive-create slot per call. This is the atomic budget counter.
- `agents/<pid>.json`: the registry of running bridge-started agents, used for the FR-003 fallback.
- `chain.log`: the opt-in JSON Lines log.

**Testing**: `node:test`.
- The guard is unit-tested with an injected ancestry function and a temp state dir.
- End-to-end chains use the fake agents in `test/helpers/fake-agent.js`. A fake agent can itself call a bridge server, to simulate nesting with and without forwarded variables.
- Go: `go test ./cli/...` with a temp `HOME` / `USERPROFILE`.

**Target Platform**: Linux, macOS, Windows. Process ancestry comes from:
- `/proc/<pid>/stat` on Linux;
- one `ps -A -o pid=,ppid=` call on macOS and other POSIX systems;
- one PowerShell `Get-CimInstance Win32_Process` query on Windows, cached per server process and only run when agents are registered and the env carries no chain.

**Project Type**: MCP stdio servers plus a CLI installer.

**Performance Goals**:
- Refusal decided in < 1 s, with 0 processes started (SC-003). With env context it is a few file operations, under 10 ms.
- The Windows ancestry query (~0.5–2 s) runs at most once per server, and only on the fallback path.

**Constraints**:
- Guard decisions never depend on the model.
- Nothing is spawned before the decision.
- Parallel siblings share the budget atomically.
- Children never outlive the parent's deadline.
- Existing tool calls keep working. The only visible change for a top-level call is the trace line (FR-025).

**Scale/Scope**: 3 agents, 6 directed bridges, chains of at most 4 hops (hard cap), at most 32 calls per chain (hard cap).

---

## Constitution Check

`.specify/memory/constitution.md` is still the unfilled template. The gates are the project rules in `AGENTS.md`:

| Rule (AGENTS.md) | How this plan complies |
|---|---|
| Zero third-party runtime deps | Guard and Claude bridge use `node:*` only. |
| Shared logic in `shared/` | The guard, ancestry lookup, trace formatting and L1 helpers live in `shared/`. Servers only declare `spawnsAgent` and read the hop. |
| Tool parity | `servers/claude` exposes the same six tools and parameter names (`prompt`, `paths`, `cwd`, `model`, `effort`, `timeout_minutes`). |
| Spawn only through `executeProcess`, prompts via stdin | Claude prompts go on stdin. `executeProcess` gains an `onSpawn` hook so the guard can register the agent's pid. |
| Execution footer + resilient errors | Footer kept. The trace line comes after it. Refusals are `isError: true` with recovery advice. |
| Least privilege | Claude read-only tools get `--tools Read,Grep,Glob` and `--permission-prompts none`. Delegation gets `acceptEdits`, and prompts are denied. |
| Config writers never clobber | Go writers reuse `readJSONObject`, `upsertTOMLSection` and `writeFileAtomic` (Phase 0). |
| Tests without real agents | Fake binaries only. A test asserts the exact `claude` argv. |

Result: **pass**, no violations to justify.

---

## Project Structure

### Documentation (this feature)

```text
specs/006-bidirectional-agent-mesh/
├── spec.md · research.md · plan.md · data-model.md · quickstart.md · tasks.md
├── contracts/
│   ├── chain-context.md     # env vars, state dir layout, refusal / trace formats
│   ├── claude-bridge.md     # tools, claude argv per tool, env knobs
│   └── installer.md         # hmcp install / doctor contract (Go)
└── checklists/requirements.md
```

### Source Code (repository root)

```text
shared/
├── chain-guard.js        # NEW: policy, beginHop(), refusals, trace, registry, chain log
├── ancestry.js           # NEW: process ancestors per platform (cached)
├── l1.js                 # NEW: per-target "no bridge tools" argv (claude / codex / agy), bridgeKind
├── mcp-scope.js          # NEW (FR-026): MCP servers a nested claude / codex loads
├── agy.js                # NEW (FR-026): agy print-timeout and stuck-MCP-server diagnosis
├── claude.js             # NEW: nested claude env, JSON result parsing, caps
├── executor.js           # + onSpawn option
├── server.js             # + spawnsAgent tools go through the guard; trace appended
├── agent-config.js       # + 'claude' provider (catalog, tiers, CLAUDE_ prefix, no-effort models)
└── test/chain-guard.test.js, ancestry.test.js
servers/
├── claude/               # NEW: package.json, bin/cli.js, src/index.js, README.md
├── codex/src/index.js    # tools marked spawnsAgent; uses hop (env, timeout cap, L1, notice)
└── antigravity/src/index.js
test/
├── chain.e2e.test.js     # NEW: nested chains with fake agents (forwarded / stripped env)
├── argv.test.js          # + claude argv contracts
└── helpers/fake-agent.js # + mode that calls a bridge server (nesting)
cli/
├── config/{claude,codex,antigravity}.go  # host flag, Codex env_vars + timeouts
├── config/bridges.go     # NEW: read installed bridges from the 3 host configs
├── cmd/install.go, remove.go, list.go, doctor.go, ui/tui.go
└── config/*_test.go, cmd/*_test.go
```

**Structure Decision**: Keep the existing single-repo layout. The Claude bridge is a third server package, versioned in lockstep with the others (1.0.6).

---

## Phase 0: Research

See [research.md](./research.md). Its sections 1–5 are pre-plan research. Section 6 records the decisions made for this plan: chain identity, budget slots, the ancestry fallback, the L1 flags per CLI, the Claude argv, and the installer's host flag. Section 7 records what the real CLIs did on the maintainer's machine and the decisions that followed (FR-026).

## Phase 1: Design & Contracts

- [data-model.md](./data-model.md): Chain, Hop, Policy, AgentRecord, Refusal and BridgeEdge, with their validation rules and states.
- [contracts/chain-context.md](./contracts/chain-context.md): the environment, filesystem and text contract between bridges.
- [contracts/claude-bridge.md](./contracts/claude-bridge.md): the `*_claude` tools and the exact `claude` command lines.
- [contracts/installer.md](./contracts/installer.md): `hmcp install|remove|list|doctor` behavior for the new directions.
- [quickstart.md](./quickstart.md): runnable validation of SC-001 … SC-007 with fake and real agents.

Post-design constitution re-check: **pass** (same table; no new dependencies, all logic in `shared/`).

---

## Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
|---|---|---|
| Process-ancestry fallback | FR-003: Codex forwards only allow-listed env vars, and Antigravity's behavior is unknown | Trusting env vars alone fails open on any host that strips them. Treating every nested-looking call as max depth would wrongly limit a fresh session started while a chain runs (spec edge case). |
| File-slot budget counter | FR-007: parallel siblings must share the budget atomically across processes | An env-var counter is copied at spawn, so siblings would all see the same "remaining". A lock file needs stale-lock handling. Exclusive-create slots need neither. |
