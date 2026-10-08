# Research: MCP Server Registry (spec 008)

Phase 0 of `/speckit-plan`. Each decision lists what was chosen, why, and what else was considered. Client entry shapes were checked against a real machine with the three clients installed, reading **key names only**; no entry value was copied here (FR-014).

## D1. Where the registry lives

- **Decision**: `~/.h0wzy-mcp/registry.json`. The environment variable `H0WZY_MCP_REGISTRY` overrides it with a full file path (the "private location the developer chooses" of FR-002). Directory `0700`, file `0600`, written with `writeFileAtomic`. A file that exists but does not parse is refused, like every other config hmcp writes. When the chosen path sits inside a git work tree (a `.git` entry in it or an ancestor), hmcp warns on every write: the developer may keep it in a private repo on purpose, but a public one would leak FR-002 data.
- **Rationale**: `~/.h0wzy-mcp` already exists as the per-user H0wZy/mcp state directory (`shared/chain-guard.js` `stateDir()`), so no new top-level dot directory appears in `$HOME`. It is outside every repository by construction.
- **Alternatives**: `~/.hmcp/` (a second dot directory for the same project); `os.UserConfigDir()` (`%AppData%`, `~/Library/Application Support`, `~/.config`: harder to find and back up by hand, and diverges from the Node side); reusing `H0WZY_MCP_STATE_DIR` (that variable is a loop-guard knob forwarded through chains; tying the registry to it would move the registry whenever a test or chain points the guard elsewhere).

## D2. How hmcp knows which client entries it manages (FR-006)

- **Decision**: ownership is recorded **in the registry**. Each entry carries an `applied` list of destinations (`claude`, `codex`, `codex` + project path, `antigravity`) where hmcp wrote or adopted it. Client configs get no marker.
- **Rationale**: Claude Code and Antigravity validate MCP entries; an unknown key (`_hmcp`, `managedBy`) risks the entry being rejected or stripped on their next save. JSON has no comments, so there is no harmless marker for two of the three formats. One source of truth is also simpler to reason about: "managed" means "listed in `applied`".
- **Self-healing order**: client files are written first, the registry last. If saving the registry fails after a client write, the next `apply` finds an unrecorded entry with the same target and adopts it (FR-007), so no duplicate and no conflict.
- **Alternatives**: marker key inside each client entry (rejected above); a TOML comment for Codex only (works for one client of three, and comments are lost by tools that re-serialize); a fingerprint/hash of the written entry (detects drift but adds state; drift is computed by comparing against the rendered entry instead, see D5).

## D3. Client entry shapes

Verified on a real installation (key names only):

| Client | File | Command target | URL target |
|---|---|---|---|
| Claude Code (user) | `~/.claude.json` → `mcpServers.<name>` | `{"type":"stdio","command":…,"args":[…]}` | `{"type":"http","url":…}` |
| Codex (global) | `~/.codex/config.toml` → `[mcp_servers.<name>]` | `command = …`, `args = […]`, `env_vars = […]` when names are given | `url = …` |
| Codex (project) | `<project>/.codex/config.toml` | same as global | same as global |
| Antigravity | `~/.gemini/config/mcp_config.json` → `mcpServers.<name>` | `{"command":…,"args":[…]}` | `{"serverUrl":…}` |

- Registered servers get **no** `--host` argument, chain `env_vars` or long timeouts: those belong to the H0wZy/mcp bridges (`withHostArg`, `CodexChainEnvVars`). The existing `Register*ServerCommand` helpers add them, so the registry has its own small render/merge functions.
- Environment variable names (FR-003) map to Codex `env_vars`, the allow-list Codex forwards to a stdio server. Claude Code and Antigravity start stdio servers with their own environment, so they need no field. Quickstart step 6 checks this on Antigravity. Env names on a URL entry are refused: a URL server does not receive the client's environment.
- Claude Code's file is resolved from `os.UserHomeDir()`, like `hmcp install` (`CLAUDE_CONFIG_DIR` is not honored by the Go writers today; keeping one behavior across `hmcp` commands).

## D4. Writing without losing user content (FR-008, SC-003)

- **Decision**: hmcp *owns* only the target fields of a client entry: `type`/`command`/`args`/`url` (Claude), `command`/`args`/`url`/`env_vars` (Codex), `command`/`args`/`serverUrl` (Antigravity). A write sets those fields and **keeps every other key** (`env`, `headers`, `disabled`, `enabled`, `startup_timeout_sec`, …). Switching a server between command and URL deletes the owned fields of the other kind.
  - JSON clients: edit the entry map in place (`readJSONObject` / `writeJSONObject`, which already refuses invalid JSON and writes atomically).
  - Codex: rebuild the `[mcp_servers.<name>]` section from its current lines, dropping owned keys (including multi-line arrays) and emitting fresh owned keys first; other keys and sub-tables such as `[mcp_servers.<name>.env]` stay. Removal uses the existing `removeTOMLSection` (section plus sub-tables).
- **Rationale**: adopted hand-written entries often carry extras (an `env` block with a secret, `headers`). Replacing the whole entry would delete them silently, which is the exact failure FR-008 forbids.
- **Codex parse check**: hmcp has no TOML library (and adds none). The writer refuses a Codex file when the existing line parser reports a problem in any `[mcp_servers.*]` section (`codexBridgeEdges` already collects such problems); the rest of the file is passed through byte-for-byte.
- **Alternatives**: replace the whole entry (loses user keys); add a TOML module (new dependency for one file, and a re-serializer would reorder and strip the user's comments).

## D5. Same target, drift and conflict (FR-007, FR-009)

- **Same target** (adoption test): both URL and equal after trimming one trailing `/`; or both command, equal `command` and equal `args` (compared after `filepath.ToSlash`, exact case). `env_vars` and extra keys do not count: they are not the target.
- **States per destination** (`status`, and the decision `apply` takes):

  | Client entry | In `applied`? | Target vs registry | State | `apply` does |
  |---|---|---|---|---|
  | absent | no | — | missing | write, record |
  | absent | yes | — | missing | write (re-create), keep record |
  | present | yes | owned fields equal | in sync | nothing |
  | present | yes | owned fields differ | differs | rewrite owned fields |
  | present | no | same target | adoptable (reported as *in sync* + "not yet managed") | record (adopt), rewrite owned fields if they differ |
  | present | no | different target | conflict | skip and report; `--replace` rewrites and records |

- Plus two non-entry states: **not installed** (client binary not detected: skip with a notice, FR-004 / US1-3) and **unreadable** (config fails to parse: refuse that file, report, continue with the others).
- **Rationale**: "differs" is computed by rendering the registry entry and comparing owned fields only, so a user's extra keys never count as drift.

## D6. Reachability check for URL targets (FR-009)

- **Decision**: one `GET` per URL with a 3 s timeout (`http.Client{Timeout: 3 * time.Second}`). Any HTTP response, whatever the status code (405 and 401 are typical for an MCP endpoint), means **answers**; a network error or timeout means **unreachable**. Probes run concurrently. Command targets are not probed.
- **Rationale**: an MCP `initialize` POST could create a session or need auth; `GET` has no side effects and proves the host, port and path answer. `status` must not modify anything (FR-009).
- **Alternatives**: full MCP handshake (side effects, auth); TCP dial only (misses a wrong path behind a shared host, which is the `/<tool>/mcp` convention's whole point).

## D7. Which clients count as installed

- **Decision**: reuse `detectedAgents()` from `cli/cmd/install.go` (binary on PATH via `cli/detector`). The config package receives the set as a parameter, so tests pass it directly.
- **Rationale**: same notion of "installed" as `hmcp install`; no second detector.

## D8. Codex project scope (FR-005, US4)

- **Decision**: `hmcp registry apply [name…] --codex-project` writes the named entries (all when none named) to `<cwd>/.codex/config.toml` and records `{client: codex, project: <absolute cwd>}` in `applied`. Later `add`/`update`/`remove`/`apply` follow every recorded project path. A recorded project whose directory no longer exists is reported and its record dropped on the next successful write. A project destination is independent of the entry's `clients` list (it is an explicit request).
- **Note**: Codex reads `.codex/config.toml` only for trusted projects; quickstart says so. Project paths are private data and live only in the registry file (D1).

## D9. Command-line shape

- **Decision**: one cobra command `hmcp registry` (alias `reg`) with `add`, `update`, `remove`, `list`, `apply`, `status`. A command target follows `--`, like `claude mcp add <name> -- <cmd> <args…>`; a URL target uses `--url`. Full contract: [contracts/cli.md](contracts/cli.md).
- **Rationale**: avoids clashing with `hmcp install` / `hmcp remove` / `hmcp list`, which manage the H0wZy/mcp bridges.

## D10. Validation and warnings

- **Name**: `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` (a bare TOML key and a safe JSON key; matches `SERVER_NAME` in `shared/mcp-scope.js`). Reserved: `codex`, `antigravity`, `claude`, `team` (FR-010).
- **URL**: `http` or `https`, host required; **userinfo refused** (`user:pass@host` is a secret, FR-003). A query string draws a warning (tokens are often passed there).
- **Command**: non-empty argv, stored as a list, never joined into a shell string.
- **Env names**: `^[A-Za-z_][A-Za-z0-9_]*$`; anything with `=` is refused with "names only, never values".
- **Warnings, not errors** (FR-011): URL path not of the form `/<segment>/mcp` (optional trailing `/`); two entries with the same scheme + host + port + path.
- **Antigravity notice** (FR-012), on `add`/`update`/`apply` whenever an Antigravity destination is written: "Antigravity can call my-server's tools without asking. To leave it out: hmcp registry update my-server --clients claude,codex".

## D11. Partial failures

- Each destination is independent: a refused or failing file is reported and the others proceed; the exit code is non-zero when any destination failed or any conflict was left.
- `remove` deletes the registry entry only when every managed destination was cleaned (or is gone). Otherwise the entry stays with its remaining `applied` records, so a re-run after fixing the file finishes the job.
- `update --clients` that narrows the list removes the managed entries from the dropped clients.
