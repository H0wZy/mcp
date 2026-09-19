# Implementation Tasks: Multi-Agent MCP Hub & Go CLI

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Architecture**: [architecture.html](architecture.html)

This document contains all actionable, dependency-ordered tasks required to implement the H0wZy/mcp ecosystem.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, workspaces, and toolchain configurations.

- [ ] T001 Initialize npm monorepo workspaces and shared package structure in package.json
- [ ] T002 [P] Initialize Go module and cobra/huh dependencies in cli/go.mod
- [ ] T003 [P] Configure shared packaging and exports in shared/package.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure and reusable MCP protocol engine that MUST be complete before ANY user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this foundational phase is complete.

- [ ] T004 [P] Implement platform-agnostic executable resolver (`resolveBinary`, `candidateNames`, `PATHEXT`) in shared/resolver.js
- [ ] T005 [P] Implement child process execution helper with timeouts and buffered output in shared/executor.js
- [ ] T006 Implement generic JSON-RPC 2.0 stdio MCP server runner (`createMcpServer`) in shared/server.js
- [ ] T007 [P] Implement unified exports in shared/index.js
- [ ] T008 Implement unit and protocol verification tests for shared engine in shared/test/server.test.js

**Checkpoint**: Foundational engine ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Cross-Model Verification & Server Bridges (Priority: P1) 🎯 MVP

**Goal**: Enable host agents (Claude Code, OpenAI Codex) to request independent code reviews and second opinions from peer model families over stdio.

**Independent Test**: Run stdio JSON-RPC tool calls against `servers/antigravity` and `servers/codex` and confirm both servers return valid tool definitions and model responses without errors.

### Implementation for User Story 1

- [ ] T009 [P] [US1] Implement Google Antigravity tool schema and CLI runner (`ask_antigravity`) in servers/antigravity/src/index.js
- [ ] T010 [P] [US1] Implement Antigravity executable entrypoint and direct Node runner in servers/antigravity/bin/cli.js
- [ ] T011 [P] [US1] Configure Antigravity server package manifests and attribution notices in servers/antigravity/package.json and servers/antigravity/NOTICE
- [ ] T012 [P] [US1] Implement OpenAI Codex CLI tool schemas (`ask_codex`, `review_codex`) and runner in servers/codex/src/index.js
- [ ] T013 [P] [US1] Implement Codex executable entrypoint and direct Node runner in servers/codex/bin/cli.js
- [ ] T014 [P] [US1] Configure Codex server package manifests and attribution notices in servers/codex/package.json and servers/codex/NOTICE
- [ ] T015 [US1] Verify end-to-end JSON-RPC stdio tool calls for both Antigravity and Codex servers in test/stdio-verification.test.js

**Checkpoint**: User Story 1 is fully functional and testable as an independent MVP.

---

## Phase 4: User Story 2 - Interactive Go CLI & Auto-Configuration (Priority: P2)

**Goal**: Provide an interactive terminal tool that auto-detects local CLIs (`claude`, `codex`, `agy`), verifies health, and writes zero-config direct Node paths to user configuration files.

**Independent Test**: Launch `go run ./cli` on Windows/macOS/Linux; verify that installed CLIs are discovered, checklist allows toggling bridges, and target config files (`~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/config/mcp_config.json`) are updated cleanly.

### Implementation for User Story 2

- [ ] T016 [P] [US2] Implement CLI binary detector for Claude, Codex, and Antigravity in cli/detector/detector.go
- [ ] T017 [P] [US2] Implement health probe and ping verifiers for detected CLIs in cli/detector/health.go
- [ ] T018 [P] [US2] Implement Claude Code configuration reader and writer (`~/.claude.json` and `.mcp.json`) in cli/config/claude.go
- [ ] T019 [P] [US2] Implement OpenAI Codex configuration reader and writer (`~/.codex/config.toml`) in cli/config/codex.go
- [ ] T020 [P] [US2] Implement Antigravity configuration reader and writer (`~/.gemini/config/mcp_config.json`) in cli/config/antigravity.go
- [ ] T021 [US2] Implement interactive TUI checklist and confirmation screens using `huh` in cli/ui/tui.go
- [ ] T022 [P] [US2] Implement `doctor` command displaying diagnostic status table in cli/cmd/doctor.go
- [ ] T023 [P] [US2] Implement `install` command supporting `--all` and `--scope` flags in cli/cmd/install.go
- [ ] T024 [P] [US2] Implement `list` command showing installed and available bridges in cli/cmd/list.go
- [ ] T025 [P] [US2] Implement `remove` command to unregister bridges cleanly in cli/cmd/remove.go
- [ ] T026 [US2] Implement root CLI command with interactive TUI auto-launcher in cli/cmd/root.go and cli/main.go
- [ ] T027 [US2] Verify Go CLI compilation and run detector tests via `go test ./cli/...` in cli/detector/detector_test.go

**Checkpoint**: User Stories 1 and 2 are fully integrated; users can install and configure all servers with zero manual edits.

---

## Phase 5: User Story 3 - Resilient Quota & Provider Degradation Fallback (Priority: P3)

**Goal**: Catch HTTP 429, ResourceExhausted, and authentication errors from external model providers, delivering actionable formatted notices with `{ isError: true }` without crashing the host agent session.

**Independent Test**: Trigger simulated 429 / authentication errors and verify that host tool calls return cleanly formatted markdown warnings allowing the host agent to continue reasoning autonomously.

### Implementation for User Story 3

- [ ] T028 [P] [US3] Implement HTTP 429, ResourceExhausted, and rate-limit pattern detectors in shared/errors.js
- [ ] T029 [P] [US3] Implement authentication and expired session detector in shared/errors.js
- [ ] T030 [US3] Implement non-fatal `{ isError: true, content: [...] }` response formatter in shared/errors.js
- [ ] T031 [US3] Integrate resilience boundary into Antigravity server execution in servers/antigravity/src/index.js
- [ ] T032 [US3] Integrate resilience boundary into Codex server execution in servers/codex/src/index.js
- [ ] T033 [US3] Add unit tests simulating 429 and authentication errors to verify non-crashing output in test/resilience.test.js

**Checkpoint**: All user stories are complete, verified, and hardened against rate limits.

---

## Phase 6: Polish, Distribution & Packaging

**Purpose**: Cross-cutting improvements, npm/npx distribution, GoReleaser, and CI automation.

- [ ] T034 [P] Implement npm/npx runner wrapper in npm/bin/h0wzy-mcp.js and npm/package.json
- [ ] T035 [P] Create multi-platform GoReleaser configuration in .goreleaser.yaml
- [ ] T036 [P] Configure GitHub Actions CI workflow for cross-platform testing in .github/workflows/ci.yml
- [ ] T037 Update central README.md with usage examples, TUI screenshots/guides, and architecture links
- [ ] T038 Run end-to-end quickstart validation scenarios according to specs/001-multi-agent-mcp-hub/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Setup (Phase 1)
       │
       ▼
Foundational Engine (Phase 2) ──► BLOCKS all User Stories
       │
       ├────────────────────────────────────────┐
       ▼                                        ▼
User Story 1: Bridges (Phase 3) [MVP]    User Story 2: Go CLI (Phase 4)
       │                                        │
       └───────────────────┬────────────────────┘
                           ▼
            User Story 3: Resilience (Phase 5)
                           │
                           ▼
            Polish & Packaging (Phase 6)
```

- **Phase 1 (Setup)**: Can start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1; blocks all User Stories.
- **Phase 3 (US1 - Bridges)**: Depends on Phase 2. Forms the standalone MVP.
- **Phase 4 (US2 - Go CLI)**: Depends on Phase 2; can develop in parallel with US1.
- **Phase 5 (US3 - Resilience)**: Integrates into US1 bridges.
- **Phase 6 (Polish & CI)**: Depends on completion of all stories.

### Parallel Opportunities

- **Phase 1**: T002 (Go mod) and T003 (shared package.json) can run in parallel.
- **Phase 2**: T004 (resolver) and T005 (executor) can run in parallel.
- **Phase 3 (US1)**: Antigravity bridge (T009–T011) and Codex bridge (T012–T014) can run in parallel.
- **Phase 4 (US2)**: Config writers (T018, T019, T020) and command handlers (T022–T025) can run in parallel.
- **Phase 6**: T034 (npm wrapper), T035 (GoReleaser), and T036 (CI workflow) can run in parallel.

---

## Implementation Strategy

### MVP First (Phases 1, 2, and 3)
1. Complete Phase 1 (Setup) and Phase 2 (Foundational engine).
2. Complete Phase 3 (Antigravity and Codex server bridges).
3. **Validate MVP**: Test stdio tool calls directly with Node.

### Incremental Delivery
1. Add Phase 4 (Go CLI TUI and auto-detectors) for zero-config user experience.
2. Add Phase 5 (Resilience boundary) for robust production handling of HTTP 429.
3. Add Phase 6 (npm wrapper, GoReleaser, CI) for public community distribution.
