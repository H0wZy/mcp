# Contract: `hmcp registry`

CLI contract for spec 008. Placeholders only (FR-014). Alias: `hmcp reg`.

## Common behavior

- Every writing subcommand prints one line per destination touched: `claude ✓ written`, `codex ✓ in sync`, `antigravity ! conflict (…)`, `codex(<project>) ✗ unreadable: …`, `antigravity – not installed, skipped`.
- Exit code `0` when every destination ended in sync (or was skipped as not installed); `1` when any destination failed, was left in conflict, or input was invalid. Warnings never change the exit code.
- The Antigravity notice (FR-012) is printed whenever an Antigravity destination is written.
- Nothing is ever passed to a shell. No secret value is printed: hmcp stores none.

## `hmcp registry add <name> (--url <url> | -- <command> [args…])`

Registers a new server and applies it (FR-001, FR-015).

| Flag | Meaning |
|---|---|
| `--url <url>` | URL target. Mutually exclusive with a command after `--`. |
| `--clients <list>` | Comma list of `claude`, `codex`, `antigravity`. Default: all three (FR-004). |
| `--env <NAME>` | Env var name to forward (repeatable). Names only; `NAME=VALUE` is refused (FR-003). Command targets only. |
| `--note <text>` | Free-text note, stored in the registry only. |
| `--no-apply` | Save the entry, write no client config (FR-015). |
| `--replace` | On conflict, overwrite the client entry's target (FR-007). |

Errors: name already registered (use `update`); reserved name; invalid name/URL/env name; both or neither target given.

Example:

```text
$ hmcp registry add my-server --url http://<host>:<port>/my-server/mcp
claude       ✓ written
codex        ✓ adopted (existing entry, same target)
antigravity  ✓ written
! Antigravity can call my-server's tools without asking.
  To leave it out: hmcp registry update my-server --clients claude,codex
```

## `hmcp registry update <name> [--url <url> | -- <command> [args…]]`

Changes an entry and applies it (US2, FR-015). Same flags as `add`; only the flags given change. `--clients` that drops a client removes the managed entry from it (research D11). `--env` replaces the whole list; `--env ""` clears it. Error when the name is not registered.

## `hmcp registry remove <name> [--no-apply]`

Removes the managed client entries for `<name>`, then the registry entry (US2-2, FR-006). Entries hmcp did not create are never touched. If any managed destination cannot be cleaned, the registry entry stays and the command exits `1` (research D11). `--no-apply` removes the registry entry only and leaves client configs as they are (they become unmanaged).

## `hmcp registry list`

Prints each entry: name, target, clients, env names, note. Reads only.

## `hmcp registry apply [name…] [--codex-project] [--replace]`

Re-syncs the named entries (all when none named) into every wanted destination (FR-004). `--codex-project` targets `./.codex/config.toml` of the current folder for Codex instead of the global file, and records it (FR-005, research D8). `--replace` resolves conflicts by overwriting.

## `hmcp registry status`

Read-only (FR-009). One row per entry × destination with the state from data-model.md, plus `answers` / `unreachable` for URL entries (3 s timeout, concurrent). Ends with the warnings of research D10 (path convention, shared host+path, registry inside a git work tree). Exit `0` when everything is in sync, `1` otherwise, so it can gate scripts.

```text
$ hmcp registry status
my-server  http://<host>:<port>/my-server/mcp  answers
  claude       in sync
  codex        differs (url)
  antigravity  not in clients
```

## Environment

| Variable | Effect |
|---|---|
| `H0WZY_MCP_REGISTRY` | Full path of the registry file (default `~/.h0wzy-mcp/registry.json`). |
| `HOME` / `USERPROFILE` | Base for every user-scope client file (tests override them). |
