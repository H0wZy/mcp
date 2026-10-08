---

description: "Task list for spec 008 MCP server registry"
---

# Tasks: MCP Server Registry

**Input**: Design documents from `specs/008-mcp-server-registry/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/cli.md](contracts/cli.md), [quickstart.md](quickstart.md)

**Tests**: Required. `AGENTS.md` says new code in `cli/config/` and `cli/cmd/` needs tests that use `t.TempDir()` and override `HOME` / `USERPROFILE` (see `cli/config/config_test.go`). Tests never need the real `claude`, `codex` or `agy`: the set of installed clients is passed in as a `map[string]bool`.

**Privacy (FR-014)**: every test, comment, doc and example uses placeholders only (`my-server`, `my-other`, `<host>`, `127.0.0.1` from `httptest`). Never a real server name, host, tailnet name or local path.

**Organization**: Tasks are grouped by user story so each story can be built and tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

## Path Conventions

Go CLI module at `cli/` (`github.com/H0wZy/mcp/cli`). Store and client logic in `cli/config/`, cobra command in `cli/cmd/`. Run Go commands from the repo root: `go vet ./cli/...`, `go test ./cli/...`.

---

## Phase 1: Setup

**Purpose**: Shared parsing that the registry reuses

- [X] T001 Refactor `cli/config/bridges.go`: extract the line loop of `codexBridgeEdges` into `parseCodexServers(content string) ([]*codexServer, error)`, add a `url string` field to `codexServer` (parsed with `parseTOMLString` like `command`), and make `codexBridgeEdges` call it. Behavior of `codexBridgeEdges` must not change.
- [X] T002 Add one case to `cli/config/bridges_test.go` asserting `parseCodexServers` returns `url` for a `[mcp_servers.my-server]` section with `url = "http://127.0.0.1:1/my-server/mcp"`; run `go test ./cli/...` to confirm the existing bridge tests still pass after T001.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Registry store, validation, and per-client read/write primitives. Every story depends on them.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests

- [X] T003 [P] Write `cli/config/registry_test.go` covering the store and validation (tests fail until T005–T007):
  - `RegistryPath()` returns `<HOME>/.h0wzy-mcp/registry.json`, or `H0WZY_MCP_REGISTRY` when set;
  - `LoadRegistry` on a missing file returns `{Version: 1, Servers: {}}`; on invalid JSON returns an error containing "refusing to modify"; on an unknown field and on `"version": 2` returns an error;
  - `SaveRegistry` then `LoadRegistry` round-trips; on POSIX (`runtime.GOOS != "windows"`) the file mode is `0600`;
  - `ValidateName` accepts `my-server`, rejects `codex`, `antigravity`, `claude`, `team`, `-x`, `a.b`, a 65-char name;
  - `ValidateEntry` rejects: both `URL` and `Command`; neither; `ftp://` URL; URL with userinfo (`http://u:p@<host>`); `Env` item `A=b` or `1A`; `Env` on a URL entry; unknown client in `Clients`;
  - `RegistryWarnings` reports: URL path not `/<segment>/mcp`; a query string; two entries with the same scheme+host+port+path; a registry path inside a directory containing `.git` (create one under `t.TempDir()`). No warning for `http://127.0.0.1:1/my-server/mcp` alone.
- [X] T004 [P] Write `cli/config/registry_clients_test.go` for the client primitives (fail until T008–T010), with `HOME`/`USERPROFILE` set to `t.TempDir()`:
  - `destinationPath` for `claude`, `codex`, `codex`+project, `antigravity` matches data-model.md;
  - `writeDestination` for a URL entry produces `{"type":"http","url":…}` (Claude), `url = "…"` (Codex), `{"serverUrl":…}` (Antigravity); for a command entry with `Env: ["MY_SERVER_TOKEN"]` produces `type="stdio"`+`command`+`args` (Claude), `command`/`args`/`env_vars` (Codex), `command`/`args` (Antigravity); **no** `--host` argument anywhere;
  - extras survive a rewrite: a Claude entry with `"env": {"K": "v"}`, and a Codex section with `enabled = false`, a multi-line `args = [\n "a",\n "b"\n]` and a `[mcp_servers.my-server.env]` sub-table, keep `env`, `enabled` and the sub-table, and the old `args` lines are gone;
  - switching URL → command removes `url` / `serverUrl`, and command → URL removes `command`/`args`/`env_vars`;
  - other servers and unrelated keys in each file are unchanged after a write (compare parsed JSON; for TOML compare the untouched sections line by line);
  - `readDestination` on invalid JSON, and on a Codex file whose `[mcp_servers.*]` array does not parse, returns an error, and `writeDestination` does not modify the file;
  - `removeDestination` deletes only `my-server` (and its Codex sub-tables);
  - `sameTarget` treats `http://h/x/mcp` and `http://h/x/mcp/` as equal, ignores `env_vars`, and compares args after `filepath.ToSlash`.

### Implementation

- [X] T005 Create `cli/config/registry.go` with the types of data-model.md: `Registry{Version int; Servers map[string]*RegistryEntry}`, `RegistryEntry{URL, Command string; Args, Clients, Env []string; Note string; Applied []Destination}`, `Destination{Client, Project string}` (JSON tags as in data-model.md, `omitempty` on optional fields), `RegistryClients = []string{AgentClaude, AgentCodex, AgentAntigravity}`, `ReservedRegistryNames` (`codex`, `antigravity`, `claude`, `team`), and `RegistryPath()` (research D1).
- [X] T006 In `cli/config/registry.go`, implement `LoadRegistry(path)` (missing or blank → empty v1; `json.Decoder` with `DisallowUnknownFields`; parse error → `&invalidJSONError{…}`; version > 1 → error "written by a newer hmcp") and `SaveRegistry(path, reg)` (`json.MarshalIndent`, `writeFileAtomic(path, …, 0600)`; `writeFileAtomic` already creates the dir with `0700`).
- [X] T007 In `cli/config/registry.go`, implement `ValidateName(name)`, `ValidateEntry(e *RegistryEntry)` and `RegistryWarnings(reg *Registry, path string) []string` per research D10 (regexes `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, `^[A-Za-z_][A-Za-z0-9_]*$`, `^/[^/]+/mcp/?$`; `net/url` for URL parsing; the git check walks the parent dirs of `path` looking for a `.git` entry). Also `(e *RegistryEntry) WantedClients() []string` (all three when `Clients` is empty). Run the T003 tests: they pass.
- [X] T008 Create `cli/config/registry_clients.go` with `destinationPath(d Destination) (string, error)` reusing `getClaudeConfigPath("user")`, `getCodexConfigPath()`, `getAntigravityConfigPath()`, and `filepath.Join(d.Project, ".codex", "config.toml")` for a project destination.
- [X] T009 In `cli/config/registry_clients.go`, implement owned-field handling (research D4): `type ownedFields struct{ Command string; Args []string; URL string; EnvVars []string }`, `renderOwned(client string, e *RegistryEntry) ownedFields`, `readDestination(d Destination, name string) (owned ownedFields, exists bool, err error)` (JSON via `readJSONObject`, reading `url` for Claude and `serverUrl` for Antigravity; Codex via `parseCodexServers`, returning its error so the file is refused), `ownedEqual(a, b ownedFields)` and `sameTarget(a, b ownedFields)` (research D5).
- [X] T010 In `cli/config/registry_clients.go`, implement `writeDestination(d Destination, name string, e *RegistryEntry) error` and `removeDestination(d Destination, name string) error`:
  - JSON: load with `readJSONObject`, set/delete owned keys in `mcpServers[name]` keeping other keys, save with `writeJSONObject`;
  - Codex: new helper `rewriteCodexSection(content, name string, owned ownedFields) string` that uses `splitTOMLSection` to find `[mcp_servers.<name>]`, drops owned keys (consuming multi-line arrays with `parseTOMLStringArray` / `errIncomplete`), writes fresh owned keys right after the header, keeps every other line, and falls back to `upsertTOMLSection` when the section is absent; refuse (return the parse error, write nothing) when `parseCodexServers` fails; save with `writeFileAtomic(…, 0600)`;
  - remove: delete the key for JSON (like `UnregisterClaudeServer`), `removeTOMLSection` for Codex; a missing file is not an error.
  Run the T004 tests: they pass.

**Checkpoint**: store, validation and safe client writes work in isolation.

---

## Phase 3: User Story 1 - Register a server once, use it in every agent (Priority: P1) 🎯 MVP

**Goal**: `hmcp registry add` writes one server into Claude Code, Codex and Antigravity (adopting matching hand entries, reporting conflicts), and `hmcp registry list` shows the registry.

**Independent Test**: In a temp `HOME`, `add my-server --url …` with all three clients "installed" → each client file has the entry; with `antigravity` not installed → skipped with a notice, the other two written.

### Tests for User Story 1

- [X] T011 [P] [US1] Add apply-engine tests to `cli/config/registry_clients_test.go`:
  - `ApplyEntry` on an empty setup writes all three and records three `Destination`s in `Applied`;
  - it respects `Clients: ["claude","codex"]`;
  - a not-installed client yields `not installed` and no file;
  - an unmanaged same-target entry yields `adopted` and keeps its extra keys;
  - an unmanaged different-target entry yields `conflict`, file unchanged, no `Applied` record; with `Replace: true` it is written and recorded;
  - an unreadable Antigravity file yields `unreadable` while Claude and Codex are still written;
  - a second `ApplyEntry` reports all `in sync` and rewrites nothing (contents and mtimes unchanged).
- [X] T012 [P] [US1] Create `cli/cmd/registry_test.go` (temp `HOME`/`USERPROFILE`, `H0WZY_MCP_REGISTRY` under `t.TempDir()`, installed set injected):
  - `registry add my-server --url http://127.0.0.1:1/my-server/mcp` exits 0, writes the three client files and the registry, and prints the Antigravity notice of research D10;
  - `add my-local-server --env MY_SERVER_TOKEN -- node server.js --stdio` stores the argv and env name;
  - `add` refuses a reserved name, a duplicate name, `--env A=b`, both `--url` and a command, and neither;
  - `--no-apply` writes only the registry; `--clients claude,codex` prints no Antigravity notice;
  - a conflict makes the command exit non-zero;
  - `registry list` prints name, target, clients, env names and note.

### Implementation for User Story 1

- [X] T013 [US1] In `cli/config/registry_clients.go`, add the result types and the apply engine:
  - `type DestinationState string` with `in sync`, `differs`, `missing`, `not managed`, `conflict`, `unreadable`, `not installed`;
  - `DestinationResult{Dest Destination; State DestinationState; Action string; Detail string; Err error}` (Action: `written`, `adopted`, `removed`, `dropped`, or empty; Detail: differing fields);
  - `ApplyOptions{Installed map[string]bool; Replace bool; Projects []string}`;
  - one `destinationState(...)` helper implementing the table of research D5, reused later by `EntryStatus`;
  - `ApplyEntry(reg *Registry, name string, opts ApplyOptions) []DestinationResult` for every wanted user-scope destination (`WantedClients()` ∩ installed). Adoption and writes append to `Applied` without duplicates; nothing is recorded for a conflict or a failure.
- [X] T014 [US1] Create `cli/cmd/registry.go`:
  - `registryCmd` (`Use: "registry"`, `Aliases: []string{"reg"}`) added to `rootCmd`, with `add` and `list` subcommands per contracts/cli.md (flags `--url`, `--clients`, `--env` (repeatable), `--note`, `--no-apply`, `--replace`; command target from `cmd.ArgsLenAtDash()`);
  - testable functions `runRegistryAdd(out io.Writer, name string, e *config.RegistryEntry, installed map[string]bool, noApply, replace bool) error` and `runRegistryList(out io.Writer) error`; the cobra `RunE` passes `detectedAgents()` from `cli/cmd/install.go`;
  - order: validate → load registry → refuse duplicate → apply (unless `--no-apply`) → save registry → print one line per `DestinationResult` (contract format, styles from `cli/cmd/styles.go`) → print `RegistryWarnings` → print the Antigravity notice when an Antigravity destination was written → return an error (non-zero exit) when any result is `conflict`, `unreadable` or failed.
  - put result printing in one helper (`printRegistryResults`) that `update`, `remove` and `apply` reuse.
- [X] T015 [US1] Run `go vet ./cli/...` and `go test ./cli/...`; T011 and T012 pass.

**Checkpoint**: MVP. A server registered once appears in every installed client.

---

## Phase 4: User Story 2 - Move or change a server in one place (Priority: P1)

**Goal**: `hmcp registry update` and `hmcp registry remove` change or delete every managed client entry in the same command, and only those. `hmcp registry apply` re-syncs.

**Independent Test**: After `add`, `update my-server -- node <new>/server.js` → every managed entry has the new command, extra hand keys kept; `remove my-server` → managed entries gone, a hand entry `my-other` untouched.

### Tests for User Story 2

- [X] T016 [P] [US2] Add to `cli/config/registry_clients_test.go`:
  - after a target change, `ApplyEntry` rewrites every managed destination (`differs` → `written`);
  - narrowing `Clients` from all three to `["claude"]` removes the managed Codex and Antigravity entries and their `Applied` records;
  - `RemoveEntry` removes only managed destinations and leaves an unmanaged `my-server` entry in a client that was never applied;
  - when one destination file is unreadable, `RemoveEntry` reports it, keeps that `Applied` record and keeps the registry entry.
- [X] T017 [P] [US2] Add to `cli/cmd/registry_test.go`:
  - `registry update my-server --url <new>` rewrites all clients in one command;
  - `update --no-apply` changes only the registry, and a later `registry apply` writes the clients (US2-3);
  - `update` of an unknown name fails; `--env ""` clears the env list;
  - `registry remove my-server` deletes the managed entries and the registry entry;
  - `remove` with an unreadable client file exits non-zero and keeps the registry entry; `remove --no-apply` drops only the registry entry.

### Implementation for User Story 2

- [X] T018 [US2] In `cli/config/registry_clients.go`, extend `ApplyEntry` to clean `Applied` user-scope destinations that are no longer wanted (clients dropped from `Clients`; project destinations are kept), and add `RemoveEntry(reg *Registry, name string) []DestinationResult` that calls `removeDestination` for every `Applied` destination, drops each record that succeeded, and deletes `reg.Servers[name]` only when none failed (research D11).
- [X] T019 [US2] In `cli/cmd/registry.go`, add `update`, `remove` and `apply` subcommands per contracts/cli.md with testable `runRegistryUpdate`, `runRegistryRemove` and `runRegistryApply(out io.Writer, names []string, installed map[string]bool, replace, codexProject bool) error` (all entries when `names` is empty; `codexProject` is wired in T029). `update` changes only the flags given (`cmd.Flags().Changed`), re-validates, and applies unless `--no-apply`. Same output, warnings, Antigravity notice and exit-code rules as `add` (via `printRegistryResults`).
- [X] T020 [US2] Run `go vet ./cli/...` and `go test ./cli/...`; T016 and T017 pass.

**Checkpoint**: moving a server is one `update` (SC-001).

---

## Phase 5: User Story 3 - See where every registered server stands (Priority: P2)

**Goal**: `hmcp registry status` reports per entry × destination state and URL reachability, without writing anything.

**Independent Test**: Hand-edit the Codex `url` of a registered server → `status` shows `codex differs (url)`, others `in sync`, exit non-zero, and every client file and the registry keep their contents and mtime.

### Tests for User Story 3

- [X] T021 [P] [US3] Add to `cli/config/registry_clients_test.go`: `EntryStatus` returns `in sync`, `differs` (with the differing owned field names in `Detail`), `missing`, `conflict`, `unreadable` and `not installed` for the matching setups, and never writes (compare contents and mtimes before/after); `ProbeURL` returns true against an `httptest.Server` answering 405, false against a closed listener, and returns within its timeout.
- [X] T022 [P] [US3] Add to `cli/cmd/registry_test.go`: `registry status` prints one block per entry with `answers` / `unreachable` for URL entries (use `httptest`), lists warnings, exits 0 when all in sync and non-zero after a hand edit, and modifies no file.

### Implementation for User Story 3

- [X] T023 [US3] In `cli/config/registry_clients.go`, implement `EntryStatus(reg *Registry, name string, installed map[string]bool) []DestinationResult` (read-only, built on `destinationState` so `status` and `apply` never disagree; covers recorded project destinations too) and `ProbeURL(u string, timeout time.Duration) bool` (research D6: `GET`, any HTTP response = true).
- [X] T024 [US3] In `cli/cmd/registry.go`, add the `status` subcommand with `runRegistryStatus(out io.Writer, installed map[string]bool) error`: probe URL entries concurrently (`sync.WaitGroup`, 3 s timeout), print per contracts/cli.md, then warnings; return an error when any destination is neither `in sync` nor `not installed`.
- [X] T025 [US3] Run `go vet ./cli/...` and `go test ./cli/...`; T021 and T022 pass.

**Checkpoint**: drift is visible in one read-only run (SC-004).

---

## Phase 6: User Story 4 - Project-level registration for Codex (Priority: P3)

**Goal**: `hmcp registry apply my-server --codex-project` writes the entry into `./.codex/config.toml` and keeps it in step afterwards.

**Independent Test**: In a temp project dir, `apply my-server --codex-project` → the project's `.codex/config.toml` has the entry and `~/.codex/config.toml` is unchanged; a later `update` rewrites the project file too; `remove` cleans it.

### Tests for User Story 4

- [X] T026 [P] [US4] Add to `cli/config/registry_clients_test.go`: `ApplyEntry` with `Projects: [dir]` writes `<dir>/.codex/config.toml`, records `{codex, dir}`, and leaves the global Codex file untouched; a later `ApplyEntry` without `Projects` still re-syncs the recorded project; a recorded project whose dir was deleted is reported and its record dropped; `RemoveEntry` cleans the project file.
- [X] T027 [P] [US4] Add to `cli/cmd/registry_test.go`: `registry apply my-server --codex-project`, run with the working dir set to a temp project (`t.Chdir`), writes only the project file and records its absolute path.

### Implementation for User Story 4

- [X] T028 [US4] In `cli/config/registry_clients.go`, make `ApplyEntry` add a `codex`+project destination for each `opts.Projects` path (absolute, cleaned) and re-sync every recorded project destination whatever `Clients` says (research D8); drop, and report, the record of a project whose directory no longer exists.
- [X] T029 [US4] In `cli/cmd/registry.go`, wire `--codex-project` on `apply` (pass `os.Getwd()` as the project) per contracts/cli.md.
- [X] T030 [US4] Run `go vet ./cli/...` and `go test ./cli/...`; T026 and T027 pass.

**Checkpoint**: all four stories work independently.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T031 [P] Add a short "Your own MCP servers" section to `README.md`: what `hmcp registry` does, the six subcommands, where the registry lives and that it is private, the Antigravity notice, and `H0WZY_MCP_USER_SERVERS=1` for nested agents. Placeholders only (FR-014). No "private servers" showcase (spec Assumptions).
- [X] T032 [P] Update `AGENTS.md`: mention `hmcp registry` in the `cli/` row of the layout table and add spec 008 to "Current roadmap".
- [X] T033 Privacy sweep (SC-005): grep the branch diff (`git diff main...HEAD`) for anything that is not a placeholder (hosts, tailnet names, real server names, user paths such as `C:\Users\` or `/home/`); fix any hit.
- [X] T034 Run the full checks required before a commit: `npm test`, `go vet ./cli/...`, `go test ./cli/...`.
- [X] T035 Walk through [quickstart.md](quickstart.md) on the developer's machine with a throwaway server (needs the real clients, so the developer runs or approves it). Record the Antigravity environment result of quickstart step 6 in research D3.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on Phase 1 (T009 uses `parseCodexServers`). Blocks every story.
- **US1 (Phase 3)**: depends on Phase 2.
- **US2 (Phase 4)**: depends on US1 (`ApplyEntry`, the `registry` command, `printRegistryResults`).
- **US3 (Phase 5)**: depends on Phase 2 and on T013 (`destinationState`); independent of US2.
- **US4 (Phase 6)**: depends on US1 and on T019 (`apply` subcommand); the `remove` case of T026 also needs T018.
- **Polish (Phase 7)**: after the stories that ship.

### Within each story

- Tests first (they fail), then implementation, then the story's `go test` task.
- `cli/config` before `cli/cmd`.

### Parallel Opportunities

- T003 ∥ T004 (different test files).
- In each story, the `cli/config` test task ∥ the `cli/cmd` test task.
- US3 ∥ US2 once T013 is done (they touch the same two source files, so merge carefully).
- T031 ∥ T032.

---

## Parallel Example: User Story 1

```text
Task: "T011 apply-engine tests in cli/config/registry_clients_test.go"
Task: "T012 add/list command tests in cli/cmd/registry_test.go"
```

---

## Implementation Strategy

### MVP first (US1)

1. Phase 1 + Phase 2.
2. Phase 3 (US1). **Stop and validate**: `add` + `list` in a temp `HOME`, then quickstart steps 1–2 on the real machine.

### Incremental delivery

1. US1 → register once (MVP).
2. US2 → move/remove in one place (the incident that motivated the feature; in practice ship it with US1).
3. US3 → status and drift.
4. US4 → Codex project scope.
5. Polish → docs, privacy sweep, full checks, quickstart.

Commit after each phase (Conventional Commits, e.g. `feat(cli): add hmcp registry add and list`), running `npm test`, `go vet ./cli/...` and `go test ./cli/...` before each commit.

---

## Notes

- [P] = different files, no dependency on an unfinished task.
- Never write a real registry entry anywhere in the repo (FR-002, FR-014).
- Never pass a command to a shell; the registry stores argv.
- Client files: refuse unparsable, write atomically, keep `0600`, keep every key hmcp does not own.
