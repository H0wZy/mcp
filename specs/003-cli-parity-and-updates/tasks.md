# Tasks: CLI Parity, PATH Aliases, and Auto-Update Engine

**Feature Directory**: `specs/003-cli-parity-and-updates`

**Implementation Strategy**: MVP delivery in 3 prioritized user stories (Aliases → Versioning/Upgrade → Server Parity).

---

## Phase 1: Setup (Shared Configuration & Metadata)

**Purpose**: Update package metadata and prepare version 1.0.2.

- [x] T001 Update package bin entries in `npm/package.json` for `hmcp`, `hwzmcp`, and `h0wzy-mcp`
- [x] T002 Bump package version to `1.0.2` in `npm/package.json` and server packages

---

## Phase 2: Foundational (Version & Cache Engine)

**Purpose**: Core versioning and registry polling infrastructure required by all commands.

- [x] T003 [P] Create version metadata and semver comparison in `cli/version/version.go`
- [x] T004 [P] Implement registry query (npm/GitHub) and local 4h cache in `cli/version/cache.go`

---

## Phase 3: User Story 1 - Global Terminal Access via Frictionless Aliases (Priority: P1) 🎯 MVP

**Goal**: Allow developers to execute `hmcp`, `hwzmcp`, or `h0wzy-mcp` from any terminal.

**Independent Test**: Run `hmcp setup-path` and verify `hmcp doctor` works from any directory without error.

- [x] T005 [P] [US1] Implement `cli/cmd/setuppath.go` to link/copy executable shims to user PATH (`~/.local/bin`)
- [x] T006 [US1] Register `setup-path` subcommand in `cli/cmd/root.go`
- [x] T007 [US1] Update `npm/bin/h0wzy-mcp.js` to support all three binary aliases dynamically

---

## Phase 4: User Story 2 - Native Subcommands for Versioning and Upgrades (Priority: P1)

**Goal**: Support clean `hmcp version` and `hmcp upgrade` (or `update`) without `--` prefixes, plus update alerts.

**Independent Test**: Run `hmcp version` to see version/remote check and `hmcp upgrade` to trigger upgrade logic.

- [x] T008 [P] [US2] Implement `cli/cmd/version.go` for `hmcp version` subcommand and `-v` / `--version` flags
- [x] T009 [P] [US2] Implement `cli/cmd/upgrade.go` for `hmcp upgrade` with `update` alias
- [x] T010 [US2] Add update notification badge to interactive startup in `cli/ui/tui.go`

---

## Phase 5: User Story 3 - Full Feature Parity between Antigravity and Codex (Priority: P1)

**Goal**: Symmetrical 4-tool capabilities (`ask_*`, `review_*`, `brainstorm_*`, `plan_*`) on both servers.

**Independent Test**: Stdio JSON-RPC `tools/list` returns all 4 tools for both `antigravity` and `codex`.

- [x] T011 [P] [US3] Implement `review_antigravity`, `brainstorm_antigravity`, and `plan_antigravity` in `servers/antigravity/src/index.js`
- [x] T012 [P] [US3] Implement `brainstorm_codex` and `plan_codex` in `servers/codex/src/index.js`
- [x] T013 [US3] Update test assertions in `test/stdio-verification.test.js` to assert all 8 tools

---

## Phase 6: Polish & Cross-Cutting Verification

**Purpose**: End-to-end test validation, binary compilation, and documentation.

- [x] T014 Run full Go test suite: `go test -v ./cli/...`
- [x] T015 Run full Node.js stdio test suite: `node --test ./test/stdio-verification.test.js`
- [x] T016 Build local binaries and test `hmcp setup-path`
- [x] T017 Update project `README.md` with new aliases and subcommands documentation
