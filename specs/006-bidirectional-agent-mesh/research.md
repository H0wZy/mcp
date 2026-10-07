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
- **Read-only (fixed in Phase 0)**: in print mode, without `--dangerously-skip-permissions`, every action that needs approval is *soft-denied*: the run continues, exits 0, and names the skipped tool on stderr (<https://antigravity.google/docs/cli/headless/>). The read-only bridge tools now run that way and pass the stderr notice on to the caller. **Checked on Windows (2026-10-07)**: `agy -p "Create a file named hello.txt containing hi" --print-timeout 2m` wrote nothing, but it did not return early either. It ran until the print timeout and printed `[agy] print timeout after 2m0s with turn in progress; returning partial output`. The read-only tools therefore also open the prompt with a short read-only notice, so the model doesn't try, and give the process 30 s more than `--print-timeout`, so agy can return its partial output itself. `--mode plan` is **not** a guard: it only prepends a `/plan` instruction and "does not block edits or commands" (<https://antigravity.google/docs/cli/modes>). `--sandbox` restricts only terminal commands, and only on Linux and macOS (<https://antigravity.google/docs/sandbox?tab=cli>). Permission rules (`allow` / `ask` / `deny` lists: `read_file`, `write_file`, `command`, `mcp`, `read_url`, …) live only in the global `~/.gemini/antigravity-cli/settings.json`. There is no per-invocation flag or file for them (<https://antigravity.google/docs/permissions?tab=cli>).
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
