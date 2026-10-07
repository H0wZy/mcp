---
description: "Tasks for 006 Bidirectional Agent Mesh & Loop Guard"
---

# Tasks: Bidirectional Agent Mesh & Loop Guard

**Input**: `specs/006-bidirectional-agent-mesh/` (plan.md, research.md §6, data-model.md, contracts/)

**Tests**: Required. The spec's success criteria are test-defined (SC-001…SC-007), and `AGENTS.md` requires fake-binary tests for every argv change.

Format: `[ID] [P?] [Story] Description`. `[P]` means it can run in parallel (different files, no unfinished dependency).

---

## Phase 1: Setup

- [x] T001 Create the `servers/claude/` package skeleton (`package.json` 1.0.6 with a `@h0wzy/mcp-shared` dependency, `bin/cli.js`, `src/index.js`, `README.md`) mirroring `servers/codex/`
- [x] T002 [P] Add `servers/claude` to the root `package.json` workspaces / files, the `ci.yml` syntax checks, and the publish loop in `.github/workflows/publish-packages.yml`

## Phase 2: Foundational (blocks every story)

- [x] T003 Add an `onSpawn(child)` option to `executeProcess` in `shared/executor.js` (called once, right after a successful spawn), with a test in `shared/test/executor.test.js`
- [x] T004 [P] Implement `shared/ancestry.js`: `getAncestors(pid)` for Linux (`/proc`), POSIX (`ps -A -o pid=,ppid=`) and Windows (PowerShell CIM). It is cached, returns `null` when it can't be read, and has tests in `shared/test/ancestry.test.js` (current-process ancestry includes `process.ppid`)
- [x] T005 Implement `shared/chain-guard.js`:
  - `loadPolicy(env)` with clamping;
  - `resolveChain()` (env → registry + ancestry → new chain);
  - `beginHop({ target, tool, env, ancestors })` → `{ ok, hop | refusal }`;
  - `hop.capTimeoutMs`, `hop.childEnv`, `hop.notice`, `hop.trace()`, `hop.registerAgent(pid)` and `hop.finish(outcome)`;
  - the budget slots, the stale-record sweep and the chain log.
- [x] T006 Wire the guard into `shared/server.js`:
  - `createMcpServer({ name, host, … })` reads `--host` / `H0WZY_MCP_HOST`;
  - for tools with `spawnsAgent: true` it calls `beginHop` before the handler, passes `ctx.hop`, appends the trace line to every reply, and calls `finish` with the outcome;
  - export everything from `shared/index.js` and the `shared/package.json` exports.
- [x] T007 [P] Add `shared/l1.js`: `noBridgeArgs(target, { codexConfigPath })` returns the L1 flags for `claude`, `codex` (bridge servers found in the Codex config) and `antigravity`, per research D4. Tests in `shared/test/l1.test.js`.

**Checkpoint**: The guard is unit-tested in isolation.

---

## Phase 3: User Story 1 — Delegation chains always stop (P1) 🎯 MVP

**Independent test**: nested fake agents stop at depth 2, cycles and budget overruns are refused, and nothing is spawned on refusal.

- [x] T008 [P] [US1] Write unit tests in `shared/test/chain-guard.test.js`:
  - depth refusal;
  - cycle refusal, and allowing it with the revisit flag;
  - fail-closed on invalid env;
  - inheriting a registry entry via injected ancestry;
  - `nesting-unknown` when ancestry is null and records exist;
  - stale record sweep;
  - refusal returned in < 1 s.
- [x] T009 [US1] Mark the Codex and Antigravity task tools `spawnsAgent: true`. Use `ctx.hop` in `servers/codex/src/index.js` and `servers/antigravity/src/index.js`:
  - pass `hop.childEnv` and register the spawned pid;
  - prepend `hop.notice`;
  - apply the L1 args at max depth (agy also caps `--print-timeout`).
- [x] T010 [P] [US1] Add a `FAKE_AGENT_MODE=bridge` mode to `test/helpers/fake-agent.js`: the fake agent starts a bridge server, calls one tool on it over stdio and prints the reply. `FAKE_AGENT_STRIP_ENV=1` drops the `H0WZY_MCP_*` vars before starting it.
- [x] T011 [US1] Write `test/chain.e2e.test.js`:
  - claude-host → codex bridge → fake codex → antigravity bridge → fake agy → codex bridge is refused;
  - the same with stripped env (POSIX);
  - the refusal names the rule;
  - no extra fake process starts.
- [x] T012 [US1] Update `test/argv.test.js` with the notice and the L1 flags for Codex and Antigravity at max depth.

**Checkpoint**: The existing bridges are loop-safe. This ships value even without Claude.

---

## Phase 4: User Story 2 — Codex and Antigravity can call Claude Code (P1)

**Independent test**: the six `*_claude` tools build the exact argv from contracts/claude-bridge.md and report model, effort and chain.

- [x] T013 [US2] Add the `claude` provider to `shared/agent-config.js`:
  - the catalog per research D6 (aliases plus full ids; `effortControl: false` for haiku);
  - the tiers and the `CLAUDE_` prefix;
  - `cliEffort = null` for models without effort control, so the footer shows `effort=n/a`;
  - tests in `shared/test/agent-config.test.js`.
- [x] T014 [US2] Implement `servers/claude/src/index.js`:
  - the `configure_claude` and the 5 task tools;
  - the argv per the contract, the JSON result parsing, the cost and turns in the footer, the cap reporting;
  - `CLAUDE_BRIDGE_DELEGATE_PERMISSION_MODE` validation and the resilient errors.
- [x] T015 [P] [US2] Write `servers/claude/bin/cli.js` (pass `--host` through) and `servers/claude/README.md`
- [x] T016 [US2] Add claude argv contract tests to `test/argv.test.js`:
  - read-only, delegate, max depth;
  - Haiku without `--effort`;
  - caps from env;
  - parsing of JSON success and error results.
- [x] T017 [P] [US2] Cover the claude server in `test/stdio-verification.test.js` (or the existing equivalent): 6 tools, annotations, `configure_claude` get / set / reset.
- [x] T018 [P] [US2] Extend `test/packaging.test.js` to the claude server's npm layout.

---

## Phase 5: User Story 3 — Budget and deadline (P2)

- [x] T019 [US3] Add parallel sibling tests to `shared/test/chain-guard.test.js`: 5 `beginHop` calls against budget 3 → exactly 3 slots. Also: a deadline in the past is refused, and the timeout is capped to the remaining time.
- [x] T020 [US3] Cap delegate timeouts and agy's `--print-timeout` by `hop.capTimeoutMs` in all three servers. The `CLAUDE_BRIDGE_MAX_*` caps are covered by T014 and T016.

---

## Phase 6: User Story 4 — Install and doctor (P2), Go

- [x] T021 [P] [US4] Update the register functions in `cli/config/`:
  - the Codex register function takes extra keys (`env_vars`, `tool_timeout_sec`, `startup_timeout_sec`);
  - `ResolveServerScript` supports `claude`;
  - the launch args get `--host <host>`.
- [x] T022 [US4] In `cli/cmd/install.go`, `remove.go`, `list.go` and `ui/tui.go`: add the `codex-claude` and `antigravity-claude` directions, the cycle check for `--all`, and `--allow-cycles` (non-interactive refusal).
- [x] T023 [P] [US4] Add `cli/config/bridges.go`: read the installed bridges from the 3 host configs (user and project scope for Claude), and add `Cycles(edges)`.
- [x] T024 [US4] In `cli/cmd/doctor.go`: add the Bridges / Cycles / Loop guard sections and the JSON keys.
- [x] T025 [US4] Write the Go tests:
  - `cli/config/bridges_test.go`: all 64 subsets of the 6 directions;
  - `cli/config/config_test.go`: Codex extras preserved, user `.env` sub-table kept;
  - `cli/cmd/install_test.go`: cycle refusal without `--allow-cycles`.

---

## Phase 7: User Story 5 — Trace and log (P3)

- [x] T026 [US5] Test the trace line on success, error and refusal, and the chain log content (no prompt text) in `test/chain.e2e.test.js`.

---

## Phase 8: Polish

- [x] T027 [P] Update the docs:
  - `README.md` (Claude bridge, the six directions, the loop guard section, env vars);
  - `AGENTS.md` (layout and roadmap);
  - `servers/*/README.md` (trace line);
  - `SECURITY_AUDIT.md` (guard).
- [x] T028 Run the quickstart part A, check `npm test` and `go test ./cli/...` are green, and trigger CI on all 3 OSes via `workflow_dispatch`.

---

## Phase 9: Checked on the real CLIs (FR-026, research §7)

- [x] T029 Add `shared/mcp-scope.js`: `codexMcpArgs` (switch off every non-mesh `[mcp_servers.*]` table, and the bridges at max depth), `claudeMeshServers` / `claudeMcpArgs` (`--strict-mcp-config` + a temporary `--mcp-config` with the mesh bridges from the user and local scope of `~/.claude.json`; never a project `.mcp.json`), `H0WZY_MCP_USER_SERVERS=1` opt-out. `shared/l1.js` gains `bridgeKind` and `listCodexServers`. Tests in `shared/test/mcp-scope.test.js` and `shared/test/l1.test.js`.
- [x] T030 Use it in `servers/claude`, `servers/codex` and the team adapters (`shared/team/adapters.js`), with cleanup of the temp file on every path. `test/helpers/guard-env.js` points `CODEX_HOME` and `CLAUDE_CONFIG_DIR` at empty temp folders, and the fake agent records the `--mcp-config` content. Argv tests in `test/argv.test.js` and `shared/test/team-adapters.test.js`.
- [x] T031 Add `shared/agy.js` (print-timeout detection, "still connecting" log parsing, private `--log-file`, the JSON envelope parser moved from the adapters). The Antigravity bridge and team turns report a stuck run as a timed-out error that names the servers; the process limit becomes `--print-timeout` + 60 s. Tests in `shared/test/agy.test.js`, `test/argv.test.js` and `shared/test/team-adapters.test.js`.
- [x] T032 `parseClaudeResult` reports the JSON `errors`; drop `CLAUDE_CODE_SESSION_ATTENDED` from the nested env.
- [x] T033 Go: add `H0WZY_MCP_USER_SERVERS` to the Codex `env_vars` allow-list; `hmcp doctor` shows which servers nested agents load and flags an invalid value.
- [x] T034 Re-run on the real CLIs: `ask_claude`, `ask_codex`, `delegate_claude`, `delegate_codex`, a 2-hop chain `ask_claude → ask_codex`, and `delegate_antigravity` against a stuck MCP server (research §7).
- [x] T035 Fix the review of 1ec3792: Windows backslash and exact package names in `bridgeKind`; quoted and inline Codex servers; realpath, shadowing and `disabledMcpServers` in the local-scope lookup (Node and `hmcp doctor`); local scope for worktree teammates and calls without `cwd`; `--allowedTools` for read-only bridge tools; cleanup that never throws; no `--log-file` when no temp folder; agy grace kept inside the deadline; `hop.finish` when a team turn throws; agy server names and team errors sanitized; tests never run a real agent CLI (default fakes in `guard-env.js`, empty PATH in the Go detector test).

---

## Dependencies & Execution Order

- T003, T004, T007 → T005 → T006 → all stories.
- US1 (T008–T012) before US2 (T013–T018). US2's tools use the guard.
- US3 (T019–T020) after US1 and US2.
- US4 (Go, T021–T025) is independent of the Node work. It only needs the contracts, so it can run in parallel from the start.
- US5 (T026) after US1.

## Parallel opportunities

- Go (US4) runs in parallel with all the Node phases.
- T004 and T007 run in parallel. T015, T017 and T018 run in parallel after T014.
