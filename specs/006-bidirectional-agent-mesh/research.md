# Pre-Plan Research: Bidirectional Agent Mesh & Loop Guard

**Status**: Input for `/speckit-plan` Phase 0. Items marked **VERIFY** must be confirmed against the installed CLI versions before design is locked.

**Date**: 2026-10-06

---

## 1. The loop already exists today

`hmcp install --all` installs both `codex-antigravity` and `antigravity-codex` (`cli/cmd/install.go`). That creates the cycle `codex → antigravity → codex → …`. In the current code:

- No bridge reads or writes any depth, run id or budget (`shared/executor.js` passes `process.env` through unchanged).
- `ask_*`, `brainstorm_*` and `plan_*` run with automatic approvals (`--approve-for-me` on Codex, `--dangerously-skip-permissions` on Antigravity). A nested agent can therefore call its own bridges without any human seeing a prompt.
- Each hop has its own timeout (5 min for most tools, up to 60 min for `delegate_*`). Nothing ties a child's time to its parent's, so a loop is limited only by quota and wall-clock time.

Adding Claude Code as a target turns 2 directions into 6, which leaves 5 distinct simple cycles over 3 nodes. The guard (Story 1) must ship before or together with the Claude bridge (Story 2).

---

## 2. Defense in depth: three independent layers

| Layer | What it does | Why it's needed |
|---|---|---|
| **L1 Structural** | An agent started at the maximum depth gets **no bridge tools at all** | Cheapest: the model can't even try. Doesn't depend on env forwarding. |
| **L2 Runtime guard** | Every bridge checks the chain context (depth, visited, budget, deadline) **before** spawning | Enforced in code, independent of model behavior. Covers agents where L1 isn't possible. |
| **L3 Advisory** | The delegated prompt starts with "you are at depth d/max, called by X, do not call back" | Saves tokens: the model usually won't try a call that would be refused. Never relied on alone. |

Plus a **fallback for L2** when the host strips the context: a per-user **active-run registry** (one small file per running bridge-spawned agent: pid, run id, depth, chain). A newly started bridge looks up its process ancestors. If any ancestor pid is in the registry, it is nested and inherits that chain. If the ancestry can't be read but there is evidence of nesting, it fails closed (FR-003).

### Proposed chain context (env vars, names to be confirmed in plan)

```
H0WZY_MCP_RUN_ID     short random id, created at depth 0
H0WZY_MCP_CHAIN      e.g. "claude>codex"   (ordered, '>'-separated)
H0WZY_MCP_DEPTH      integer
H0WZY_MCP_DEADLINE   absolute epoch ms (monotonic budget re-derived per hop)
H0WZY_MCP_BUDGET_FILE path to the shared per-run counter (atomic increments, parallel siblings)
```

Budget accounting goes through a file in the run directory, not an env var: env is copied at spawn, so parallel siblings would each see the same "remaining" value. An exclusive-create lock file or atomic rename gives the atomic decrement FR-007 needs without dependencies.

---

## 3. Host capabilities (what each CLI lets us do)

### Claude Code (`claude`), the new target

From the official CLI reference (<https://code.claude.com/docs/en/cli-reference>):

| Need | Flag |
|---|---|
| Non-interactive run | `-p` / `--print` (prompt via stdin works: `cat x \| claude -p`) |
| Model / effort (spec 005 parity) | `--model <alias\|id>` (aliases `haiku`, `sonnet`, `opus`, `fable`), `--effort low\|medium\|high\|xhigh\|max` |
| **L1 structural guard** | `--strict-mcp-config --mcp-config '<json>'` → only the MCP servers we pass; or `--disallowedTools "mcp__*"` to remove every MCP tool |
| Spending cap (FR-017) | `--max-budget-usd <n>` (print mode only, client-side estimate) |
| Turn cap | `--max-turns <n>` |
| Read-only tools (FR-014) | `--permission-mode plan`, or `--tools "Read,Grep,Glob"` + `--disallowedTools "Edit,Write,Bash"` |
| Delegate without hanging (FR-015) | `--permission-mode acceptEdits` + `--permission-prompts none` (denies prompts nobody can answer) + `--add-dir` |
| No history clutter (FR-018) | `--no-session-persistence` |
| Machine-readable result + cost | `--output-format json` (result, session id, usage / cost) |
| Persistent teammate later (spec 007) | `--session-id <uuid>`, `--resume <id>` |
| Extra system prompt (L3 notice) | `--append-system-prompt` |

**VERIFY**: whether Claude Code passes its full environment to stdio MCP servers (expected: yes, merged with the server's `env`).

### OpenAI Codex (`codex`)

From <https://learn.chatgpt.com/docs/extend/mcp> (MCP config reference):

- `[mcp_servers.<name>]` supports `env`, **`env_vars` ("Environment variables to allow and forward")**, `enabled`, `enabled_tools`, `disabled_tools`, `startup_timeout_sec` (**default 10**), `tool_timeout_sec` (**default 60**).
- **Consequence 1 (L2)**: Codex does not promise to forward the parent environment to MCP servers. It uses an allow-list. `hmcp install` must write `env_vars = ["H0WZY_MCP_RUN_ID", "H0WZY_MCP_CHAIN", "H0WZY_MCP_DEPTH", "H0WZY_MCP_DEADLINE", "H0WZY_MCP_BUDGET_FILE"]`, and the ancestry fallback is mandatory for older configs.
- **Consequence 2 (existing bug)**: `tool_timeout_sec` defaults to **60 s**. `hmcp install codex-antigravity` writes only `command` / `args`, so any Antigravity call from Codex longer than a minute (every `delegate_*`, most reviews) will be cut by Codex. The installer must write a long `tool_timeout_sec`, at least the bridge's own maximum of 3600, plus a margin. `startup_timeout_sec = 10` can also be too short for the `npx -y` fallback on first run.
- **L1 for Codex**: confirmed in the official config docs (<https://learn.chatgpt.com/docs/config-file/config-advanced>): `-c` takes dotted keys, and the docs' own example is `mcp_servers.context7.enabled=false`. Starting a child with `-c mcp_servers.<bridge>.enabled=false` for each installed bridge removes its bridge tools. A value that is not valid TOML is read as a string.
- Sessions: `codex exec resume <SESSION_ID>`, `--json` (JSONL events incl. token counts). Useful for spec 007.
- Verified against `codex exec --help` (2026-10-07): `-s/--sandbox read-only|workspace-write|danger-full-access`, `--approve-for-me` ("automatic review using the workspace-write sandbox"), `-C/--cd`, `--ephemeral`, `--skip-git-repo-check`, `--ignore-user-config`, `--output-schema <FILE>`, `-o/--output-last-message <FILE>`, `--json`, `--worktree`, and `exec review`. A prompt of `-` (or none) is read from stdin. **`--add-dir` makes a folder *writable***, so Phase 0 stopped passing context paths through it. Both sandboxes can read the whole disk anyway.

### Google Antigravity (`agy`)

Verified against `agy --help` on the maintainer's machine (Windows, 2026-10-07) and the official docs:

- Flags that exist: `-p/--print <prompt>`, `--model`, `--effort` (`low|medium|high|xhigh|max`), `--print-timeout` (default `0s` = no limit), `--add-dir`, `--dangerously-skip-permissions`, `--mode` (`accept-edits|plan`), `--sandbox`, `--output-format text|json|stream-json`, `--input-format text|stream-json`, `--json-schema`, `-c/--continue`, `--conversation <id>`, `--agent`, `--disable-slash-commands`. Subcommands include `models`, `agents`, `mcp` (`add|remove|list|enable|disable`), `plugin`.
- **Read-only (fixed in Phase 0)**: in print mode, without `--dangerously-skip-permissions`, every action that needs approval is *soft-denied*: the run continues, exits 0, and names the skipped tool on stderr (<https://antigravity.google/docs/cli/headless/>). The read-only bridge tools now run that way and pass the stderr notice on to the caller. **Checked on Windows (2026-10-07)**: `agy -p "Create a file named hello.txt containing hi" --print-timeout 2m` wrote nothing, but it did not return early either. It ran until the print timeout and printed `[agy] print timeout after 2m0s with turn in progress; returning partial output`. (**Corrected in §7**: the turn never started at all. agy was waiting for an MCP server that could not connect; even "Reply with exactly: PONG" hung the same way.) The read-only tools therefore also open the prompt with a short read-only notice, so the model doesn't try, and give the process 30 s more than `--print-timeout`, so agy can return its partial output itself. `--mode plan` is **not** a guard: it only prepends a `/plan` instruction and "does not block edits or commands" (<https://antigravity.google/docs/cli/modes>). `--sandbox` restricts only terminal commands, and only on Linux and macOS (<https://antigravity.google/docs/sandbox?tab=cli>). Permission rules (`allow` / `ask` / `deny` lists: `read_file`, `write_file`, `command`, `mcp`, `read_url`, …) live only in the global `~/.gemini/antigravity-cli/settings.json`. There is no per-invocation flag or file for them (<https://antigravity.google/docs/permissions?tab=cli>).
- MCP config location: **`~/.gemini/config/mcp_config.json` is read by both the CLI and the IDE**, plus `.agents/mcp_config.json` per workspace (<https://antigravity.google/docs/mcp/>). The path in `cli/config/antigravity.go` is right. Skills are different: the CLI's global folder is `~/.gemini/antigravity-cli/skills/`, the IDE's is `~/.gemini/config/skills/`.
- **L1 for Antigravity**: no flag disables MCP servers per call (`agy mcp disable` is persistent and global). Two things help:
  - Read-only bridge calls already soft-deny MCP tool calls that the user hasn't allowed with an `mcp(...)` rule. **VERIFY** that MCP tools default to "ask", and not "allow", in a real run.
  - `--disable-slash-commands` stops a bridged prompt from expanding `/skill` commands (for example a team skill from spec 007). Pass it on every bridge call.
  - `delegate_*` auto-approves everything, so it relies on L2 (the env-var chain guard) + L3.
- **Custom agents** (`.agents/agents/<name>.md` or `~/.gemini/config/agents/`, YAML frontmatter with `tools`, `skills`, `model`, `permissionMode`) can restrict a run to a subset of tools via `--agent <name>` (<https://antigravity.google/blog/introducing-custom-agents/>). That could become an L1 for delegate calls (an agent without MCP tools). **VERIFY** that `--agent` works with `-p` and that `tools` is enforced.
- Budget accounting: `--output-format json` returns `usage` (`input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read_tokens`, `total_tokens`), `conversation_id`, `num_turns` and `status`. US3 can therefore count tokens, not just calls.
- The prompt is still passed in argv (`-p <prompt>`). `agy` is a native `.exe` on Windows (no `cmd.exe` re-splitting), but CreateProcess caps the command line at 32 K chars. `--input-format stream-json` reads prompts from stdin and is the way out if long prompts become a problem.

---

## 4. Decisions proposed for the plan

1. **Guard lives in `shared/`** (`shared/chain-guard.js`), called by `createMcpServer` before any tool handler that spawns an agent. One implementation, three bridges.
2. **Bridge registry metadata per tool**: mark which tools spawn agents, so `configure_*` and `list` never consume budget.
3. **Fail closed** on corrupt or unreadable context.
4. **Claude bridge = `servers/claude`**, mirroring `servers/codex`. Reuse `createAgentConfig` with a `claude` provider and a curated alias catalog.
5. **Installer writes guard-critical host settings** (Codex `env_vars`, `tool_timeout_sec`, `startup_timeout_sec`) and switches config writes to atomic temp-file + rename, with a backup of the previous file.
6. **Doctor builds the bridge graph** from the three host configs and runs cycle detection (3 nodes, trivial).

---

## 5. Effort estimate (one developer + AI pair, part-time)

| Slice | Size | Notes |
|---|---|---|
| US1 Loop guard (L2 + L3 + registry fallback) | **M**, ~3–5 days | Cross-platform process-ancestry is the hard part (Windows needs a different API than `/proc` or `ps`). |
| US2 Claude bridge server | **M**, ~2–3 days | Mostly mirrors `servers/codex`; a curated catalog for aliases. |
| US3 Budgets / deadline | **S**, ~1–2 days | Atomic counter + deadline arithmetic. |
| US4 Installer / doctor (Go) | **M**, ~2–3 days | Atomic config writes, TOML keys, cycle report. |
| US5 Trace / log | **S**, ~1 day | |
| **Total** | **~2–3 weeks part-time** | US1 + US2 alone are a shippable MVP (~1–1.5 weeks). |

---

## 6. Decisions for the plan (2026-10-07)

### D1. Chain identity and depth

- **Decision**: The depth is the depth of the agent that hosts the bridge. A top-level host is at depth 0, and the agent a bridge starts is at depth + 1. A call is refused when that target depth would exceed the max depth. The chain is the ordered list of agents, host first (`claude>codex`). The host's name comes from the inherited chain. Without one, it comes from `--host <name>` in the bridge's launch args (written by `hmcp install`) or `H0WZY_MCP_HOST`. Failing both, it is `host`.
- **Rationale**: "max depth 2" then reads naturally: A (0) → B (1) → C (2) runs, and C cannot call anyone. The host name in launch args survives hosts that filter env vars, and it avoids TOML `env` sub-table conflicts in Codex configs.
- **Alternatives**: Counting depth as the number of hops already made gives the same result but is harder to explain in refusals. A host name in env only fails under Codex's allow-list.

### D2. Budget counter

- **Decision**: Each call claims a slot `runs/<runId>/calls/<n>` for n = 1…maxCalls with `open(..., 'wx')`. Getting no slot means a refusal. The limits are written once to `runs/<runId>/policy.json` when the chain starts. A nested bridge applies the stricter of that policy and its own env.
- **Rationale**: This is atomic across processes and platforms, with no locks and no daemon. The chain policy is fixed, so a nested host can't raise its own limits (spec: "An agent can't raise its own limits").
- **Alternatives**: A lock file plus a counter needs stale-lock recovery. A counter in env can't be shared between parallel siblings.

### D3. Nesting fallback (FR-003)

- **Decision**: Before spawning, a bridge writes `agents/<childPid>.json` (run id, chain incl. target, depth, deadline) and removes it when the child exits. A bridge whose env has no chain looks at that registry. If live entries exist, it walks its own process ancestors (up to 32 levels). A match means it inherits that entry's chain. No match means it is top-level. Ancestry that can't be read while entries exist means fail closed, refused as `nesting-unknown`. Stale entries (dead pid, or 10 min past the deadline) are ignored and swept.
- **Rationale**: This tells a nested call apart from a fresh session the developer starts in another terminal while a chain runs (spec edge case).
- **Alternatives**: "Any live entry means nested" would wrongly cap fresh sessions. Ancestry alone (no registry) can't know which ancestor was a bridge child.

### D4. L1 per target CLI

| Target | Flags at max depth | Source |
|---|---|---|
| Claude Code | `--strict-mcp-config` (no `--mcp-config` → no MCP servers) and `--disable-slash-commands` | `claude --help` 2.1.292 |
| Codex | `-c mcp_servers.<name>.enabled=false` for each bridge server found in `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`). Only existing names are disabled, because a new `mcp_servers.<x>` table without a `command` could break the config. | config-advanced docs |
| Antigravity | `--disable-slash-commands`. No per-call MCP switch exists, so L2 covers it. | `agy --help` |

A bridge server is recognized by its launch args: `@h0wzy/mcp-server-<x>` or `servers/<x>/bin/cli.js`.

### D5. Claude Code command lines (verified against `claude --help` 2.1.292)

- **Every call**: `claude -p --output-format json --model <m> [--effort <e>] --permission-prompts none`. The prompt goes on stdin. The model is a curated alias (`fable`, `opus`, `sonnet`, `haiku`) or a full model id. `--effort` is skipped for models without effort control (Haiku 4.5).
- **Read-only** (`ask|review|brainstorm|plan_claude`): `--tools Read,Grep,Glob --no-session-persistence`, plus `--add-dir <dir>` for each context folder. No edit or shell tool exists in the session at all. Anything that would prompt is denied.
- **Delegate**: `--permission-mode acceptEdits` (or `CLAUDE_BRIDGE_DELEGATE_PERMISSION_MODE` ∈ `acceptEdits|auto|dontAsk`), run with `cwd`, plus `--add-dir` for extra folders. Edits are auto-approved and everything else that would prompt is denied, so it never hangs (FR-015).
- **Caps**: `CLAUDE_BRIDGE_MAX_TURNS` → `--max-turns`, `CLAUDE_BRIDGE_MAX_BUDGET_USD` → `--max-budget-usd` (FR-017).
- **Output**: a JSON object with `result`, `is_error`, `subtype`, `total_cost_usd`, `num_turns` and `session_id`. The bridge returns `result` and adds `cost=$…` and `turns=…` to the footer. An `error_max_*` subtype is reported as a reached cap. If parsing fails, the raw text is returned.
- **Alternatives**: `--permission-mode plan` was rejected for read-only. In print mode the plan ends in an `ExitPlanMode` call that nobody approves, and it doesn't remove `Bash`. `--restricted` is stronger, but it ignores the user's settings files, which may hold auth or model settings people rely on.

### D6. Claude tiers and catalog

- **Decision**:
  - Tiers: light = `sonnet`/`low`, balanced = `opus`/`medium` (startup default), deep = `fable`/`high`.
  - Catalog: the aliases `fable` (deep), `opus` (balanced), `sonnet` (light) and `haiku` (light, no effort flag), plus the current full ids `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-4-5`.
  - Env prefix `CLAUDE_BRIDGE_`, not `CLAUDE_`: Claude Code exports `CLAUDE_EFFORT` and other `CLAUDE_*` variables to its child processes (`CLAUDE_BRIDGE_MODEL`, `CLAUDE_BRIDGE_EFFORT`, `CLAUDE_BRIDGE_MAX_TIER`, `CLAUDE_BRIDGE_MAX_EFFORT`, `CLAUDE_BRIDGE_TIER_*`).
- **Rationale**: Aliases follow model releases automatically. Haiku 4.5 rejects the effort parameter, so `--effort` is not sent for it.

### D7. Timeouts

- **Decision**: A hop's process timeout is min(the tool's own limit, time left until the chain deadline). Antigravity's `--print-timeout` gets the same cap, rounded down to whole minutes (min 1). `hmcp install` writes Codex `tool_timeout_sec = 3900` and `startup_timeout_sec = 60`.

---

## 7. Checked on the real CLIs (2026-10-07, maintainer's Windows 11 machine)

Claude Code 2.1.293, Codex CLI 0.161.0, agy 1.3.1. Each probe ran the exact command line the bridges build, with a one-line prompt ("Reply with exactly: PONG") and the cheapest model, in an empty temporary folder. The developer's real configs were loaded: 11 MCP servers registered in Claude Code (plus the claude.ai connectors of the account), 11 in Codex, 10 in Antigravity.

### D8. What a nested agent loads (FR-026)

| Run | Context / time | Cost |
|---|---|---|
| `claude -p … --tools Read,Grep,Glob` (the bridge before FR-026) | 379,501 cache-creation tokens, 8 s | US$ 0.3795 (Haiku) |
| same + `--strict-mcp-config --disable-slash-commands` | 8,880 tokens, 3 s | US$ 0.0012 |
| same + `--strict-mcp-config` only | 8,880 tokens (cache hit) | US$ 0.0001 |
| bridge after FR-026: `ask_claude` with the two mesh bridges in `--mcp-config` | 3.3 s | US$ 0.0036 |
| `codex exec` with the user's 11 MCP servers | 37 s | 27,402 input tokens |
| same with every server `enabled=false` | 19 s | 27,402 input tokens |
| bridge after FR-026: `ask_codex` (mesh bridges kept) | 12.6 s | — |

- **Decision**: An agent started by a bridge loads only the mesh bridges below the maximum depth, and nothing at it. The cost comes from MCP tool definitions, not skills: `--disable-slash-commands` changed nothing measurable. With `--max-budget-usd 0.05`, the unscoped call failed on its first request (`error_max_budget_usd`), so a small spending cap could never be used.
  - **Claude Code**: `--strict-mcp-config`, plus `--mcp-config <temp file>` listing the bridges found in the user scope of `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`) and the local scope of the working folder. The file (mode 0600, removed after the call) keeps server definitions and any env they carry off the command line. A project's `.mcp.json` is never read: Claude Code asks before it starts a project server, and `--mcp-config` would skip that approval. `--strict-mcp-config` also drops the account's claude.ai connectors.
  - **Codex**: `-c mcp_servers.<name>.enabled=false` for every `[mcp_servers.<name>]` table that is not a mesh bridge (the team server included), and for the bridges too at the maximum depth.
  - **Antigravity**: no per-call switch (§3); it keeps loading all of its servers.
  - `H0WZY_MCP_USER_SERVERS=1` restores the user's own servers below the maximum depth. It is on Codex's `env_vars` allow-list, and `hmcp doctor` shows it.
- **Real chain**: `ask_claude` (Haiku) told to call `ask_codex` once got the Codex bridge through `--mcp-config`, and the nested Codex reported `[chain tester→claude→codex · depth 2/2 · calls 2/8 · run 18561fc1]`. Total 15 s, US$ 0.0022 of Claude. The nested call was not blocked by `--permission-prompts none` on this machine. **Resolved (docs, 2026-10-07)**: the docs don't list MCP tools as allowed without a prompt, and in a `-p` run "these requests are denied" when nobody can answer (headless, permissions pages). A clean profile would therefore lose the mesh, so the bridge now passes `--allowedTools` with the read-only bridge tools of the servers in its `--mcp-config` (`mcp__<name>__ask_*`, `review_*`, `brainstorm_*`, `plan_*`). `delegate_*` and `configure_*` still need the user's own allow rules: a read-only call must not be able to start an editing one.
- **Review of 1ec3792 (2026-10-07)**: the local-scope lookup compares the working folder both as given and as the OS resolves it (symlinks, `/private/var`, 8.3 names); a local entry shadows a user-scope bridge of the same name even when it isn't a bridge; `projects[…].disabledMcpServers` is honoured; team teammates in a worktree use the team project's local scope; a read-only call without `cwd` uses the server's own folder, where the child runs. Codex: quoted table names and inline tables under `[mcp_servers]` are read too; a server name with a dot can't be addressed by `-c` and stays on (best effort). **VERIFY**: whether Claude Code keys local scope by the git root rather than the exact folder (a `cwd` in a subfolder of the project would then miss).
- **`$CLAUDE_CONFIG_DIR/.claude.json`**: the docs say every `~/.claude` path moves under `CLAUDE_CONFIG_DIR` and confirm `$CLAUDE_CONFIG_DIR/settings.json`, but they list `~/.claude.json` separately and don't say it moves. The bridge reads `$CLAUDE_CONFIG_DIR/.claude.json` (what was observed on the maintainer's machine). **VERIFY** stays open.
- **Alternatives**: `--disallowedTools "mcp__*"` removes the tools but still starts every server. `--bare` skips OAuth sign-in, which subscription users rely on.

### D9. Antigravity waits for every MCP server

- An unreachable HTTP server in `~/.gemini/config/mcp_config.json` (a Tailscale host that had been offline for 5 days) kept every `agy -p` run from starting: the log repeated `MCP: 1 server(s) still connecting after 30s: <name>`, the run hit `--print-timeout` and exited **0** with `{"status":"SUCCESS","response":"","num_turns":0}`. On shutdown the log shows `Failed to append MCP servers from specs: context canceled`: the turn was waiting for the server list.
- `agy mcp disable <name>` set `"disabled": true`, but the next run still logged the server as "still connecting" and hung the same way. Removing the server (or bringing it back online) is the fix.
- Each run also starts and stops the user's local servers (Unity, Blender, Mixar…); a Unity MCP connection held by another client dropped during these runs.
- **Decision**: The bridge and the team adapter pass a private `--log-file`. When agy reports `print timeout after … with turn in progress` (or the process limit kills it), the call is an error with outcome `timed-out`, keeps any partial answer, and names the servers from the last "still connecting" line. agy needs ~25 s around `--print-timeout` (10 s CLI start-up, sign-in, MCP start-up, shutdown), so the process limit is now `--print-timeout` + 60 s.

### D10. Output formats (now verified)

- **Claude Code** `--output-format json`: `type: "result"`, `subtype`, `is_error`, `result` (absent on errors), `session_id`, `total_cost_usd`, `num_turns`, `usage`, `modelUsage`, `permission_denials`, `terminal_reason`, and on errors `errors: ["Reached maximum budget ($0.05)"]`, exit code 1. The bridges now report `errors`. `--max-turns` is accepted although `--help` no longer lists it. The `haiku` alias resolved to `claude-haiku-5-5`, and `--model haiku --effort low` ran without an error. The model-config docs list Haiku 5.5 with `low`…`max` effort (default `medium`), so the catalog now sends `--effort` for `haiku` and the pinned `claude-haiku-5-5`, and not for the pinned `claude-haiku-4-5`. On Bedrock, Vertex and Foundry the alias is still Haiku 4.5; Claude Code falls back for levels a model lacks.
- **Codex** `exec --json`: JSONL events `thread.started` (`thread_id`), `turn.started`, `item.completed` (`agent_message` text), `turn.completed` (`usage`). `-o <file>` holds the last message. `codex exec resume [SESSION_ID] [PROMPT]` exists (prompt `-` reads stdin) but has no `-C`, `--color`, `-s` or `--approve-for-me`; resuming editing teammates would need those from the root command line. Teammates keep the history-in-prompt approach until that is tested.
- **agy** `--output-format json`: `{ conversation_id, status, response, duration_seconds, num_turns, usage: { input_tokens, output_tokens, thinking_tokens, cache_read_tokens, total_tokens } }`. The status says "SUCCESS" even after a print timeout (D9). `agy models` lists the effort inside the id (`gemini-3.8-flash-low|medium|high`, `gemini-3.1-pro-low|high`), which matches the curated catalog.
