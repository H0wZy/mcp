# Contract: `hmcp` Installer & Doctor (Go)

## Directions

| Bridge name | Host config | Server key | Launch | Target |
|---|---|---|---|---|
| `claude-antigravity` | `~/.claude.json` (user) / `.mcp.json` (project) | `antigravity` | `… antigravity … --host claude` | antigravity |
| `claude-codex` | same | `codex` | `… codex … --host claude` | codex |
| `codex-antigravity` | `~/.codex/config.toml` | `antigravity` | `… --host codex` | antigravity |
| `codex-claude` **(new)** | `~/.codex/config.toml` | `claude` | `… claude … --host codex` | claude |
| `antigravity-codex` | `~/.gemini/config/mcp_config.json` | `codex` | `… --host antigravity` | codex |
| `antigravity-claude` **(new)** | `~/.gemini/config/mcp_config.json` | `claude` | `… claude … --host antigravity` | claude |

The launch command comes from `ResolveServerScript(target)`: a local clone (`node <abs>/servers/<target>/bin/cli.js`) or `npx -y @h0wzy/mcp-server-<target>`. `--host <host>` is appended to the args.

## Codex entries

Every bridge section written into Codex's config also gets:

```toml
env_vars = ["H0WZY_MCP_RUN_ID", "H0WZY_MCP_CHAIN", "H0WZY_MCP_DEPTH", "H0WZY_MCP_DEADLINE", "H0WZY_MCP_STATE_DIR", "H0WZY_MCP_MAX_DEPTH", "H0WZY_MCP_MAX_CALLS", "H0WZY_MCP_ALLOW_REVISIT", "H0WZY_MCP_DEADLINE_MINUTES", "H0WZY_MCP_CHAIN_LOG"]
tool_timeout_sec = 3900
startup_timeout_sec = 60
```

The section is replaced with `upsertTOMLSection`, which keeps the user's `[mcp_servers.<key>.env]` sub-table. The write is atomic, mode `0600`, and refused on an unreadable file. Phase 0 rules apply.

## `install --all`

1. It collects the directions supported by the detected CLIs: any host that has a target installed, all 6 when all three agents exist.
2. If the resulting graph (plus the bridges already installed) has a cycle, it prints the cycles and the loop-guard defaults, then:
   - **interactive (TTY)**: asks `Install bridges that form cycles? The loop guard limits them (depth 2, 8 calls, no revisits). [y/N]`;
   - **non-interactive**: refuses the cycle-forming directions unless `--allow-cycles` is passed, and still installs the acyclic ones.
3. Done in a fixed order. Directions skipped because of the cycle rule are listed in the output.

## `remove <bridge>`

Removes the server key from the host config. Supports the two new names.

## `list`

Shows the six directions with their install state.

## `doctor`

Adds a **Bridges** section after the CLI health checks:

```
🔗 Bridges (host → target)
  claude → codex        user scope
  codex → claude        ⚠ env_vars missing: chain context only via the ancestry fallback
  …
🔁 Cycles
  claude → codex → claude
🛡  Loop guard: depth 2 · calls 8 · revisits off · deadline 60 min  (H0WZY_MCP_* overrides shown when set; values above the hard caps are flagged as clamped)
```

`doctor --json` adds `bridges`, `cycles` and `guard` keys to the JSON output.
