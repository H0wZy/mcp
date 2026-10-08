# Quickstart: Validate the Bidirectional Mesh & Loop Guard

## A. Automated (no real agents, runs in CI)

```bash
npm test             # guard unit tests, chain e2e with fake agents, claude argv contracts
go test ./cli/...    # installer: new directions, Codex env_vars/timeouts, cycle detection
```

What the suites prove:

| Check | Test | Success criterion |
|---|---|---|
| Depth limit refuses at depth 2 without spawning | `shared/test/chain-guard.test.js` | SC-003 |
| Cycle `claude → codex → claude` refused by default; allowed with `H0WZY_MCP_ALLOW_REVISIT=1` | same | FR-006 |
| 5 parallel siblings with budget 3 → exactly 3 run | same | FR-007, US3 |
| Nested timeout capped by the parent's deadline | same | FR-008 |
| A fake Codex that strips the chain env still gets refused at depth 2 (registry + ancestry) | `test/chain.e2e.test.js` | SC-002 (POSIX in CI; Windows path via the PowerShell query) |
| Ancestry unreadable while agents are registered → `nesting-unknown` refusal | `chain-guard.test.js` (injected ancestry) | FR-003 fail-closed |
| Exact `claude` argv for read-only, delegate and max depth | `test/argv.test.js` | FR-014, FR-015, FR-010 |
| Trace line on success, error and refusal | `chain.e2e.test.js` | FR-023 |
| `install --all` refuses cycles non-interactively without `--allow-cycles` | `cli/cmd/install_test.go` | FR-020 |
| `doctor` finds every cycle for all 64 subsets of the 6 directions | `cli/config/bridges_test.go` | SC-006 |

## B. Manual, with the real agents (maintainer machine)

Prerequisites: `claude`, `codex` and `agy` are installed and signed in, and `hmcp` is built from this branch (`go build -o dist/hmcp ./cli`).

1. `dist/hmcp install --all --allow-cycles`, then `dist/hmcp doctor`. Expect 6 bridges, the cycles listed, and the guard defaults.
2. In Codex, ask: "Use ask_claude to explain what shared/chain-guard.js does." Expect a Claude answer that ends with `[claude · model=opus · effort=medium …]` and `[chain codex→claude · depth 1/2 · calls 1/8 · run …]`.
3. Adversarial loop (SC-001), in Codex: "Ask antigravity to ask claude to ask codex to ask antigravity …, forever." Expect the chain to stop at depth 2, a `⛔ [Loop guard: …]` refusal in the deepest reply, and no agent processes left after the answer (`ps`/Task Manager).
4. Budget: put `H0WZY_MCP_MAX_CALLS=3` in the bridge env. Ask Claude to `delegate_codex` a task that makes 5 `ask_antigravity` calls. Expect the delegation (call 1) and 2 Antigravity answers, plus 3 budget refusals inside Codex. Each top-level call starts its own chain.
5. Optional log: set `H0WZY_MCP_CHAIN_LOG=1`, repeat step 3, then `cat ~/.h0wzy-mcp/chain.log`. Expect one line per hop with the same `run`, and no prompt text.
