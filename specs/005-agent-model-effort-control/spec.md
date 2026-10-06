# Feature Specification: Agent Model & Reasoning-Effort Control

**Feature Directory**: `specs/005-agent-model-effort-control`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "Create a new tool so Claude Code can change the model and the reasoning effort of the delegated agents (Antigravity and Codex), when I ask or when it decides it should: heavier tasks get a stronger model with more reasoning effort, lighter tasks get a lighter model with less reasoning."

---

## Context

Today the hub lets Claude Code consult and delegate work to Google Antigravity and OpenAI Codex. The only lever over *how* those agents think is an optional free-text `model` argument on each call, plus a fixed default chosen when the server starts. There is:

- no way to set **reasoning effort** at all;
- no way to change the **default** for the rest of a session without restarting the client;
- no way for Claude Code to **discover** which models and effort levels are valid, so it has to guess names;
- no guidance telling Claude Code **when** to escalate or de-escalate.

As a result, light tasks (a quick lookup, a lint-level review) can run on an expensive, slow configuration, and hard tasks (a cross-module refactor, a security review) can run on a fast, shallow one.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Claude Code changes an agent's model and effort on request (Priority: P1)

The developer tells Claude Code something like "use Codex on maximum reasoning for this refactor" or "switch Antigravity to the light model". Claude Code calls a dedicated configuration tool for that agent. From then on, every call to that agent uses the new model and effort until it is changed again.

**Why this priority**: This is the core ask. Without it, nothing else in this feature works. It also delivers value on its own: the developer gets direct, conversational control over cost, speed and depth.

**Independent Test**: Start a session, call the configuration tool for one agent with a new model and effort, then call any task tool on that agent (ask, review, brainstorm, plan, delegate) without passing a model. Check that the agent ran with the new settings and that the response says which settings were used.

**Acceptance Scenarios**:

1. **Given** the Codex agent is on its default configuration, **When** Claude Code sets Codex to a stronger model with "high" effort, **Then** the tool confirms the change (previous → new values) and every later Codex task call in that session runs with the new model and effort.
2. **Given** Antigravity was set to a heavy configuration, **When** Claude Code sets it to a light model with "low" effort, **Then** later Antigravity calls run on the light configuration.
3. **Given** a session configuration is active, **When** Claude Code passes an explicit model or effort on a single task call, **Then** that one call uses the explicit values and the session configuration does not change.
4. **Given** a configuration was changed, **When** Claude Code asks to reset it, **Then** the agent goes back to its startup defaults and the tool reports the restored values.
5. **Given** any task call finishes (success or error), **When** the result is returned, **Then** it states which model and effort were actually used.

---

### User Story 2 - Claude Code discovers valid options and the current state (Priority: P1)

Before changing anything, Claude Code can ask the configuration tool what is active right now and which models and effort levels are available for that agent, each with a short note on what it is good for (for example, fast and cheap vs. deep reasoning).

**Why this priority**: If Claude Code cannot discover valid options, it guesses model names and gets avoidable failures. Discovery is what lets Story 1 work reliably and lets Story 3 work at all.

**Independent Test**: Call the configuration tool in read-only mode for each agent. Check that it returns the current model, the current effort, where each value came from (startup default, session setting), the list of valid effort levels, and a list of available models with a tier note for each.

**Acceptance Scenarios**:

1. **Given** a fresh session, **When** Claude Code queries the configuration of an agent without changing anything, **Then** it receives the current model and effort, the source of each value, the valid effort levels, and the available models.
2. **Given** the agent's CLI can list its models, **When** the configuration is queried, **Then** the model list comes from the CLI. **Given** it cannot, **Then** a curated built-in list is returned and marked as such.
3. **Given** Claude Code tries to set a model or effort that is not valid for that agent, **When** the tool processes the request, **Then** nothing changes and the response explains why and lists valid alternatives.

---

### User Story 3 - Claude Code picks the right weight on its own (Priority: P2)

Without being asked, Claude Code judges how hard a task is before delegating and picks a fitting configuration. For example: a light tier for quick questions, summaries and small lookups; a balanced tier for routine reviews and plans; a deep tier for complex refactors, architecture decisions, security reviews and hard debugging. To make this easy, the hub offers named **tiers** (light / balanced / deep) that map to a model and effort per agent, so Claude Code can pick a tier instead of memorizing model names.

**Why this priority**: This is the "when it feels it should" part of the request. It builds on Stories 1–2 and makes the feature work on its own, but the developer can still get full value by asking explicitly.

**Independent Test**: Read the tool descriptions exposed by each server and check that they include clear guidance on which tier fits which kind of task. Set each tier on each agent and check that it resolves to the expected model and effort.

**Acceptance Scenarios**:

1. **Given** the tool catalog is listed, **When** Claude Code reads the configuration tool's description, **Then** it finds plain guidance mapping task types to light / balanced / deep tiers.
2. **Given** Claude Code selects the "deep" tier for Codex, **When** the change is applied, **Then** Codex resolves to the deep tier's model and effort, and the confirmation shows both the tier name and the concrete values.
3. **Given** Claude Code changes tier on its own initiative, **When** the change happens, **Then** the confirmation is short and readable so Claude Code can mention it to the developer in one line.

---

### User Story 4 - Developer sets limits and tier mappings (Priority: P3)

The developer can set, outside the conversation, which concrete model and effort each tier maps to and an optional **ceiling** (the strongest model or highest effort Claude Code may pick on its own). This keeps quota and cost under control even when Claude Code escalates by itself.

**Why this priority**: It is a guardrail and a power-user tweak. Sensible built-in tiers and no ceiling are a good default, so this can ship after Stories 1–3.

**Independent Test**: Configure a ceiling of "medium" effort for Antigravity, then ask the configuration tool for "max" effort. Check that the request is clamped or refused with a clear message, and that the reported effective effort is "medium".

**Acceptance Scenarios**:

1. **Given** the developer has set a ceiling for an agent, **When** Claude Code asks for a configuration above it, **Then** the configuration is limited to the ceiling and the response says so.
2. **Given** the developer has customized a tier mapping, **When** Claude Code selects that tier, **Then** the customized model and effort are used.
3. **Given** no ceiling or custom mapping is configured, **When** the servers start, **Then** the built-in tiers apply with no ceiling.

---

### Edge Cases

- **Unknown or misspelled model name**: The change is rejected, the previous configuration stays in place, and the closest valid names are suggested.
- **Effort level the agent does not support** (for example "max" on an agent whose top level is "xhigh"): The hub uses the closest supported level, reports the actual level used, and says that it was mapped.
- **Model name that already includes an effort** (for example "Gemini 3.8 Flash (High)") **plus a different explicit effort**: The explicit effort wins. The response shows the effective model and effort with no ambiguity.
- **Model catalog unavailable** (CLI offline, slow, or no list command): Discovery falls back to a curated list within a short time limit and never blocks for more than a few seconds. Setting a model that is not on the curated list is still allowed, but returns a warning that it could not be checked.
- **Configuration changed while a task is running**: The running task keeps the configuration it started with. Only calls made after the change use the new values.
- **Concurrent calls**: Several calls to the same agent in parallel each use the configuration that was active when they started.
- **Server restart or client restart**: Session configuration goes back to the startup defaults (no surprise carry-over between sessions).
- **Startup environment overrides** (existing `AGY_MODEL` / `CODEX_MODEL`): These stay the startup defaults, and "reset" returns to them.
- **Selected model unavailable at run time** (quota, plan restriction, deprecation): The task fails with the existing resilient error format. The error names the model and effort that were tried and suggests a lighter tier or a reset.
- **Review-style calls that cannot take a model flag directly**: These must still honor the active model and effort. No task tool may silently ignore the session configuration.

---

## Requirements *(mandatory)*

### Functional Requirements

**Configuration tool**

- **FR-001**: Each agent server (Antigravity and Codex) MUST expose one new configuration tool, following the existing naming pattern (`configure_antigravity`, `configure_codex`).
- **FR-002**: The configuration tool MUST support four actions: **get** (read current state and options, no side effects), **set** (change model and/or effort, or select a tier), **reset** (restore startup defaults), and **list** (available models, effort levels and tiers). Calling it with no change arguments MUST behave as **get**.
- **FR-003**: A **set** action MUST accept a model, an effort level, a tier name, or a mix of them. When a tier and an explicit model/effort are both given, the explicit values MUST override the matching part of the tier.
- **FR-004**: Every **set** and **reset** response MUST report the previous and the new effective model and effort, plus any mapping, clamping or warning that was applied.

**Effect on task tools**

- **FR-005**: After a successful **set**, every task tool of that agent (ask, review, brainstorm, plan, delegate) MUST use the session configuration for all later calls in the same server session, unless the call passes its own override.
- **FR-006**: Every task tool MUST accept an optional per-call **effort** override in addition to the existing per-call **model** override. Per-call overrides MUST NOT change the session configuration.
- **FR-007**: Every task tool response MUST state the model and effort actually used for that call, on success and on error.
- **FR-008**: No task tool may silently ignore the active model or effort. If an agent's CLI path for a given tool cannot accept them the normal way, the hub MUST still apply them through another supported mechanism, or fail with a clear explanation.

**Validation and discovery**

- **FR-009**: The hub MUST validate effort values against a single shared vocabulary (`low`, `medium`, `high`, `xhigh`, `max`) and map each value to the closest level the target agent supports, reporting when a mapping happened.
- **FR-010**: The hub MUST validate model names against the agent's available-model catalog when one can be obtained. It MUST reject names that do not match while the catalog is available, and accept them with a warning while the catalog is unavailable.
- **FR-011**: Model discovery MUST finish or fall back to a curated list within 5 seconds, and its result MAY be cached for the rest of the session.
- **FR-012**: Each listed model MUST carry a short tier note (light / balanced / deep) so Claude Code can choose without outside knowledge.

**Tiers and autonomy guidance**

- **FR-013**: The hub MUST provide three built-in tiers per agent (**light**, **balanced**, **deep**), each resolving to a concrete model and effort valid for that agent.
- **FR-014**: The configuration tool's description MUST include short guidance mapping task types to tiers. At minimum: light for quick questions, summaries and trivial edits; balanced for routine reviews, plans and well-scoped delegations; deep for complex refactors, architecture, security reviews and hard debugging. It MUST also allow Claude Code to switch tiers on its own initiative.
- **FR-015**: Existing task-tool descriptions MUST state the correct current default model (fixing today's mismatch) and point to the configuration tool for changing model or effort.

**Developer guardrails**

- **FR-016**: The developer MUST be able to override, outside the conversation, each tier's model and effort per agent, and set an optional ceiling for model strength and effort per agent.
- **FR-017**: When a requested configuration exceeds the ceiling, the hub MUST clamp it to the ceiling and say so in the response. It MUST NOT exceed the ceiling silently.

**Lifecycle**

- **FR-018**: Session configuration MUST live only for the lifetime of the agent server process. A restart MUST return to startup defaults.
- **FR-019**: Startup defaults MUST keep honoring the existing environment overrides (`AGY_MODEL`, `CODEX_MODEL`). A startup default for effort MUST also be configurable the same way.
- **FR-020**: A configuration change MUST NOT affect calls that are already running.

### Key Entities

- **Agent Configuration**: The effective settings of one agent in the current session. Holds the model, the effort, the source of each value (startup default / tier / explicit / clamped), and the tier name if one was used.
- **Effort Level**: One value from the shared vocabulary (`low` → `max`), plus a per-agent mapping to the levels that agent supports.
- **Tier**: A named preset (light / balanced / deep) that resolves to a model and effort for one agent. It can be overridden by the developer.
- **Model Catalog Entry**: A model that one agent offers: identifier, display name, tier note, and whether it came from the agent's CLI or from the curated list.
- **Ceiling**: An optional upper limit set by the developer on model strength and/or effort for one agent.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of task calls made after a configuration change, the reported model and effort match the active session configuration (or the per-call override, when one is given). This is checked on all five task tools of both agents.
- **SC-002**: Claude Code can read the current state and valid options of an agent in one tool call, with a response in under 5 seconds even when the model catalog is unavailable.
- **SC-003**: 100% of invalid model or effort requests leave the previous configuration unchanged and return at least one valid alternative.
- **SC-004**: When asked to pick a tier for a reference set of at least 10 tasks (5 clearly light, 5 clearly heavy), Claude Code, guided only by the tool descriptions, picks the expected tier in at least 8 of 10 cases.
- **SC-005**: With a ceiling configured, 0 calls run above the ceiling across the full test suite.
- **SC-006**: Every existing tool keeps working with no change to how it is called today (backward compatible). All existing test suites still pass.

---

## Assumptions

- **Scope of a change**: A **set** applies to the whole session (all later calls to that agent) until changed or reset. Per-call overrides remain available for one-off needs. Changes do not persist across restarts, so each session starts from known defaults.
- **One tool per agent**: The Antigravity and Codex servers run as separate processes, so each exposes its own configuration tool rather than one shared tool controlling both.
- **Autonomy**: Claude Code may change tiers without asking the developer first (as requested). The developer's control point is the optional ceiling (Story 4) plus the one-line confirmation Claude Code can relay.
- **Effort support**: Both agent CLIs can take a reasoning-effort setting per run. The Antigravity CLI offers `low | medium | high | xhigh | max`. Codex uses a reasoning-effort setting with its own set of levels. The exact per-agent mapping is decided during planning.
- **Built-in tier defaults** (to be confirmed in planning against the live catalogs): Antigravity — light: a Flash model at low effort; balanced: Flash (High) at medium effort; deep: a Pro or top model at high/max effort. Codex — light: a fast model at low effort; balanced: the current default model at medium effort; deep: the strongest available model at high/xhigh effort.
- **Out of scope**: Persisting configuration across sessions; controlling Claude Code's own model; per-project automatic profiles; cost or token accounting.
- **Related defect**: The Codex review path currently cannot take a model argument the way the other tools do. This feature must fix that (see FR-008) rather than work around it.
