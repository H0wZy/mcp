# Quickstart: Validate the Agent Team Orchestrator

## A. Automated (fake agents, CI)

```bash
npm test            # shared/test/team-*.test.js (engine) + test/team.e2e.test.js (server + fake agents)
go test ./cli/...   # hmcp install team: server entries + skill copies + doctor
```

| Check | Where | Criterion |
|---|---|---|
| Spawn returns before the teammate finishes | team.e2e | SC-002, US1 |
| 6 tasks with dependencies and 3 self-claiming teammates: no double claims, nothing left in progress | team-scheduler | SC-001, US2 |
| `team_wait` returns within 1 s of an event; one wait per event | team.e2e | SC-003, US3 |
| A long result is capped, and the full text is readable through `team_result` | team.e2e | SC-008, FR-012a |
| Messages reach the next turn, labeled; an unknown name lists the valid ones | team-scheduler | US5 |
| Turn limits per member and per team, deadline, `[limit]` events | team-scheduler | US6, SC-005 |
| `team_create` refused inside a chain (teammate) | team.e2e | FR-017, SC-007 |
| Shutdown kills running turns; nothing is left running | team.e2e | FR-005 |
| Worktree isolation and the change set | team-isolation (needs git) | US7 |
| A failing check sends the task back; a passing check completes it | team-scheduler | US8 |
| Exact teammate argv per vendor (read-only vs edit, resume) | team-adapters | contracts |

## B. Manual, real agents

1. `go build -o dist/hmcp ./cli`, then `dist/hmcp install team`, then `dist/hmcp doctor`. Expect the team server and the skill in every detected harness.
2. In Claude Code: `/agent-team Review shared/chain-guard.js with a Codex security reviewer (deep) and an Antigravity architect (balanced); summarize their findings.` Expect two spawns that return right away, `team_wait` events with compact results, and a final synthesis.
3. In Codex: `$agent-team` with the same request, using Antigravity and Claude teammates. In Antigravity: `/agent-team`.
4. Plain language in any harness: "Put Codex and Antigravity on this so you don't spend your own tokens: …". The skill should load on its own.
5. Limits: set `H0WZY_TEAM_MAX_TOTAL_TURNS=2` and ask for 3 teammates. Expect a `[limit]` event.
