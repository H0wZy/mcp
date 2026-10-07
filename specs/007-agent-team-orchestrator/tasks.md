---
description: "Tasks for 007 Multi-Vendor Agent Team Orchestrator"
---

# Tasks: Multi-Vendor Agent Team Orchestrator

**Input**: `specs/007-agent-team-orchestrator/` (plan.md, research.md §8, data-model.md, contracts/)

**Tests**: Required. The success criteria are test-defined, and fake agents are used throughout.

---

## Phase 1: Setup

- [x] T001 Create the `servers/team/` package (`package.json` 1.0.6 with a `@h0wzy/mcp-shared` dependency, `bin/cli.js`, `src/index.js`, `README.md`). Add it to the CI syntax checks and the publish loop.
- [x] T002 [P] Add a `FAKE_AGENT_MODE=teammate` mode to `test/helpers/fake-agent.js`: it answers with a scripted `team-report` block chosen by turn (`FAKE_TEAM_SCRIPT` JSON: per agent, a list of replies; supports `sleep_ms`, long text and file edits).

## Phase 2: Foundational (shared/team engine)

- [x] T003 `shared/team/store.js`: state paths (project key), atomic JSON writes, `owner.json` lock (live pid → read-only), event log append, result files.
- [x] T004 [P] `shared/team/tasks.js`: create a batch (ids, dependency validation, cycle detection with the cycle named), availability, claim, transitions, a compact one-line format.
- [x] T005 [P] `shared/team/report.js`: parse the last `team-report` block (with the json fallback), validate fields, strip the block from the answer, build the compact summary within the cap.
- [x] T006 `shared/team/adapters.js`: for claude, codex and antigravity, `buildTurn({ member, prompt, hop, settings })` → `{ command, args, input, cwd, outputFile? }` and `parseTurn(res, files)` → `{ text, sessionId?, usage? }`, per research D2.
- [x] T007 `shared/team/scheduler.js`:
  - `Team` class: members, mailboxes, limits;
  - wake rules (D4), the turn runner (a hop per turn, injectable runner for tests);
  - report application (contract table), events and a `wait(timeoutMs)` promise;
  - shutdown with grace; checks (D8); ownership (D7).
- [x] T008 Write unit tests: `shared/test/team-tasks.test.js`, `team-report.test.js`, `team-adapters.test.js` (exact argv per vendor and mode), `team-scheduler.test.js` (injected runner).

## Phase 3: US1–US3 (P1): spawn, task list, wait 🎯 MVP

- [x] T009 [US1] `servers/team/src/index.js`: `team_create`, `team_spawn`, `team_status`, `team_wait`, `task_create`, `task_update`, `task_list`, `team_result`. Include the nested-call guard (FR-017) and the developer ceilings from env.
- [x] T010 [US1] Write `test/team.e2e.test.js`:
  - the server runs as a process with fake agents;
  - spawn returns at once;
  - two teammates run in parallel;
  - wait returns the idle event with the compact result;
  - `team_result` pages.
- [x] T011 [US2] Scheduler tests: 6 tasks with dependencies and 3 self-claimers; no double claim; nothing left `in_progress`; a dependency cycle is refused.

## Phase 4: US4 (P1): skill in every harness

- [x] T012 [US4] `cli/skills/agent-team/SKILL.md`, done with the plan. Add a Node test that checks its frontmatter (`name`, `description`) and that it names every team tool and each harness trigger.
- [x] T013 [US4] Go: `hmcp install|remove team`, the skill copies, list and doctor (contracts/installer-team.md), done by the Go agent.

## Phase 5: US5–US6 (P2): messaging and limits

- [x] T014 [US5] `team_message` and teammate-to-teammate messages from reports. Labeled "from another agent". An idle member wakes within its budget. Unknown names are rejected with the valid list.
- [x] T015 [US5] Session continuity: Claude `--session-id` / `--resume`, Antigravity `--conversation`, Codex history carry-over. Covered by the adapter tests.
- [x] T016 [US6] Limits: per-member and team turns, deadline, team size, `[limit]` events. `team_shutdown` (grace, kill). The server's own shutdown stops every teammate.

## Phase 6: US7–US8 (P3)

- [x] T017 [US7] Worktree isolation for editing teammates, `team_changes`, and the ownership check. The test is skipped when `git` is missing.
- [x] T018 [US8] Completion checks (argv, no shell, 10-minute limit): a failure goes back to the teammate; with no turns left the task fails.

## Phase 7: Polish

- [ ] T019 Docs: README (team section, skill triggers, limits), `servers/team/README.md`, AGENTS.md layout and roadmap.
- [ ] T020 Run `npm test` and `go test ./cli/...`, then trigger CI on all 3 OSes.

## Dependencies

- T003–T006 → T007 → T009.
- T002 → T010 and T011.
- T013 runs in parallel (Go agent).
- T014–T018 extend T007 and T009.
