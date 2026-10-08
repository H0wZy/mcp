# Feature Specification: MCP Server Registry

**Feature Branch**: `008-mcp-server-registry`

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description (paraphrased; private names, hosts and paths removed): "hmcp gains a registry of the MCP servers the developer builds. Each entry records a name and a command or URL (e.g. my-server → http://<host>:<port>/my-server/mcp). One command writes them into every client config: Claude Code user scope (~/.claude.json mcpServers), Codex global (~/.codex/config.toml) and project (.codex/config.toml), Antigravity (~/.gemini/config/mcp_config.json). Motivation: moving one of those servers to another folder meant editing four config files by hand. The developer's private servers are NOT merged into H0wZy/mcp: this repo is public, and they deploy differently. The registry code can be public, but the registry contents (names, commands, URLs, hosts, paths) stay private on the developer's machine. Convention: endpoint path /<tool>/mcp, so several servers share one host without clashing."

## Clarifications

### Session 2026-10-08

- Q: After `add` / `update` / `remove`, does hmcp write the client configs by itself, or only on `apply`? → A: They apply the affected entry right away; `apply` re-syncs every entry, and `--no-apply` skips the immediate write.
- Q: Which clients does a new entry go to when the developer names none? → A: All three installed clients by default; `--clients` narrows it; the Antigravity warning is shown at registration.
- Q: A client already has a hand-made entry with the same name: adopt it or treat it as a conflict? → A: Adopt it (hmcp manages it from then on) when it points to the same target; conflict when the target differs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register a server once, use it in every agent (Priority: P1)

A developer has built an MCP server of their own (called `my-server` in these examples) and wants Claude Code, Codex and Antigravity to use it. They register it once in hmcp with a name and either a launch command or a URL. hmcp then writes a matching entry into each client's configuration, so every agent sees the same server under the same name.

**Why this priority**: This is the core value. Today the same server has to be typed into four config files in three formats, by hand.

**Independent Test**: Register one server, run the apply step, and check that each of the three clients lists it and can connect to it. The developer edits no config file by hand.

**Acceptance Scenarios**:

1. **Given** an empty registry and the three clients installed, **When** the developer registers `my-server` with the URL `http://<host>:<port>/my-server/mcp`, **Then**, with no further command, Claude Code (user scope), Codex (global) and Antigravity each list a `my-server` server pointing to that URL.
2. **Given** a server registered with a launch command instead of a URL, **When** the registry is applied, **Then** each client gets an entry that starts that command.
3. **Given** a client that is not installed on the machine, **When** the registry is applied, **Then** that client is skipped with a notice, and the others are still updated.

---

### User Story 2 - Move or change a server in one place (Priority: P1)

The developer moves a server to a new folder, or changes its port or command. They update the entry in the registry once, and every client config that hmcp manages follows.

**Why this priority**: This is the incident that motivated the feature: one of the developer's servers moved folders, and four config files had to be fixed by hand.

**Independent Test**: Change the command or URL of a registered server, apply, and check that every managed client entry now has the new value. Entries hmcp does not manage stay untouched.

**Acceptance Scenarios**:

1. **Given** `my-server` registered and applied, **When** the developer updates its location, **Then** all managed client entries show the new location in that same command, and no stale copy remains.
2. **Given** a registered server, **When** the developer removes it from the registry, **Then** hmcp removes the entries it created for that server, and only those, in that same command.
3. **Given** an update made with `--no-apply`, **When** the developer later runs `apply`, **Then** the client entries change only at that point.

---

### User Story 3 - See where every registered server stands (Priority: P2)

The developer asks hmcp for the state of the registry: for each registered server and each client, whether the client's entry is present, matches the registry, differs, or is missing. Where possible, it also says whether the server answers.

**Why this priority**: Drift (a hand edit, a client reinstall) is otherwise invisible until an agent fails to find a tool.

**Independent Test**: Hand-edit one client's entry, then ask for the status. That entry is reported as differing, and nothing is changed until the developer applies.

**Acceptance Scenarios**:

1. **Given** a registered server whose Codex entry was edited by hand, **When** the developer asks for the status, **Then** that entry is reported as "differs from registry", and the other clients as "in sync".
2. **Given** a registered URL server that is not running, **When** status is requested, **Then** it is reported as unreachable, and the configs are not modified.

---

### User Story 4 - Project-level registration for Codex (Priority: P3)

For a server only one project needs, the developer applies a registered server to the current project's Codex config (`.codex/config.toml` in that project) instead of the global one.

**Why this priority**: The request names the Codex project scope explicitly, but most servers are global.

**Independent Test**: In a project folder, apply one server at project scope, and check that only that project's Codex config gained the entry.

**Acceptance Scenarios**:

1. **Given** a registered server and a project folder, **When** the developer applies it at project scope, **Then** the project's `.codex/config.toml` gains the entry, and the global Codex config is unchanged.

---

### Edge Cases

- A client config already has a server with the same name that hmcp did not create (for example one added by hand).
  - With the same target, hmcp adopts it, so hand-written entries migrate without a conflict.
  - With a different target, hmcp must not overwrite it silently. It reports the conflict and changes it only when the developer explicitly asks.
- A client config file is malformed. hmcp refuses to write to that file, reports it, and keeps going with the other clients.
- A registered name collides with an H0wZy/mcp bridge (`codex`, `antigravity`, `claude`, `team`). Registration is refused, because those names are managed by `hmcp install`.
- Two registered URL servers use the same host and path. hmcp warns, because only one of them can answer there.
- A URL does not follow the `/<tool>/mcp` convention. hmcp accepts it and warns.
- Registering into Antigravity. agy can call any of its MCP servers' tools without asking (see spec 006 research §7), so hmcp states this when a server is applied to Antigravity.
- An agent started by a bridge (spec 006 FR-026) loads only the mesh bridges, not registered servers, unless the developer opts in with `H0WZY_MCP_USER_SERVERS=1`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Developers MUST be able to add, update, list and remove registry entries. Each entry has a unique name and exactly one target: a launch command (with arguments) or a URL.
- **FR-002**: The registry contents MUST stay private. They are stored per user on the developer's machine (or in a private location the developer chooses), never inside the H0wZy/mcp repository, and they never contain server source code. Entries hold a name, a target and optional non-secret metadata, and nothing else. Names, commands, URLs, hosts and paths of the developer's servers reveal private repositories, private network names and local folders, so they are private data even when they are not secrets.
- **FR-003**: The registry MUST NOT store secret values. When a server needs credentials, the entry may name the environment variables the client must forward, never their values.
- **FR-004**: One apply command MUST (re-)write every registered server into each installed client: Claude Code (user scope), Codex (global config) and Antigravity. An entry with no client list goes to all three installed clients. An entry registered with an explicit client list (`--clients`) is written only to those clients.
- **FR-005**: The apply command MUST support the Codex project scope (the current project's `.codex/config.toml`) on request.
- **FR-006**: hmcp MUST track which client entries it created from the registry. Updating or removing a registry entry MUST change only those entries, never entries it did not create.
- **FR-007**: When a client already has an entry with the same name that hmcp did not create:
  - If it points to the same target (same command and arguments, or the same URL), hmcp MUST adopt it as a managed entry and report the adoption.
  - Otherwise, hmcp MUST report a conflict and leave the entry unchanged unless the developer explicitly asks to replace it.
- **FR-008**: Writes to client configs MUST follow the existing config-writer rules: refuse a file that fails to parse, write atomically, and keep the user's file permissions and unrelated content.
- **FR-009**: A status command MUST report, per registered server and per client: in sync, differs, missing, or conflict. For URL targets it MUST also report whether the server answers. The status command MUST NOT modify anything.
- **FR-010**: Names reserved for H0wZy/mcp bridges (`codex`, `antigravity`, `claude`, `team`) MUST be refused as registry names.
- **FR-011**: hmcp MUST warn, without refusing, when a URL's path does not follow `/<tool>/mcp`, and when two entries share the same host and path.
- **FR-012**: When a server is registered for Antigravity (including by default), hmcp MUST state, at registration and on each apply, that Antigravity can call that server's tools without asking, and how to leave it out (`--clients`).
- **FR-013**: The registry MUST work for servers whose code lives in private repositories, using only their name and address. Nothing from those repositories is copied into H0wZy/mcp.
- **FR-014**: Nothing hmcp ships (code, tests, docs, examples) may contain real registry entries. Examples use placeholders such as `my-server` and `<host>`.
- **FR-015**: Adding, updating or removing a registry entry MUST apply that entry to the client configs in the same command, unless the developer passes `--no-apply`. It MUST NOT touch other entries.

### Key Entities

- **Registry entry**: one MCP server the developer owns or uses.
  - name: unique, and not one of the reserved bridge names;
  - target: a launch command with arguments, or a URL;
  - optional: the clients it applies to, environment variable names to forward, and a free-text note.
- **Managed client entry**: a server entry hmcp wrote into a client config from a registry entry. Each one is linked back to its registry entry, so hmcp can update or remove it, and only it.
- **Client**: Claude Code (user scope), Codex (global, or project scope), or Antigravity, each with its own config file and format.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Moving a registered server to a new location takes one registry update and one apply. No client config file is edited by hand, compared with 4 hand edits today.
- **SC-002**: After an apply, 100% of registered servers appear in every installed client they are marked for, under the same name.
- **SC-003**: The target of an entry hmcp did not create is never changed by an apply, including on a conflict: zero silent overwrites. Adopting a matching entry leaves its command or URL as it was.
- **SC-004**: A status check finds every drifted client entry (hand edit, missing entry) in a single run, without modifying anything.
- **SC-005**: No secret value or private source code ends up in the registry, and no registry entry (name, command, URL, host or path of a real server) ends up in the H0wZy/mcp repository.

## Assumptions

- The developer's own servers run either as local commands or as HTTP servers on a host they control (local or on a private network). Hosting and authentication of those servers are out of scope.
- The `/<tool>/mcp` path is a convention the developer's servers follow, so several can share one host and port. hmcp only checks it and warns; it does not enforce it.
- Claude Code project scope (`.mcp.json`) and local scope are out of scope for the first version. Claude Code user scope covers the stated need.
- Antigravity has a single user-level MCP config; there is no project scope for it.
- Moving the hand-written entries that exist today into the registry means registering each server once. Matching client entries are then adopted (FR-007), not duplicated. A helper that imports existing entries could come later.
- Out of scope: a "private servers" showcase in the public README. That would be one neutral line per server plus a contact method, with no URLs, hosts, paths or account details. It is a documentation change that waits for the developer to choose the contact method.
