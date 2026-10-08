# Data Model: MCP Server Registry (spec 008)

All values below are placeholders (FR-014). The real file lives only on the developer's machine (research D1).

## Registry file

Path: `~/.h0wzy-mcp/registry.json`, or `$H0WZY_MCP_REGISTRY`. Permissions `0600` (directory `0700`). Written atomically; refused when it does not parse.

```json
{
  "version": 1,
  "servers": {
    "my-server": {
      "url": "http://<host>:<port>/my-server/mcp",
      "clients": ["claude", "codex"],
      "note": "free text, optional",
      "applied": [
        { "client": "claude" },
        { "client": "codex" },
        { "client": "codex", "project": "<absolute project path>" }
      ]
    },
    "my-local-server": {
      "command": "node",
      "args": ["<path>/server.js", "--stdio"],
      "env": ["MY_SERVER_TOKEN"],
      "applied": [{ "client": "claude" }, { "client": "codex" }, { "client": "antigravity" }]
    }
  }
}
```

- `version`: integer, `1`. A higher version is refused ("written by a newer hmcp").
- `servers`: object keyed by name, so names are unique by construction. Go marshals map keys sorted, so the file is stable across writes.

## Registry entry

| Field | Type | Required | Rules |
|---|---|---|---|
| (key) name | string | yes | `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`; not `codex`, `antigravity`, `claude`, `team` (FR-010) |
| `url` | string | one of `url` / `command` | `http`/`https`, host required, no userinfo (FR-003); warnings per research D10 |
| `command` | string | one of `url` / `command` | non-empty; never run through a shell |
| `args` | string[] | no | only with `command` |
| `clients` | string[] | no | subset of `claude`, `codex`, `antigravity`; absent = all three (FR-004) |
| `env` | string[] | no | env var **names** only, `^[A-Za-z_][A-Za-z0-9_]*$`; only with `command` (research D3) |
| `note` | string | no | free text; never written to client configs |
| `applied` | Destination[] | no | maintained by hmcp, never by flags (research D2) |

Exactly one of `url` and `command` (FR-001). The file is hmcp-owned, so an unknown field is rejected at load with a clear error: a typo in a hand edit is caught instead of silently dropped on the next write.

## Destination

A place a managed client entry lives.

| Field | Type | Rules |
|---|---|---|
| `client` | string | `claude`, `codex` or `antigravity` |
| `project` | string | only with `codex`; absolute path of the project folder whose `.codex/config.toml` holds the entry (FR-005) |

Resolved config file per destination:

| Destination | File | Entry location |
|---|---|---|
| `claude` | `~/.claude.json` | `mcpServers.<name>` |
| `codex` | `~/.codex/config.toml` | `[mcp_servers.<name>]` |
| `codex` + `project` | `<project>/.codex/config.toml` | `[mcp_servers.<name>]` |
| `antigravity` | `~/.gemini/config/mcp_config.json` | `mcpServers.<name>` |

## Wanted destinations

What an entry *should* be applied to:

- user-scope destinations: `clients` (or all three), filtered by installed clients at apply time;
- plus every `codex` + `project` destination already in `applied`, and the current folder when `apply --codex-project` names it.

`applied` minus wanted = destinations to clean (managed entries removed, research D11).

## Client entry state (per entry × destination)

Computed by `status` and by every apply; definitions in research D5.

```text
             ┌──────────── apply / add / update ────────────┐
             ▼                                              │
 missing ──write──▶ in sync ──hand edit──▶ differs ──apply──┘
                       ▲
 not managed (same target) ──adopt──┘
 hand entry, other target ──▶ conflict ──(apply --replace)──▶ in sync
 config unparsable, or Codex entry outside a plain section ──▶ unreadable (nothing written)
 client not installed ──▶ not installed (skipped)
```

States (`DestinationState` in `cli/config/registry_clients.go`): `in sync`, `differs`, `missing`, `not managed`, `conflict`, `unreadable`, `not installed`.

Owned fields compared for "in sync" / "differs" (research D4):

| Client | Command target | URL target |
|---|---|---|
| Claude | `type="stdio"`, `command`, `args` | `type="http"`, `url` |
| Codex | `command`, `args`, `env_vars` (absent when `env` empty) | `url` |
| Antigravity | `command`, `args` | `serverUrl` |

## Reachability (URL entries only)

`answers` (any HTTP response within 3 s) or `unreachable` (network error / timeout), research D6. Not stored.
