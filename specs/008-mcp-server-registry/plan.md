# Implementation Plan: MCP Server Registry

**Branch**: `008-mcp-server-registry` | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/008-mcp-server-registry/spec.md`

## Summary

`hmcp registry` keeps a private, per-user list of the developer's own MCP servers (name + launch command or URL) and writes each one into Claude Code (user scope), Codex (global, or a project's `.codex/config.toml`) and Antigravity. `add` / `update` / `remove` apply the affected entry right away (FR-015); `apply` re-syncs everything; `status` reports drift without writing. The registry file lives in `~/.h0wzy-mcp/registry.json` (overridable), outside any repository. Ownership of client entries is recorded in the registry itself, never as marker keys inside client configs. All writes reuse the existing `cli/config` writer rules: refuse unparsable files, atomic temp-file + rename, `0600`.

## Technical Context

**Language/Version**: Go 1.26 (`cli/`, module `github.com/H0wZy/mcp/cli`)

**Primary Dependencies**: cobra (already used by `cli/cmd`); stdlib only for the new code (`encoding/json`, `net/http`, `net/url`, `regexp`). No new module.

**Storage**: one JSON file per user, `~/.h0wzy-mcp/registry.json` (dir `0700`, file `0600`), or the path in `H0WZY_MCP_REGISTRY`. See research D1.

**Testing**: `go test ./cli/...` with `t.TempDir()` and `HOME` / `USERPROFILE` overridden, as in `cli/config/config_test.go`. URL reachability tested against `httptest.Server`.

**Target Platform**: Windows, macOS, Linux (same as `hmcp`).

**Project Type**: CLI (subcommand of the existing `hmcp` binary).

**Performance Goals**: N/A. A registry holds a handful of entries; each command touches at most 3 client files plus project files on record.

**Constraints**: never clobber or lose user config content (FR-008, SC-003); no secret values and no real entries in the repo (FR-002, FR-003, FR-014); `status` is read-only (FR-009); URL probe timeout 3 s per server.

**Scale/Scope**: ~10s of entries; 3 clients + N Codex project files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so the rules in `AGENTS.md` are the principles (as `AGENTS.md` says).

| Rule (AGENTS.md) | How this plan meets it | Status |
|---|---|---|
| Spec before code; spec updated when behavior changes | Spec 008 clarified; plan adds no behavior beyond it | Pass |
| Go: RE2, no lookahead; TOML parsed by lines | Reuses `splitTOMLSection` / `parseTOMLString` / `parseTOMLStringArray` from `cli/config` | Pass |
| Config writers never clobber: refuse unparsable, atomic write, `0600` | Reuses `readJSONObject` (refuses invalid JSON), `writeFileAtomic`; Codex section edit keeps every key hmcp does not own (research D4) | Pass |
| Cross-platform paths, no personal paths | `os.UserHomeDir`, `filepath`; placeholders only | Pass |
| New code in `cli/config/` and `cli/cmd/` has tests with `t.TempDir()` + `HOME`/`USERPROFILE` | Planned test files below | Pass |
| Security: no secrets logged or stored; validate client-supplied values | Env *names* only (`NAME=VALUE` refused), URLs with userinfo refused, name regex, argv never passed to a shell | Pass |
| Least privilege | Touches only entries it manages; adoption and `--replace` are explicit and reported | Pass |
| Tool parity across Node servers | No Node server change (CLI-only feature) | N/A |
| Loop safety (spec 006 FR-026) | Registered servers are non-bridge servers; `shared/mcp-scope.js` already drops them in nested agents unless `H0WZY_MCP_USER_SERVERS=1` | Pass |

Post-design re-check (after Phase 1): unchanged, all pass. No violations, so Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/008-mcp-server-registry/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0: decisions D1–D11
├── data-model.md        # Phase 1: registry file, destinations, states
├── quickstart.md        # Phase 1: end-to-end validation
├── contracts/
│   └── cli.md           # Phase 1: `hmcp registry` command contract
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
cli/
├── config/
│   ├── registry.go            # NEW: entry type, load/save, validation, warnings
│   ├── registry_clients.go    # NEW: per-client read/render/merge/remove; apply, remove, status engine
│   ├── registry_test.go       # NEW
│   ├── registry_clients_test.go # NEW
│   └── bridges.go             # CHANGED: extract parseCodexServers (adds `url`), reused by codexBridgeEdges
└── cmd/
    ├── registry.go            # NEW: `hmcp registry` add|update|remove|list|apply|status
    └── registry_test.go       # NEW
README.md                      # CHANGED: short "Your own MCP servers" section, placeholders only
AGENTS.md                      # CHANGED: mention the registry in the layout table
```

**Structure Decision**: Everything lives in the existing Go CLI. Store and client logic go in `cli/config` next to the writers they reuse; the cobra command is a thin layer in `cli/cmd`, like `install.go`. No Node change.

## Complexity Tracking

No Constitution Check violations.
