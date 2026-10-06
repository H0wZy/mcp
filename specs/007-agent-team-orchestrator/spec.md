# Feature Specification: Multi-Vendor Agent Team Orchestrator

**Feature Directory**: `specs/007-agent-team-orchestrator`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "The next feature is an open-source agent orchestrator. Today Claude Code can only send a message (ask) or dispatch one task to Antigravity or Codex. I want this project to do what Claude Code's Agent Teams does — a team lead that spawns teammates, a shared task list where teammates claim tasks, and teammates that communicate with each other — but with teammates from different vendors (Claude Code, Codex, Antigravity), in any direction, without infinite loops or runaway token spend. Equal to Agent Teams or better."

**Depends on**: `specs/005-agent-model-effort-control` (per-teammate model / effort), `specs/006-bidirectional-agent-mesh` (Claude Code bridge, chain context, loop guard).

---

## Context

Claude Code's Agent Teams (experimental) runs one **team lead** and several **teammates**, each with its own context. Teammates share a **task list** (pending → in progress → completed, with dependencies and safe claiming) and send each other messages through **mailboxes**. The lead creates tasks, assigns or lets teammates self-claim, and puts the results together. It has known limits: every teammate is a Claude instance, only Claude Code can lead, one team per session, no nested teams, task status can lag, and teammates are lost when the lead's session is resumed.

This hub can already reach three different model families. What it lacks is everything between "one blocking call" and "a team":

- every call blocks the caller until the other agent finishes;
- nothing runs in parallel in the background;
- there is no shared work list;
- the agents called have no memory between calls;
- there is no way for the agents called to talk to each other.

This feature adds a **vendor-neutral team orchestrator**: any of the three agents can lead, and teammates can be any mix of Claude Code, Codex and Antigravity.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Lead spawns a mixed-vendor team that works in the background (Priority: P1)

The developer tells their agent (the lead) something like "spawn three teammates: a Codex security reviewer on deep, an Antigravity architect on balanced, and a Claude test writer". The lead creates a team and spawns each teammate with a name, a role, an agent, and a tier / model / effort. Spawning returns right away. Teammates start working in the background while the lead stays free to keep talking to the developer.

**Why this priority**: Background, parallel, named teammates from different vendors are the core of the feature. With only this story, the developer already gets parallel cross-vendor work that the hub can't do today.

**Independent Test**: From Claude Code, create a team and spawn two teammates on different vendors, each with a short independent task. Check that both spawn calls return in seconds, that both teammates run at the same time, and that the lead can do other things while they run.

**Acceptance Scenarios**:

1. **Given** no team exists, **When** the lead creates a team and spawns a teammate with a name, agent, role and tier, **Then** the call returns within 3 seconds with the teammate's name and status `working`.
2. **Given** two teammates are spawned back to back, **When** both are working, **Then** they run at the same time, not one after the other.
3. **Given** a spawn asks for a tier, model or effort, **When** the teammate starts, **Then** it uses those settings, with the same validation, mapping and ceilings as spec 005.
4. **Given** the team has reached its teammate limit, **When** the lead tries to spawn another, **Then** the spawn is refused with a message naming the limit.

---

### User Story 2 - Shared task list with dependencies and safe claiming (Priority: P1)

The lead breaks the work into tasks. Each task has a title, a description, an optional assignee and optional dependencies on other tasks. A task is pending, in progress, completed, failed or cancelled. A task with unfinished dependencies can't be started. When a teammate finishes a task, any tasks waiting on it become available. Teammates can be assigned a task by the lead, or they can claim the next available task themselves when they finish one.

**Why this priority**: The task list is what turns several parallel calls into a coordinated team. It is also how the lead and the developer see progress.

**Independent Test**: Create 6 tasks where tasks 4–6 depend on tasks 1–3. Spawn 3 teammates in self-claim mode. Check that tasks 4–6 don't start before their dependencies are completed, that no task is ever claimed by two teammates, and that every task ends completed.

**Acceptance Scenarios**:

1. **Given** task B depends on task A, **When** A is not completed, **Then** B can't be claimed or assigned to start, and the reason is shown.
2. **Given** A is completed, **When** the task list is read, **Then** B is shown as available with no manual action.
3. **Given** two teammates try to claim the same task at the same moment, **When** both claims are processed, **Then** exactly one succeeds and the other gets the next available task or a "nothing available" answer.
4. **Given** a teammate's turn ends, **When** it reported the task as done (or as failed, with a reason), **Then** the task status changes on the spot. A task is never left "in progress" for a teammate that is no longer working.
5. **Given** a set of tasks whose dependencies would form a cycle, **When** the lead creates them, **Then** creation is refused with the cycle named.

---

### User Story 3 - Lead monitors, waits for and collects results (Priority: P1)

The lead can ask for the team's status at any moment: each teammate's state (working / idle / failed / stopped), current task, turns used, and the task list. The lead can wait for "the next thing that happens" (a teammate goes idle, a task completes, a message arrives, a teammate fails) with a timeout. It gets the event as soon as it happens, without polling in a tight loop. When a teammate goes idle, its final answer is delivered to the lead.

**Why this priority**: Without monitoring and results there is no way to finish the work. Waiting for events without polling is also what keeps the lead's own token use low.

**Independent Test**: Spawn one teammate with a task that takes about 1 minute. Have the lead wait with a 5-minute timeout. Check that the wait returns within seconds of the teammate finishing, that the result includes the teammate's final answer, and that the lead made one wait call, not dozens of status calls.

**Acceptance Scenarios**:

1. **Given** a team is working, **When** the lead asks for status, **Then** it gets every teammate's state, current task and usage, plus the full task list, in one response.
2. **Given** the lead waits with a timeout, **When** any team event happens before the timeout, **Then** the wait returns within 5 seconds of that event, with the event.
3. **Given** the lead waits, **When** nothing happens before the timeout, **Then** the wait returns "no events" and a status summary, and the team keeps working.
4. **Given** a teammate fails (crash, quota, auth, budget), **When** the failure happens, **Then** the lead gets a failure event with the reason, and the teammate's task is released or marked failed.
5. **Given** a teammate produced a long output (for example a large diff or report), **When** its result reaches the lead, **Then** the lead receives a compact summary within the size cap, plus a reference to the full output that it can read only if it needs to.

---

### User Story 4 - Same workflow from every harness, with each one's own trigger (Priority: P1)

The developer works in whichever harness they prefer and starts or steers a team the way that harness normally invokes a skill: `/team-skill` in Claude Code, `$team-skill` in Codex, `/team-skill` in Antigravity. They can also just ask in natural language ("put Codex and Antigravity on this, I don't want to spend Claude tokens"). `@` is not used for this, because all three harnesses reserve it for referencing files.

**Why this priority**: The orchestrator only helps if it fits how the developer already works in an interactive session. A command that works in one harness and not in the others breaks the "any agent can lead" promise.

**Independent Test**: Install the hub on a machine with all three harnesses. In each one, start the same small team twice: once with the native skill trigger, once with a plain-language request. Check that all six starts produce the same team behavior.

**Acceptance Scenarios**:

1. **Given** the hub is installed, **When** the developer types the harness's native skill trigger followed by the team skill's name, **Then** the skill loads and guides the lead to create and run the team.
2. **Given** the developer asks in natural language without naming the skill, **When** the request is about delegating to or teaming up with other agents, **Then** the lead picks up the same skill automatically.
3. **Given** a harness is detected on the machine, **When** the installer runs, **Then** the team skill is installed where that harness discovers skills, and a later reinstall updates it in place.

---

### User Story 5 - Teammates message each other and keep their own context (Priority: P2)

Any teammate can message any other teammate or the lead by name. The lead (or the developer, through the lead) can message any teammate. Messages are delivered at the start of the recipient's next turn. Each teammate keeps its own conversation across turns, so a follow-up message doesn't need the original task repeated.

**Why this priority**: Messaging between teammates is what separates a team from a pool of workers. It lets a reviewer challenge an implementer, or an architect brief a test writer. It needs Stories 1–3 first.

**Independent Test**: Spawn a Codex "implementer" and an Antigravity "reviewer". Have the reviewer message the implementer with a finding, and the implementer reply. Check that each message arrives on the recipient's next turn and that the implementer answers without the original task being re-sent.

**Acceptance Scenarios**:

1. **Given** teammate A sends a message to teammate B by name, **When** B starts its next turn, **Then** the message is included, labeled with the sender.
2. **Given** a message is sent to a name that doesn't exist in the team, **When** it is sent, **Then** the send fails with the list of valid names.
3. **Given** a teammate is idle, **When** it receives a message, **Then** it wakes for one new turn to handle the message (counted against its turn budget).
4. **Given** a teammate has completed several turns, **When** it gets a follow-up, **Then** it still has the context of its earlier turns.
5. **Given** a message comes from another agent, **When** the recipient reads it, **Then** it is clearly marked as coming from a teammate, not from the developer. It can't grant permissions or approvals on the developer's behalf.

---

### User Story 6 - Hard limits on cost, time and team size (Priority: P2)

The developer can cap each team's size, each teammate's turns, the team's total turns, the team's wall-clock time and, where the agent supports it, spending. Teammates can't create teams of their own. Every teammate turn counts as a hop in the loop-guard chain from spec 006. Shutting down the lead's session stops all teammates.

**Why this priority**: Agent teams multiply token use by the number of teammates. Without hard limits, a misconfigured team can burn a day's quota in minutes. That is the main risk the developer asked to avoid.

**Independent Test**: Set a limit of 2 turns per teammate and 4 turns total. Spawn 3 teammates on a task list that would need 10 turns. Check that no teammate exceeds 2 turns, that the team stops at 4, that the lead is told why, and that no agent process is left running afterwards.

**Acceptance Scenarios**:

1. **Given** limits are configured, **When** any limit is reached, **Then** the affected teammate or team stops starting new turns, finishes or aborts its current turn as the limit requires, and reports which limit was hit.
2. **Given** a teammate tries to create a team or spawn its own teammates, **When** it tries, **Then** the request is refused.
3. **Given** the lead's session ends (normal exit, crash, or cancelled), **When** 10 seconds have passed, **Then** no teammate agent process from that team is still running.
4. **Given** the lead asks a teammate to shut down, **When** the request is processed, **Then** the teammate finishes its current turn (or is stopped after a grace period) and is marked stopped.

---

### User Story 7 - Teammates that edit files don't overwrite each other (Priority: P3)

When the lead spawns teammates that will edit files, it can give each one an isolated copy of the workspace, or a declared set of files it owns. The lead sees each teammate's changes separately and decides what to bring in.

**Why this priority**: Two agents editing the same file is the most common way parallel work goes wrong. Research and review teams don't need this, so it can come after the core.

**Independent Test**: Spawn two editing teammates in isolated mode on the same repository and give each a change to the same file. Check that neither sees the other's change, and that the lead gets two separate change sets.

**Acceptance Scenarios**:

1. **Given** a teammate spawned in isolated mode, **When** it edits files, **Then** the changes happen only in its own copy, and the lead can list them as a separate change set.
2. **Given** a teammate spawned with declared file ownership, **When** it tries to edit a file outside its set, **Then** the edit is blocked or flagged in its report.

---

### User Story 8 - Quality gates on task completion (Priority: P3)

The lead (or developer) can attach a check to a task, for example "the test suite passes". A teammate's "done" is only accepted when the check passes. Otherwise the task goes back to the teammate with the check's output.

**Why this priority**: Like Agent Teams' TaskCompleted hook. It raises output quality but is optional.

**Independent Test**: Attach a failing check to a task. Have a teammate report it done. Check that the task stays in progress, the teammate gets the check output on its next turn, and the task completes only once the check passes.

**Acceptance Scenarios**:

1. **Given** a task with a check, **When** a teammate reports it done and the check fails, **Then** the task stays in progress and the failure output goes to that teammate.
2. **Given** a check keeps failing, **When** the teammate runs out of turns, **Then** the task is marked failed with the last check output.

---

### Edge Cases

- **The lead is Codex or Antigravity, not Claude Code**: All stories work the same. Teams are not tied to one host.
- **A teammate's agent is not installed, not signed in, or out of quota**: Spawning or the next turn fails with the existing resilient error format. The task is released, and the lead gets a failure event.
- **A teammate never reports done or failed**: When its turn ends without a status, the orchestrator marks its task with a clear "no status reported" state for the lead to decide. Tasks never silently stay in progress.
- **The lead stops waiting and starts doing teammates' work itself**: Status and wait responses remind the lead which tasks are already owned by teammates.
- **Messages pile up for a teammate that's out of turns**: They stay in its mailbox and show up in status. They don't silently restart the teammate.
- **Two teams in different projects at the same time**: They are fully independent. One team's limits, tasks and mailboxes never mix with another's.
- **Lead session resumed later**: Team state (tasks, messages, results) can be read again. Teammates that are no longer running are shown as stopped and can be respawned with their earlier context where the agent supports resuming conversations.
- **Malformed or hostile content in a teammate's output or message**: It is treated as data, never as orchestrator instructions or permission grants (Story 5, scenario 5).
- **A teammate tries to delegate to another agent through the bridges**: Allowed within spec 006 limits. Its chain starts below the team's position, so the depth and budget rules still hold.

---

## Requirements *(mandatory)*

### Functional Requirements

**Team lifecycle**

- **FR-001**: The hub MUST provide one orchestrator, usable from any of the three host agents, with tools to create a team, spawn teammates, read status, wait for events, send messages, manage tasks and shut down. Proposed names: `team_create`, `team_spawn`, `team_status`, `team_wait`, `team_message`, `team_shutdown`, `task_create`, `task_update`, `task_list`.
- **FR-002**: Spawning a teammate MUST take a unique name, an agent (Claude Code, Codex or Antigravity), role instructions, and optional tier / model / effort, initial task, isolation mode and per-teammate turn limit. It MUST return within 3 seconds and never wait for the teammate's work.
- **FR-003**: Teammates MUST run in the background, in parallel, independent of the lead's tool calls.
- **FR-004**: Each teammate MUST keep its own conversation across turns where its agent supports continuing a conversation. Where it doesn't, the orchestrator MUST give it a compact summary of its earlier turns.
- **FR-005**: Shutting down a teammate MUST let its current turn finish within a grace period (default 60 seconds), then stop it. Ending or losing the lead's session MUST stop every teammate process of that team within 10 seconds.
- **FR-006**: Team state (tasks, messages, teammate results, usage) MUST outlive the lead's session so it can be read again later. Running processes are not resumed automatically.

**Task list**

- **FR-007**: Tasks MUST have an id, title, description, status (pending / in progress / completed / failed / cancelled), optional assignee, optional dependencies, and a result or failure reason.
- **FR-008**: A task MUST NOT start while any of its dependencies isn't completed. Completing a task MUST make the tasks that depend on it available, with no manual step. Creating a dependency cycle MUST be refused.
- **FR-009**: Claiming a task MUST be atomic. Two simultaneous claims MUST never both succeed.
- **FR-010**: The lead MUST be able to assign tasks. Teammates MUST be able to claim the next available task themselves when they finish one, if self-claim is on for the team (default: on).
- **FR-011**: The orchestrator, not the teammate's memory, MUST own task status transitions. When a teammate's turn ends, its task MUST move to completed, failed, or "no status reported". It MUST never stay "in progress" with no one working on it.

**Events, waiting and messaging**

- **FR-012**: `team_wait` MUST block until the next team event or a lead-chosen timeout (default 5 minutes, maximum 30). It MUST return each event within 5 seconds of it happening. Events MUST include: teammate idle (with its final answer), teammate failed (with reason), task completed / failed, and message to the lead.
- **FR-012a**: Everything returned to the lead (teammate results, events, messages, status) MUST be kept compact. Each teammate result MUST be cut to a summary within a configurable size cap (default 8,000 characters). The full output MUST be kept in the team's state and readable on demand. The goal is that the lead's own token use grows with the number of events, not with how much the teammates produce.
- **FR-013**: `team_status` MUST return, in one response, every teammate's state, current task, turns and usage so far, and the full task list.
- **FR-014**: Any team member (lead or teammate) MUST be able to send a message to any other member by name. Messages MUST be delivered at the start of the recipient's next turn. A message to an idle teammate MUST wake it for one turn, within its turn budget.
- **FR-015**: Messages and teammate outputs MUST be shown to recipients as coming from another agent, never from the developer. They MUST NOT be able to approve permissions, raise limits, or change team configuration.

**Invocation from each harness**

- **FR-013a**: The hub MUST ship one team skill with identical behavior for all three harnesses. The skill MUST be invocable with each harness's native skill trigger (`/name` in Claude Code, `$name` in Codex, `/name` in Antigravity) and MUST also be picked up from natural-language requests about delegating to or teaming up with other agents. The design MUST NOT rely on `@`, which all three harnesses reserve for file references.
- **FR-013b**: The installer MUST install and update the team skill in each detected harness's skill location, and `hmcp doctor` MUST report where it is installed.

**Guardrails**

- **FR-016**: Each team MUST have limits: max teammates (default **3**, hard cap **6**), max turns per teammate (default **10**), max total turns (default **30**), team deadline (default **60 minutes**), and a spending cap per teammate where its agent supports one. The developer sets these outside the conversation. A lead can lower them per team but never raise them above the developer's values.
- **FR-017**: Teammates MUST NOT be able to create teams or spawn teammates. Only the lead can (no nested teams).
- **FR-018**: Each teammate turn MUST run as a hop in a spec-006 chain rooted at the team. Teammates' own bridge calls MUST be subject to the spec-006 depth, revisit and budget rules.
- **FR-019**: Every limit hit MUST be reported to the lead as an event naming the limit, the teammate and the task affected.

**Isolation and quality (P3)**

- **FR-020**: A teammate MAY be spawned in isolated mode, with its own copy of the workspace, or with a declared set of files it owns. The lead MUST be able to list each isolated teammate's changes as a separate change set.
- **FR-021**: A task MAY carry a completion check. A "done" report MUST only complete the task if the check passes. Otherwise the output MUST go back to the teammate.

**Observability**

- **FR-022**: Each teammate turn MUST record its agent, model, effort, duration, outcome and, where the agent reports it, token or cost usage. `team_status` MUST show totals per teammate and per team.

### Key Entities

- **Team**: A named group led by one session, with its limits, members, task list and event log. Scoped to one project folder.
- **Teammate**: A named member bound to one agent, with role instructions, settings (tier / model / effort), isolation mode, state (working / idle / failed / stopped), turns used, and a pointer to its continued conversation.
- **Task**: A unit of work with status, assignee, dependencies, result, and an optional completion check.
- **Mailbox**: The ordered, undelivered messages for one member.
- **Team Event**: Something the lead can wait for (idle, failed, task status change, message, limit hit).
- **Turn**: One run of a teammate's agent, from start to end. This is the unit of budgeting.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A team of 3 teammates on at least 2 different vendors completes a 6-task workload with dependencies. Across 20 runs there are 0 double-claimed tasks and 0 tasks left "in progress" at the end.
- **SC-002**: Spawning a teammate returns control to the lead in under 3 seconds, in 95% of spawns.
- **SC-003**: The lead learns that a teammate finished within 5 seconds, using a number of status / wait calls that does not grow with how long the teammate runs (at most one wait call per event).
- **SC-004**: For 3 independent tasks of similar size, the team finishes in at most 50% of the wall-clock time of running the same delegations one after another.
- **SC-005**: Across the full test suite with limits set, 0 runs exceed any team limit, and 0 teammate processes are still running 10 seconds after the lead's session ends.
- **SC-006**: The same reference workload can be led from each of the three host agents with the same outcome.
- **SC-007**: In an adversarial test where every teammate is told to spawn its own teammates and to delegate in a loop, 100% of attempts are refused or bounded by spec-006 limits.
- **SC-008**: For a teammate result of any size, the text returned to the lead never exceeds the configured cap, and the full output can still be read on demand.
- **SC-009**: In each of the three harnesses, the team skill starts the reference workload both through the native skill trigger and through a plain-language request (6 out of 6 starts).

---

## Assumptions

- **One orchestrator, separate from the vendor bridges**: The orchestrator is a new component that can launch any of the three agents. Each existing per-vendor bridge stays as it is for one-shot calls.
- **Hub-coordinated first, direct tools second**: In the first version, teammates coordinate by reporting their status, messages and claims at the end of each turn, in a fixed format the orchestrator reads. Giving teammates direct team tools mid-turn is a later step (see `research.md`, phases). Both satisfy FR-010 and FR-014. The difference is how soon a message lands: next turn vs. mid-turn.
- **Default limits** (3 teammates, 10 turns each, 30 total, 60 minutes) follow Agent Teams' guidance of 3–5 teammates and 5–6 tasks per teammate, set on the conservative side because of cost. Confirm with `/speckit-clarify`.
- **Polling-free waiting**: Host agents don't reliably react to server-pushed notifications, so the lead "waits" through a long-running tool call that returns on the next event. This works the same in all three hosts.
- **Release target**: **v1.0.6**, together with spec 005 (model / effort control) and spec 006 (bidirectional mesh and loop guard). v1.0.5 (`5cacc64`) is the latest published release.
- **Out of scope for this spec**: a visual dashboard or split-pane terminal view; remote teammates on other machines; automatic merging of isolated change sets (the lead or developer decides); persisting teams across machine restarts beyond readable state.
- **Relation to Claude Code's native Agent Teams**: This feature doesn't replace or depend on it. A zero-code interim recipe (native Claude teammates that act as thin proxies to Codex / Antigravity) is described in `research.md` as a quick win while this spec is built.
