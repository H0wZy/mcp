# Feature Specification: Bidirectional Agent Mesh & Loop Guard

**Feature Directory**: `specs/006-bidirectional-agent-mesh`

**Created**: 2026-10-06

**Status**: Clarified (2026-10-07); checked against the real CLIs on the maintainer's machine (2026-10-07, FR-026)

**Input**: User description: "Create a spec so Antigravity and Codex can also use Claude Code — not only Claude Code calling them — so the three top agents on the market can talk to each other in any direction. Be very careful that this does not turn into an infinite loop that burns a huge amount of tokens."

---

## Context

Today the hub is mostly one-way. Claude Code can call Codex and Antigravity (`ask_*`, `review_*`, `brainstorm_*`, `plan_*`, `delegate_*`, `configure_*`). The CLI can also wire Codex → Antigravity and Antigravity → Codex. Nothing lets Codex or Antigravity call Claude Code.

Because Codex ↔ Antigravity bridges can already be installed together (`hmcp install --all` installs both), a loop is **already possible today**. Codex asks Antigravity, which asks Codex, which asks Antigravity, and so on. Each hop starts a new agent process and a new paid model session. No hop knows how deep it is, who called it, or how much budget is left. Adding Claude Code as a third callable agent turns two possible directions into six, which makes the problem worse unless it is solved first.

This feature has two parts:

1. **A loop guard** that every bridge applies on every call.
2. **A Claude Code bridge**, so Codex and Antigravity can consult and delegate to Claude Code with the same tools and controls Claude Code already has toward them.

---

## Clarifications

### Session 2026-10-07

The maintainer was away and asked for the work to continue without questions. Each answer below is the recommended option, chosen by the agent. Review them before release.

- Q: Where does the developer set the loop-guard limits, and which value wins when two hosts disagree? → A: Environment variables on the bridge server (`H0WZY_MCP_MAX_DEPTH`, `H0WZY_MCP_MAX_CALLS`, `H0WZY_MCP_ALLOW_REVISIT`, `H0WZY_MCP_DEADLINE_MINUTES`), set in the host's MCP config or the shell. The chain's limits are fixed when the chain starts. A nested bridge applies the stricter of the chain's limits and its own.
- Q: What may `delegate_claude` do without asking, given that nobody can answer a permission prompt? → A: By default it auto-approves file edits inside `cwd` (and the extra folders) and denies everything else that would prompt, including shell commands the user hasn't allowed in their Claude Code settings. The developer can opt into Claude Code's `auto` permission mode with `CLAUDE_BRIDGE_DELEGATE_PERMISSION_MODE=auto`.
- Q: Which Claude models do the light / balanced / deep tiers use? → A: light = `sonnet` at `low`, balanced = `opus` at `medium` (also the startup default), deep = `fable` at `high`. These are Claude Code's model aliases, so new model releases need no code change.
- Q: How does a bridge detect nesting when the host strips the chain variables (FR-003)? → A: A per-user registry of running bridge-started agents (`~/.h0wzy-mcp/agents/<pid>.json`) plus a walk up the bridge's process ancestors. It reads `/proc` on Linux, `ps` on macOS, and a PowerShell process query on Windows, cached once per server. If agents are registered and the ancestry can't be read, the call fails closed and is treated as being at the maximum depth.
- Q: Where is the optional chain log, and how is it turned on (FR-024)? → A: It is a JSON Lines file at `~/.h0wzy-mcp/chain.log`, turned on with `H0WZY_MCP_CHAIN_LOG=1`. Each line holds run id, caller, agent, depth, outcome and duration, and never any prompt text.

### Session 2026-10-07 (real CLIs, maintainer's Windows machine)

Measured with Claude Code 2.1.293, Codex 0.161.0 and agy 1.3.1 (research §7). The maintainer approved the test steps; the decisions follow the measurements.

- Q: Which MCP servers does an agent started by a bridge load (FR-026)? → A: Below the maximum depth, only the H0wZy/mcp mesh bridges (`codex`, `antigravity`, `claude`); at it, none (FR-010). The user's other MCP servers stay off: with them, one `claude -p` call carried ~380k tokens of tool definitions (US$ 0.38 on Haiku, against US$ 0.0012 without), and `codex exec` took 37 s instead of 19 s. `H0WZY_MCP_USER_SERVERS=1` lets nested agents load the user's own servers again. Antigravity has no per-call switch, so it keeps loading all of its servers.
- Q: Where does the Claude bridge find the mesh bridges to pass on? → A: In Claude Code's user config (`~/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json`): the user scope, plus the local scope of the working folder. Never in a project's `.mcp.json`: Claude Code asks before it starts a project server, and passing one through `--mcp-config` would skip that approval for whatever a cloned repository calls "codex".
- Q: What happens when Antigravity waits for an MCP server that never connects? → A: agy starts a print-mode turn only after every configured server has connected, and `agy mcp disable` did not stop the wait. The run ends at `--print-timeout` with exit code 0, an empty answer and status "SUCCESS". The bridges treat that as a timed-out call (an error) and, from a private `--log-file`, name the servers agy was still waiting for.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Delegation chains always stop (Priority: P1)

A developer has bridges installed in several directions. An agent asks a second agent for help, and the second agent decides to ask a third. The chain can go a short, bounded distance. It never comes back to an agent already in the chain unless the developer allows it, and it stops at a fixed maximum depth. When a call is refused, the calling agent gets a short, clear explanation and can finish the work itself.

**Why this priority**: This is a safety requirement, and the risk already exists with the bridges that ship today. Nothing else in this feature is safe to release without it. On its own, it already protects current users from runaway token spend.

**Independent Test**: Install Codex → Antigravity and Antigravity → Codex bridges. Give Codex a prompt that tells every agent to keep delegating to the other agent forever. Check that the chain stops at the configured maximum depth, that no agent process is started past that point, and that the top-level answer explains where and why the chain was cut.

**Acceptance Scenarios**:

1. **Given** the maximum depth is 2, **When** agent A calls B and B calls C, **Then** both calls run. **When** C then tries to call any bridge, **Then** the call is refused without starting a new agent, and C receives a message saying it is at the maximum depth.
2. **Given** a chain A → B, **When** B tries to call A, **Then** the call is refused by default as a cycle, and the message names the chain (for example `claude → codex → claude`).
3. **Given** the developer explicitly allows returning to an agent already in the chain, **When** B calls A, **Then** the call runs, but the depth limit and call budget still apply.
4. **Given** an intermediate agent does not pass the chain information along to the bridges it runs, **When** a nested bridge call happens under it, **Then** the bridge still detects that it is nested and applies the same limits.
5. **Given** a call is refused, **When** the refusal is returned, **Then** it is marked as an error the caller can recover from, it names the rule that applied (depth, cycle, budget, or deadline), and it tells the caller to finish the task without delegating.

---

### User Story 2 - Codex and Antigravity can call Claude Code (Priority: P1)

A developer working in Codex (or Antigravity) wants Claude Code's opinion or help. They ask their agent to "get a second opinion from Claude", "have Claude review this diff", or "delegate this refactor to Claude". The agent calls a Claude Code bridge with the same family of tools Claude Code already has toward the other agents: ask, review, brainstorm, plan, delegate and configure.

**Why this priority**: This is the direct feature request. It makes the hub symmetric: any of the three agents can be the one the developer is talking to, and the other two can be consulted.

**Independent Test**: Install the Codex → Claude Code bridge. In Codex, ask a question that requires Claude Code to read a file. Check that Claude Code answers, that the answer reports which Claude model and effort were used, and that the call appears in the chain trace.

**Acceptance Scenarios**:

1. **Given** the Claude Code bridge is installed in Codex, **When** Codex calls `ask_claude` with a prompt and file paths, **Then** Claude Code reads the files, answers, and the response states the model, effort and chain used.
2. **Given** a read-only tool (`ask_claude`, `review_claude`, `brainstorm_claude`, `plan_claude`), **When** Claude Code runs, **Then** it cannot modify files or run commands that change the workspace.
3. **Given** `delegate_claude` with a working folder, **When** Claude Code runs, **Then** it may edit files only inside that folder, it never waits for a permission prompt that nobody can answer, and it returns a final report.
4. **Given** `configure_claude`, **When** the calling agent sets a tier, model or effort, **Then** later Claude Code calls use it, with the same get / set / reset / list behavior, tiers, ceilings and per-call overrides defined for the other agents in spec 005.
5. **Given** Claude Code is not installed or not signed in, **When** a Claude tool is called, **Then** the response uses the existing resilient error format with install or sign-in guidance.

---

### User Story 3 - Every chain has a budget and a deadline (Priority: P2)

Besides depth, each chain has a total call budget and a deadline. A nested call never gets more time than its parent has left. When the agent supports a spending cap, the bridge applies one per call. Each response reports how much of the chain's budget is left.

**Why this priority**: Depth limits stop infinite loops. They do not stop a wide fan-out, where one agent fires many sibling calls, or a slow chain that runs for an hour. Budgets close that gap. They come after Story 1 because depth limits already prevent the worst case.

**Independent Test**: Set a chain budget of 3 calls. Delegate one task to an agent and have that agent make 5 sibling calls to other agents. Check that the delegation plus the first 2 siblings run, that the other 3 are refused with a budget message, and that each response shows how much of the budget is used.

**Acceptance Scenarios**:

1. **Given** a chain budget of N calls, **When** the (N+1)th bridge call in the same chain is made, **Then** it is refused without starting an agent.
2. **Given** a parent call with 10 minutes left, **When** it makes a nested call that asks for 30 minutes, **Then** the nested call is limited to the time the parent has left.
3. **Given** a spending cap is configured for an agent that supports one, **When** a call reaches the cap, **Then** that agent stops and the response says the cap was reached.

---

### User Story 4 - Safe installation and diagnosis of bidirectional bridges (Priority: P2)

The developer installs the new directions with the existing CLI, for example `hmcp install codex-claude` and `hmcp install antigravity-claude`. The CLI explains that bidirectional bridges create possible cycles and that the loop guard protects against them. `hmcp doctor` shows a map of all installed bridge directions, points out every possible cycle, and shows the active loop-guard limits.

**Why this priority**: The guard must also work in the host agents' own configuration. For example, a host may need to be told to pass the chain information to the bridges it runs. The installer is where that is set up correctly. Users also need to see what they have connected.

**Independent Test**: On a machine with all three agents, run the installer for all six directions, then run `hmcp doctor`. Check that it lists the six directions, flags the cycles, and confirms each host's configuration lets the guard work. Check that bridge timeouts in each host's config allow long delegations.

**Acceptance Scenarios**:

1. **Given** the developer runs the install-everything option, **When** bridges that would create a cycle are about to be installed, **Then** the CLI says so and asks for explicit confirmation (or a dedicated flag in non-interactive mode) before installing them.
2. **Given** a host agent needs extra settings for the guard to work or for long calls not to time out, **When** a bridge is installed into that host, **Then** the installer writes those settings and keeps the rest of the user's configuration intact.
3. **Given** any set of installed bridges, **When** `hmcp doctor` runs, **Then** it prints every directed bridge, every cycle, and the effective loop-guard limits.

---

### User Story 5 - Chain trace for debugging (Priority: P3)

Every bridge response ends with a short trace line, for example `[chain claude→codex→antigravity · depth 2/2 · calls 3/8 · run a1b2c3]`. A local log keeps one line per bridge call with start, end, outcome and duration, so the developer can see after the fact what happened in a long multi-agent session.

**Why this priority**: It is useful for trust and debugging but not required for safety.

**Independent Test**: Run a three-hop chain. Check that each response shows its own position in the chain and that the local log shows all three calls with the same run identifier.

**Acceptance Scenarios**:

1. **Given** any bridge call, **When** it returns (success, error or refusal), **Then** the response includes the trace line.
2. **Given** chain logging is on, **When** a chain finishes, **Then** the log shows each call's agent, depth, outcome and duration, and never contains prompt text or secrets.

---

### Edge Cases

- **Host does not forward the chain information** (for example, a host only passes an allow-list of environment settings to the bridges it runs): Nesting must still be detected (Story 1, scenario 4). If it can't be detected reliably on a platform, the bridge MUST behave as if it is nested at the maximum depth (fail closed) whenever it has evidence it was started by another agent.
- **Developer starts a fresh top-level session while an old chain is still running**: The new session starts a new chain with a full budget. It doesn't inherit the old chain's limits.
- **Clock changes or very long calls**: Deadlines must not let a nested call outlive its parent, even if the system clock is adjusted.
- **Parallel sibling calls in the same chain**: They share one budget. Two siblings must not both get the "last" call.
- **The agent at maximum depth still sees bridge tools in its tool list**: Where the agent supports it, it is started without bridge tools. Otherwise every call it makes is refused quickly, at almost no cost.
- **A model ignores the "do not delegate" advice in its prompt**: The guard does not depend on the model following instructions. Refusals are enforced by the bridge.
- **Parent call cancelled or timed out**: Its child agents are stopped too. No orphan agent processes are left running.
- **Developer sets limits above the hard caps**: Values are clamped to the hard caps, and `hmcp doctor` and the responses say so.
- **Claude Code asks for a permission nobody can answer**: The run must not hang. The request is denied and the run continues or ends with a clear report.
- **One-shot Claude Code calls clutter the developer's session history**: Read-only bridge calls should not show up as resumable sessions in the developer's own Claude Code history unless the developer asks for that.

---

## Requirements *(mandatory)*

### Functional Requirements

**Chain context and loop guard**

- **FR-001**: Every bridge call MUST belong to a **chain**. The chain records a run identifier, the ordered list of agents visited, the current depth, the remaining call budget and the deadline. A call made with no inherited chain starts a new chain at depth 0.
- **FR-002**: When a bridge starts an agent, it MUST pass that call's chain information on to the agent, so that any bridge the agent then uses can read it.
- **FR-003**: A bridge MUST detect that it is nested even when an intermediate agent did not forward the chain information, and MUST apply the limits in that case too. When it has evidence of being nested but cannot recover the chain, it MUST fail closed and treat the call as being at the maximum depth.
- **FR-004**: A bridge MUST refuse, before starting any agent, a call that would: exceed the maximum depth; revisit an agent already in the chain (unless revisits are allowed); exceed the chain's call budget; or start after the chain's deadline.
- **FR-005**: The maximum depth MUST default to **2**, meaning a top-level agent can call a second agent and that agent can call a third. It MUST be configurable by the developer up to a hard cap of **4**.
- **FR-006**: Revisiting an agent already in the chain MUST be refused by default. It MUST be possible to allow it explicitly. The depth and budget limits apply either way.
- **FR-007**: The chain call budget MUST default to **8** bridge calls per chain and be configurable up to a hard cap of **32**. Calls made in parallel within one chain MUST share the budget atomically.
- **FR-008**: A nested call's time limit MUST be the smaller of its own requested limit and the time its parent has left.
- **FR-009**: Refusals MUST return within 1 second. They MUST be marked as errors and name the rule that applied. They MUST include the chain path, and they MUST tell the caller to finish the task without delegating.
- **FR-010**: When an agent is started at the maximum depth, the bridge MUST start it without access to any bridge tools wherever that agent offers a way to do this. Otherwise FR-004 refusals apply to everything it tries.
- **FR-011**: Each delegated prompt MUST start with a short notice telling the agent its position in the chain (who called it, its depth out of the maximum) and asking it not to call back to agents already in the chain. This notice is advisory and saves tokens. It MUST NOT be the only protection.
- **FR-012**: Cancelling or timing out a call MUST stop the agent it started and everything that agent started in turn.

**Claude Code bridge**

- **FR-013**: The hub MUST provide a Claude Code bridge with the same tool family as the other agents: `ask_claude`, `review_claude`, `brainstorm_claude`, `plan_claude`, `delegate_claude` and `configure_claude`.
- **FR-014**: `ask_claude`, `review_claude`, `brainstorm_claude` and `plan_claude` MUST run Claude Code in a read-only mode, with no file edits and no workspace-changing commands.
- **FR-015**: `delegate_claude` MUST require a working folder, MUST let Claude Code edit only inside it (plus any extra folders explicitly passed), and MUST never block waiting for an interactive permission answer.
- **FR-016**: `configure_claude` and the per-call `model` / `effort` overrides MUST follow spec 005: actions get / set / reset / list, tiers light / balanced / deep, developer ceilings and tier overrides, and a footer with the model and effort used.
- **FR-017**: When the developer sets a spending cap or turn limit for Claude Code bridge calls, each call MUST enforce it. Reaching it MUST be reported in the response.
- **FR-018**: Read-only Claude Code bridge calls MUST NOT be saved as resumable sessions in the developer's Claude Code history by default.

**Installation and diagnosis**

- **FR-019**: The CLI MUST support installing the new directions `codex-claude` and `antigravity-claude`, alongside the existing four.
- **FR-020**: The install-everything option MUST NOT install a set of bridges that forms a cycle without explicit confirmation, either interactively or with a dedicated flag.
- **FR-021**: When installing a bridge into a host, the CLI MUST also write any host settings the loop guard needs to work (for example, letting chain information through to the bridge). It MUST also write a tool timeout long enough for delegations. It MUST NOT drop or corrupt the user's other settings.
- **FR-022**: `hmcp doctor` MUST list all installed directed bridges and every cycle among them, show the effective loop-guard limits, and warn when a host is set up in a way that stops the guard from seeing the chain.

**Observability**

- **FR-023**: Every bridge response (success, error or refusal) MUST end with a trace line showing the chain path, depth / maximum, calls used / budget, and a short run identifier.
- **FR-024**: The hub MUST offer an optional local chain log with one entry per call (run id, agent, depth, outcome, duration). It MUST NOT store prompt text, file contents or secrets.

**Compatibility**

- **FR-025**: Existing tools MUST keep working as they are called today. For a top-level call, the visible changes are the added trace line and the narrower MCP scope of the agent it starts (FR-026).

**Cost of nested agents**

- **FR-026**: An agent started by a bridge MUST load only the MCP servers the mesh needs: the H0wZy/mcp agent bridges below the maximum depth, none at it (FR-010), and never the team server. The user's other MCP servers MUST stay off wherever the target CLI offers a per-call way to do so, unless the developer opts in (`H0WZY_MCP_USER_SERVERS=1`). The bridge MUST NOT pass on servers from a project's own config, which the host would otherwise ask the user to approve. Where a target CLI can't be scoped and a server it waits for keeps a run from starting, the bridge MUST report the run as timed out and name the server.

### Key Entities

- **Chain**: One end-to-end delegation tree that started from a top-level call. It has a run identifier, a budget, a deadline and the maximum depth that applies.
- **Hop**: One bridge call within a chain. It records the calling agent, the called agent, the depth, the time limit and the outcome (ran / refused / failed / timed out).
- **Loop-Guard Policy**: The effective limits: maximum depth, revisit allowed or not, call budget, and default deadline. Each has a default, a developer override and a hard cap.
- **Bridge Direction**: An installed "host → target" connection (for example `codex → claude`). Together these form a directed graph whose cycles `hmcp doctor` reports.
- **Refusal**: A response for a call that was not run. It names the rule, the chain path and recovery advice.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With all six bridge directions installed, an adversarial prompt telling every agent to keep delegating forever ends in 100% of 20 runs. No chain exceeds the configured depth or call budget.
- **SC-002**: The same adversarial test, run with chain forwarding switched off in every host, still ends within the limits in 100% of runs on Linux, macOS and Windows.
- **SC-003**: A refused call returns in under 1 second and starts 0 agent processes.
- **SC-004**: Codex and Antigravity users can complete an ask, a review and a delegation through Claude Code end to end. Each response reports the model, effort and chain used.
- **SC-005**: In 100% of tested nested calls, no child agent is still running after its parent's deadline or after its parent was cancelled (checked 10 seconds after).
- **SC-006**: `hmcp doctor` reports 100% of cycles in a test matrix covering every subset of the six bridge directions.
- **SC-007**: All existing test suites still pass. Existing tool calls need no changes from callers.

---

## Assumptions

- **Default limits**: max depth 2 (hard cap 4), no revisits, chain budget 8 calls (hard cap 32), and a default chain deadline of 60 minutes. A depth of 2 covers "A asks B, and B asks C for a quick check". That is the deepest useful chain for second opinions and reviews. Anything deeper is almost always waste.
- **One chain per top-level call**: Each call the developer's own agent makes starts a new chain with a full budget and deadline. The budget bounds the unsupervised tree below that call, where loops and fan-out happen. A session-wide chain would make a long interactive session hit its deadline, and the developer already sees every top-level call.
- **Where limits are set**: As with spec 005's ceilings, the developer sets limits outside the conversation (environment / host configuration). An agent can't raise its own limits through a tool call.
- **Claude Code tiers** (see Clarifications): light = `sonnet` at `low`; balanced = `opus` at `medium`; deep = `fable` at `high`. The bridge uses Claude Code's model aliases so it doesn't break on every model release.
- **Read-only means read-only**: Read-only tools on all three bridges should get the same guarantee as `*_claude` (FR-014). Codex and Antigravity read-only tools currently run with automatic approvals (see the review findings). Aligning them is a related fix, best done during this feature's planning.
- **Process ownership**: Each bridge stays a separate server process per agent, as today. The loop guard lives in the shared core so all three bridges behave the same.
- **Release target**: **v1.0.6**, shipped together with spec 005 (model / effort control, merged in `572cf12`, not yet released) and spec 007. The latest published release is v1.0.5 (`5cacc64`). Every versioned artifact must read 1.0.6 at release time (see `AGENTS.md` → Versioning).
- **Out of scope**: team orchestration (shared task lists, teammates, messaging), which is spec 007 and builds on this guard; remote / HTTP transport (spec 004); token accounting beyond what each agent CLI reports.
- **Dependencies**: Spec 005 (model / effort control) for `configure_claude`. The ability of each host agent to pass settings to the bridges it runs, or the fallback detection in FR-003 where it can't.
