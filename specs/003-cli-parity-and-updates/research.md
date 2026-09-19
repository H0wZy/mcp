# Research & Architectural Decisions: CLI Parity, PATH Aliases, and Auto-Update Engine

## Decision 1: Command Aliases & Global PATH Installation

- **Decision**: Register three distinct binary names:
  1. `hmcp`: Primary recommended alias. 4 letters, alternating hands (`h` right, `m` right, `c` left, `p` right), fast and frictionless.
  2. `hwzmcp`: Alternative user contraction (`h0wzy` + `mcp`).
  3. `h0wzy-mcp`: Official brand name.
- **Rationale**: Providing multiple entrypoints satisfies both ergonomic typing speed and brand clarity. Under Windows, `~/.local/bin` and `npm` global bin (`%APPDATA%\npm`) are already in user PATH. Providing `hmcp setup-path` copies or hardlinks the executable to `~/.local/bin` and writes `.cmd` shims with zero administrator prompts.
- **Alternatives Considered**:
  - Only `hwzmcp`: Rejected because `w` and `z` are typed with adjacent left-hand fingers, creating awkward keyboard friction.
  - Adding aliases via PowerShell profile script: Rejected because PowerShell profile changes do not apply to Command Prompt, Git Bash, or other editors/tools.

---

## Decision 2: Update Detection Strategy & Remote Registry Query

- **Decision**: Query the public npm registry (`https://registry.npmjs.org/@h0wzy/mcp/latest`) with an HTTP GET request (1.5-second timeout) with fallback to GitHub Releases API (`https://api.github.com/repos/H0wZy/mcp/releases/latest`).
- **Rationale**:
  - npm registry has no rate limiting for public metadata requests, unlike the unauthenticated GitHub API (which caps at 60 requests/hour/IP).
  - Responses from npm registry are small JSON payloads (< 2KB) containing the exact current `version` string.
  - Results are cached in `~/.h0wzy/update-check.json` with a 4-hour expiration timestamp. Subsequent CLI calls check this file locally, keeping regular commands 100% offline-capable and sub-50ms.
- **Alternatives Considered**:
  - Synchronous GitHub git tags fetch: Too slow (several seconds) and fails offline.
  - Background daemon for checking updates: Overkill, introduces complexity and lingering processes.

---

## Decision 3: Subcommand Ergonomics (`version` and `upgrade` without `--`)

- **Decision**: Implement `version` and `upgrade` (with `update` as alias) as native first-class Cobra subcommands (`hmcp version`, `hmcp upgrade`), while attaching flags `-v` and `--version` to the root command to preserve POSIX standard compliance.
- **Rationale**:
  - Modern CLIs (e.g. `docker version`, `gh version`, `go version`, `bun upgrade`) provide clean noun/verb subcommands.
  - Users explicitly dislike typing `--` when they can type a single clean word.
  - When running `hmcp upgrade`, the CLI detects whether it was installed via npm (and executes `npm i -g @h0wzy/mcp@latest`) or as a standalone binary (downloading the asset from GitHub Release into `~/.h0wzy/bin/` and `~/.local/bin/`).

---

## Decision 4: Antigravity and Codex Tool Parity

- **Decision**: Provide four matching tools on both servers:
  1. `ask_antigravity` & `ask_codex`: General Q&A, second opinions.
  2. `review_antigravity` & `review_codex`: In-depth code & security review. Pre-framed reviewer prompts that inspect code for correctness, security, performance, and architecture. Both accept `paths: []` to read file context.
  3. `brainstorm_antigravity` & `brainstorm_codex`: Architectural exploration, trade-off comparisons, design patterns.
  4. `plan_antigravity` & `plan_codex`: Implementation roadmaps, phased tasks, and dependency analysis.
- **Rationale**:
  - Claude Code benefits enormously from multi-agent diversity: Gemini (Antigravity) has a 1M+ token context window and strong architectural reasoning; Codex (GPT-5.6 / GPT-6 Astra) is exceptional at code semantics and precision reviews.
  - Standardizing tool names with `ask_*`, `review_*`, `brainstorm_*`, and `plan_*` gives agent clients a predictable mental model.
