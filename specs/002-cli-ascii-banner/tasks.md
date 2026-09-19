# Tasks: CLI ASCII Banner & Visual Identity

**Feature**: `002-cli-ascii-banner`  
**Date**: 2026-09-19  
**Spec**: [specs/002-cli-ascii-banner/spec.md](file:///c:/Users/h0wzy/projects/mcp/specs/002-cli-ascii-banner/spec.md)  
**Plan**: [specs/002-cli-ascii-banner/plan.md](file:///c:/Users/h0wzy/projects/mcp/specs/002-cli-ascii-banner/plan.md)  

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify terminal libraries and test framework

- [X] T001 Verify terminal libraries and test framework in cli/go.mod

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core terminal detection utilities that MUST be completed before visual stories

- [X] T002 Implement TTY detection and terminal width extraction helper in cli/ui/banner.go
- [X] T003 [P] Implement compact single-line fallback header in cli/ui/banner.go

---

## Phase 3: User Story 1 - Claude Code Style Blocky Typography (Priority: P1) 🎯 MVP

**Goal**: Render chunky, blocky, square 3D drop-shadow ASCII banner for `H0wZy MCP` inspired by Claude Code CLI logo aesthetic with a distinctive slashed zero (`0`).

**Independent Test**: Interactive CLI launch displays the styled blocky ASCII banner followed by version and agent bridges.

### Tests for User Story 1
- [X] T004 [P] [US1] Create unit test for Claude Code style blocky typography properties in cli/ui/banner_test.go

### Implementation for User Story 1
- [X] T005 [US1] Design and implement 3D blocky square ASCII art constant for 'H0wZy MCP' in cli/ui/banner.go
- [X] T006 [US1] Configure modern cyan and emerald Lipgloss styles for banner and metadata in cli/ui/banner.go
- [X] T007 [US1] Connect PrintBanner into interactive CLI setup flow in cli/ui/tui.go

---

## Phase 4: User Story 2 - Clean Automation & Pipeline Redirection Safety (Priority: P2)

**Goal**: Suppress banner completely when stdout is redirected or piped.

**Independent Test**: Running CLI with redirected stdout produces 0 banner bytes and 0 ANSI escape sequences.

### Tests for User Story 2
- [X] T008 [P] [US2] Add unit test for non-TTY output suppression in cli/ui/banner_test.go

### Implementation for User Story 2
- [X] T009 [US2] Implement non-TTY suppression guard in renderBanner in cli/ui/banner.go

---

## Phase 5: User Story 3 - Responsive Viewport Adaptation & NO_COLOR (Priority: P3)

**Goal**: Automatically switch to compact header on narrow terminals (< 80 cols) and respect `NO_COLOR`.

**Independent Test**: Resizing terminal < 80 cols or passing width=50 renders single-line compact header without wrapping.

### Tests for User Story 3
- [X] T010 [P] [US3] Add unit tests for narrow terminal and undetectable width fallbacks in cli/ui/banner_test.go

### Implementation for User Story 3
- [X] T011 [US3] Implement responsive width threshold check in renderBanner in cli/ui/banner.go

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verification, build validation, and documentation updates

- [X] T012 Run full Go test suite across cli/... to verify 100% pass rate
- [X] T013 Verify standalone binary build and manual redirection testing
- [X] T014 Update walkthrough documentation and commit changes

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: Completed.
- **Foundational (Phase 2)**: Completed.
- **User Story 1 (Phase 3)**: Completed.
- **User Story 2 (Phase 4)**: Completed.
- **User Story 3 (Phase 5)**: Completed.
- **Polish (Phase 6)**: Completed.

### Parallel Opportunities
- T003, T004, T008, and T010 developed and verified in parallel.
