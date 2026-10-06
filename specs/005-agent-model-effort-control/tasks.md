# Tasks: Agent Model & Reasoning-Effort Control

**Feature Directory**: `specs/005-agent-model-effort-control` | **Date**: 2026-10-05

**Implementation Strategy**: Incremental MVP delivery across 4 user stories (State Machine & Task Tools → Catalog Discovery & Validation → Autonomy Tiers & Descriptions → Developer Ceilings & Polish).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare shared exports, module stubs, and unit test scaffold.

- [x] T001 Create `shared/agent-config.js` module scaffold and re-export from `shared/index.js`
- [x] T002 [P] Create unit test scaffold in `shared/test/agent-config.test.js`

---

## Phase 2: Foundational (Core Configuration Engine)

**Purpose**: Core state machine, effort mapping, input sanitization, and snapshot mechanics that all user stories depend on.

**⚠️ CRITICAL**: Must be completed and verified before any MCP server integration can begin.

- [x] T003 Implement shared effort vocabulary (`low`..`ultra`) and mapping algorithm in `shared/agent-config.js`
- [x] T004 Implement input validation regex `^[A-Za-z0-9._-]{1,64}$` to prevent shell injection in `shared/agent-config.js`
- [x] T005 Implement `createAgentConfig` state machine closure with `get`, `set`, `reset`, and immutable `resolveCall` snapshots in `shared/agent-config.js`
- [x] T006 Implement standardized execution footer generator (`formatFooter`) in `shared/agent-config.js`
- [x] T007 Run unit tests verifying foundational state machine and mapping in `shared/test/agent-config.test.js`

**Checkpoint**: Foundation ready - MCP server integration and user stories can now proceed.

---

## Phase 3: User Story 1 - Claude Code changes model & effort on request (Priority: P1) 🎯 MVP

**Goal**: Claude Code can explicitly set model and effort on an agent for the session, execute tasks with the new settings, pass one-off per-call overrides, reset defaults, and see verified settings in every execution footer. Fix `review_codex` parameter passing.

**Independent Test**: Call `configure_codex` with `set` (`model: "gpt-6-astra"`, `effort: "high"`), call `ask_codex` without model, and verify response footer confirms `model=gpt-6-astra` and `effort=high`.

### Tests for User Story 1

- [x] T008 [P] [US1] Add unit tests for session persistence, per-call override isolation, and reset behavior in `shared/test/agent-config.test.js`
- [x] T009 [P] [US1] Add stdio protocol tests for `configure_antigravity` and `configure_codex` in `test/stdio-verification.test.js`

### Implementation for User Story 1

- [x] T010 [US1] Implement `configure_antigravity` tool (`get`, `set`, `reset`) in `servers/antigravity/src/index.js`
- [x] T011 [US1] Update all 5 Antigravity task tools (`ask`, `review`, `brainstorm`, `plan`, `delegate`) to accept `effort`, use session defaults, and append execution footers in `servers/antigravity/src/index.js`
- [x] T012 [US1] Refactor `executeCodexCommand` in `servers/codex/src/index.js` to pass model and effort via `-c model=... -c model_reasoning_effort=...`, fixing the fatal argument rejection in `review_codex`
- [x] T013 [US1] Implement `configure_codex` tool (`get`, `set`, `reset`) in `servers/codex/src/index.js`
- [x] T014 [US1] Update all 5 Codex task tools (`ask`, `review`, `brainstorm`, `plan`, `delegate`) to accept `effort`, use session defaults, and append execution footers in `servers/codex/src/index.js`

**Checkpoint**: At this point, User Story 1 delivers a fully working MVP where model and effort can be changed and inspected dynamically across both servers.

---

## Phase 4: User Story 2 - Discover valid options and current state (Priority: P1)

**Goal**: Claude Code can inspect active settings, supported effort levels, and the model catalog via `get` and `list` actions, backed by lazy catalog loading and resilient 5s fallback to curated lists.

**Independent Test**: Call `configure_antigravity` and `configure_codex` with `action: "list"` and verify models and supported efforts are returned without blocking.

### Tests for User Story 2

- [x] T015 [P] [US2] Add unit tests for curated catalog fallback, 5s timeout handling, and fuzzy suggestions in `shared/test/agent-config.test.js`

### Implementation for User Story 2

- [x] T016 [US2] Implement curated fallback model catalogs for Antigravity (18 variants) and Codex (visible models) in `shared/agent-config.js`
- [x] T017 [US2] Implement lazy, non-blocking CLI catalog loaders (`agy models` and `codex debug models`) with 5s timeout and memory cache in `shared/agent-config.js`
- [x] T018 [US2] Implement fuzzy model matching and closest alternative suggestions for invalid inputs in `shared/agent-config.js`
- [x] T019 [US2] Wire `action: "list"` in `configure_antigravity` in `servers/antigravity/src/index.js`
- [x] T020 [US2] Wire `action: "list"` in `configure_codex` in `servers/codex/src/index.js`

**Checkpoint**: User Stories 1 AND 2 are complete. Claude Code can discover options and configure valid models reliably.

---

## Phase 5: User Story 3 - Claude Code picks the right weight on its own (Priority: P2)

**Goal**: Claude Code can autonomously pick task difficulty tiers (`light`, `balanced`, `deep`) based on clear guidance embedded in tool descriptions and accurate default model references.

**Independent Test**: Call `configure_antigravity` with `{ action: "set", tier: "deep" }` and verify settings resolve to `gemini-3.8-flash` at `high` effort.

### Tests for User Story 3

- [x] T021 [P] [US3] Add unit tests for tier resolution (`light`, `balanced`, `deep`) and explicit overrides over tier defaults in `shared/test/agent-config.test.js`

### Implementation for User Story 3

- [x] T022 [US3] Implement tier resolution engine (`light`, `balanced`, `deep`) mapping to models and efforts per provider in `shared/agent-config.js`
- [x] T023 [US3] Update tool descriptions in `servers/antigravity/src/index.js` with task-to-tier decision guidance and fix references to current default model (`Gemini 3.8 Flash (High)`)
- [x] T024 [US3] Update tool descriptions in `servers/codex/src/index.js` with task-to-tier decision guidance

**Checkpoint**: Claude Code possesses full autonomous tier switching capabilities backed by rich tool documentation.

---

## Phase 6: User Story 4 - Developer sets limits and tier mappings (Priority: P3)

**Goal**: Developers can configure ceilings (`<PROVIDER>_MAX_EFFORT`, `<PROVIDER>_MAX_TIER`) and custom tier mappings (`<PROVIDER>_TIER_<NAME>`) via environment variables, ensuring Claude Code cannot exceed resource/quota budgets.

**Independent Test**: Set `CODEX_MAX_EFFORT=medium`, request `effort: "max"`, and verify configuration is clamped to `medium` with an explicit warning.

### Tests for User Story 4

- [x] T025 [P] [US4] Add unit tests for environment tier overrides and ceiling clamping in `shared/test/agent-config.test.js`

### Implementation for User Story 4

- [x] T026 [US4] Implement environment variable parsing for `<PROVIDER>_TIER_*` overrides in `shared/agent-config.js`
- [x] T027 [US4] Implement `<PROVIDER>_MAX_EFFORT` and `<PROVIDER>_MAX_TIER` ceiling enforcement and clamping warning generation in `shared/agent-config.js`
- [x] T028 [US4] Ensure ceilings apply universally to `set`, tier resolution, per-call overrides, and startup defaults in `shared/agent-config.js`

**Checkpoint**: Guardrail system fully active; developers retain strict budget control over autonomous agent escalations.

---

## Phase 7: Polish & Cross-Cutting Verification

**Purpose**: Comprehensive end-to-end integration tests, documentation updates, and regression validation.

- [x] T029 [P] Create end-to-end multi-agent test suite in `test/agent-control-e2e.test.js` covering all 7 quickstart scenarios
- [x] T030 Run full test suite: `node --test` across all unit, resilience, stdio, and e2e tests
- [x] T031 Update `README.md` with `configure_antigravity`, `configure_codex`, tier tables, environment ceilings, and updated tool counts (6 tools per server)
- [x] T032 Bump server package versions to `1.0.6` in `servers/antigravity/package.json` and `servers/codex/package.json`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - starts immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 - BLOCKS all user story work.
- **User Story 1 (Phase 3)**: Depends on Phase 2 - delivers core MVP.
- **User Story 2 (Phase 4)**: Depends on Phase 3 - adds discovery and resilient catalog loading.
- **User Story 3 (Phase 5)**: Depends on Phase 4 - adds autonomous tier routing and docs.
- **User Story 4 (Phase 6)**: Depends on Phase 5 - adds developer ceilings and custom tiers.
- **Polish (Phase 7)**: Depends on Phases 1–6.

### Parallel Opportunities

- `T002` (test scaffold) can run in parallel with `T001` (module scaffold).
- `T008` and `T009` (tests) can run in parallel with each other.
- `T010`/`T011` (Antigravity integration) can run in parallel with `T012`/`T013`/`T014` (Codex integration).
- `T015` (discovery tests) can be written in parallel with `T016` (catalog curation).
- `T021` (tier tests) and `T025` (ceiling tests) can be written in parallel with engine updates.
- `T029` (E2E test) can run in parallel with `T031` (README updates).

---

## Parallel Example: User Story 1 Implementation

```bash
# Parallel thread A: Antigravity server integration
Task: "T010 [US1] Implement configure_antigravity tool in servers/antigravity/src/index.js"
Task: "T011 [US1] Update all 5 Antigravity task tools with effort & footers in servers/antigravity/src/index.js"

# Parallel thread B: Codex server integration & fix
Task: "T012 [US1] Refactor executeCodexCommand to use -c config in servers/codex/src/index.js"
Task: "T013 [US1] Implement configure_codex tool in servers/codex/src/index.js"
Task: "T014 [US1] Update all 5 Codex task tools with effort & footers in servers/codex/src/index.js"
```

---

## Implementation Strategy

### MVP First (Phases 1, 2, and 3)
1. Complete Setup (`T001`-`T002`) and Foundation (`T003`-`T007`).
2. Implement User Story 1 (`T008`-`T014`).
3. **STOP and VALIDATE**: Verify that Claude Code can call `configure_*` to set model and effort, and that task tools immediately inherit and reflect those choices in their footers. Also verify that `review_codex` is fixed.

### Incremental Delivery
1. **MVP**: User Story 1 delivers explicit control over model & effort + fixes `review_codex`.
2. **Increment 2 (US2)**: Adds live discovery via `list` + fuzzy correction + 5s resilient fallback.
3. **Increment 3 (US3)**: Adds autonomous tiers (`light`, `balanced`, `deep`) with full guidance text.
4. **Increment 4 (US4)**: Adds developer ceiling protections and custom tier overrides.
5. **Final**: Polish, comprehensive E2E tests, documentation, and version bump.
