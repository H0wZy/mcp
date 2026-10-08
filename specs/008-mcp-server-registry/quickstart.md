# Quickstart: validate the MCP server registry (spec 008)

Run these on a machine with Claude Code, Codex and Antigravity installed. Use a throwaway name (`my-server`) and a URL or command you control. Do not paste real entries into issues, PRs or docs (FR-014).

## Prerequisites

```bash
go build -o dist/hmcp ./cli
go test ./cli/...               # unit tests cover every case below without real clients
```

Back up the four client files first (`~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/config/mcp_config.json`, and any project `.codex/config.toml` you will use).

## 1. Register a URL server (US1, FR-004, FR-012, FR-015)

```bash
hmcp registry add my-server --url http://<host>:<port>/my-server/mcp
```

Expect: three `✓ written` lines and the Antigravity notice. Then `claude mcp list`, `codex mcp list` and Antigravity's MCP list each show `my-server`. `~/.h0wzy-mcp/registry.json` exists with mode `0600` (POSIX).

## 2. Register a command server (US1-2)

```bash
hmcp registry add my-local-server --env MY_SERVER_TOKEN -- node <path>/server.js --stdio
```

Expect: each client starts the command; the Codex section has `env_vars = ["MY_SERVER_TOKEN"]`. `hmcp registry add x --env A=b -- cmd` is refused.

## 3. Move a server (US2, SC-001)

```bash
hmcp registry update my-local-server -- node <new path>/server.js --stdio
```

Expect: every client entry shows the new path; no stale copy; extra keys you added by hand (for example `env` in `~/.claude.json`) are still there (SC-003).

## 4. Drift and status (US3, FR-009, SC-004)

Hand-edit the `url` of `my-server` in `~/.codex/config.toml`, then:

```bash
hmcp registry status
```

Expect: `codex differs (url)`, other clients `in sync`, exit code `1`, and no file modified (compare timestamps). Stop the server and re-run: `unreachable`. `hmcp registry apply` restores the Codex entry.

## 5. Conflict and adoption (FR-007)

Add by hand a `my-other` entry to one client pointing elsewhere, then `hmcp registry add my-other --url http://<host>:<port>/my-other/mcp`. Expect `conflict` for that client and its entry unchanged. Re-run `hmcp registry apply my-other --replace`: now `written`. Repeat with a hand entry that has the same URL: expect `adopted`.

## 6. Antigravity environment (research D3)

With `my-local-server` applied, check that the server started by Antigravity sees `MY_SERVER_TOKEN` (set in the shell that started Antigravity). If it does not, record it in research D3 before release.

## 7. Codex project scope (US4, FR-005)

```bash
cd <a trusted project>
hmcp registry apply my-server --codex-project
```

Expect: `<project>/.codex/config.toml` gains `[mcp_servers.my-server]`; `~/.codex/config.toml` is unchanged. Codex loads project config only in trusted projects.

## 8. Remove (US2-2, FR-006)

```bash
hmcp registry remove my-server
hmcp registry remove my-local-server
```

Expect: the managed entries vanish from every client and the project file; hand-made entries with other names stay byte-identical.

## 9. Refusals and warnings (FR-008, FR-010, FR-011)

- `hmcp registry add codex --url …` → refused (reserved).
- Break `~/.gemini/config/mcp_config.json` (invalid JSON) and run `apply` → Antigravity reported `unreadable`, the other clients still updated, the broken file untouched.
- `--url http://<host>:<port>/other` → accepted with a path-convention warning; a second entry on the same host+path → shared-endpoint warning.
- `H0WZY_MCP_REGISTRY=<a path inside a git repo>/registry.json hmcp registry list` → warning that the registry sits in a git work tree.

## 10. Privacy check (SC-005)

```bash
git grep -nE '<your real host>|<your real server names>' -- . ':!specs/008-mcp-server-registry/quickstart.md'
```

Expect: no match in the repository.
