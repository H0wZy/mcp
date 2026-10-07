# Data Model: Agent Team Orchestrator

State dir: `<H0WZY_MCP_STATE_DIR or ~/.h0wzy-mcp>/teams/<project-key>/<team>/`. The project key is `<folder-name>-<first 10 hex of sha256(absolute path)>`.

## Team (`team.json`)

| Field | Type | Notes |
|---|---|---|
| `name` | string `^[a-z][a-z0-9-]{0,31}$` | Unique per project |
| `cwd` | absolute path | Project folder; the default work folder |
| `host` | string | Agent leading the team (from `--host`) |
| `createdAt`, `deadline` | epoch ms | deadline = created + `deadlineMinutes` |
| `limits` | {maxTeammates, maxTurnsPerTeammate, maxTotalTurns, deadlineMinutes, resultCap, turnMinutes} | The lower of the developer ceiling and the lead's value |
| `selfClaim` | bool | default true |
| `turnsUsed` | int | team total |
| `members` | Member[] | |
| `nextTaskNumber` | int | for `T<n>` ids |

## Member

| Field | Type | Notes |
|---|---|---|
| `name` | string | Unique in the team. `lead` is reserved |
| `agent` | `claude` \| `codex` \| `antigravity` | |
| `role` | string ≤ 4,000 chars | |
| `model`, `effort`, `tier` | strings | Resolved through that vendor's spec-005 config at spawn |
| `canEdit` | bool | |
| `isolation` | `none` \| `worktree` | |
| `workDir` | absolute path | `cwd`, or the worktree path |
| `owns` | string[] | Declared file prefixes (relative to `workDir`) |
| `state` | `idle` \| `working` \| `stopping` \| `stopped` \| `failed` | |
| `turns`, `maxTurns` | int | |
| `currentTask` | task id \| null | |
| `sessionId` | string \| null | Claude session uuid, or Antigravity conversation id |
| `history` | [{turn, task, status, summary}] | The last 10 entries, used for Codex carry-over |
| `mailbox` | [{from, text, at}] | Undelivered messages. Mail wakes an idle member |
| `notes` | [{from, text, at}] | Notices for the next turn (e.g. a bounced message). Notes don't wake the member |
| `usage` | {costUsd, inputTokens, outputTokens} | Summed when the agent reports them |
| `lastError` | string \| null | |

State transitions:
- `idle → working`: the scheduler starts a turn.
- `working → idle`: the turn ended with a report.
- `working → failed`: crash, timeout, auth or quota error.
- `* → stopping → stopped`: shutdown.
- `failed | stopped → idle`: `team_spawn` again with the same name revives the member and keeps its history.

## Task (`tasks.json`)

| Field | Type | Notes |
|---|---|---|
| `id` | `T<n>` or a lead-chosen id `^[A-Za-z0-9_-]{1,32}$` | unique |
| `title` | string ≤ 200 | |
| `description` | string ≤ 8,000 | |
| `status` | `pending` \| `in_progress` \| `blocked` \| `completed` \| `failed` \| `cancelled` \| `unreported` | `blocked` resumes on a message to its assignee or a lead `task_update` |
| `assignee` | member name \| null | |
| `dependsOn` | ids | All must exist. A cycle is refused |
| `chain` (on Team) | {runId, agents: ["team"], depth: 0, deadline} | The team's spec-006 root chain. Every turn is a hop of it, and teammates' bridges share its call budget |
| `check` | argv string[] \| null | |
| `result` | {summary, ref} \| null | |
| `note` | string \| null | Reason for failed, blocked or unreported |
| `updatedAt` | epoch ms | |

**Available** means: `pending`, every dependency `completed`, and either unassigned or assigned to the asking member.

**Claim** means: `pending → in_progress` with the assignee set, inside the scheduler's single-threaded section.

## Message

{`from`, `to`, `text` ≤ 4,000, `at`}. `to: "lead"` becomes a lead event. Any other `to` goes to that member's mailbox.

## Event (`events.jsonl`)

{`seq`, `at`, `type` ∈ idle|failed|task|message|limit|unreported|check|ownership|stopped, `member?`, `task?`, `text`, `ref?`}. The lead's read position (`leadSeq`) lives in memory. A newly loaded team starts at the end.

## Turn result (`results/<member>-<n>.md`)

The visible answer, with the report block removed and secrets redacted with `sanitizeOutput`. `ref` = `<member>#<n>`.
