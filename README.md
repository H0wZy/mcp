# 🚀 H0wZy/mcp — The Ultimate Multi-Agent MCP Hub & Go CLI

[![CI Pipeline](https://github.com/H0wZy/mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/H0wZy/mcp/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/H0wZy/mcp?color=04B575&label=release&logo=github)](https://github.com/H0wZy/mcp/releases)
[![npm](https://img.shields.io/npm/v/%40h0wzy%2Fmcp?color=CB3837&logo=npm)](https://www.npmjs.com/package/@h0wzy/mcp)
[![Go Version](https://img.shields.io/badge/Go-1.26+-00ADD8?logo=go)](cli)
[![Node Version](https://img.shields.io/badge/Node-20+-339933?logo=node.js)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/H0wZy/mcp)
[![Security Audit: Passed](https://img.shields.io/badge/Security_Audit-Passed-C084FC?logo=shield)](SECURITY_AUDIT.md)

Centralize, enhance, and distribute high-performance **MCP (Model Context Protocol)** servers connecting the world's leading AI developer CLIs:
- **Claude Code** (Anthropic)
- **OpenAI Codex CLI** (GPT-6 family, default GPT-6-Astra)
- **Google Antigravity** (Gemini, default Gemini 3.8 Flash)

Cross-model code reviews, independent second opinions, and autonomous multi-agent validation — configured effortlessly via an interactive **Golang TUI CLI** and distributed via standalone binaries and `npx @h0wzy/mcp`.

🏷️ `#mcp` `#ai-agents` `#multi-agent` `#antigravity` `#claude-code` `#openai-codex` `#gemini` `#cli` `#go` `#bubbletea` `#tui` `#developer-tools` `#model-context-protocol`

---

## 🏛️ Interactive Architecture Diagram

Explore the full interactive system architecture with Light/Dark themes and semantic tracing:
👉 **[View Interactive Architecture Diagram](specs/001-multi-agent-mcp-hub/architecture.html)**

---

## 🌟 Why H0wZy/mcp?

1. **DRY Shared Core (`@h0wzy/mcp-shared`):**
   - Eliminates matrix code duplication across host agents. A single `createMcpServer()` engine manages 100% of JSON-RPC 2.0 stdio protocol handling, error catching, and lifecycle handshakes.
2. **Native Cross-Platform (Zero Windows Glitches):**
   - Eliminates POSIX-only bugs like `PATH.split(':')` by utilizing native path delimiters (`;` on Windows, `:` on POSIX).
   - Resolves executable extensions automatically (`.exe`, `.cmd`, `.bat` from `PATHEXT`), finding `agy.exe` and `codex.cmd` without requiring manual environment path overrides.
3. **Instant Performance (Zero `npx` Latency):**
   - Directly executes local binaries with sub-50ms invocation overhead, removing runtime `npx` network/cache-checking delays.
4. **Resilient Rate Limits & Quotas:**
   - Gracefully traps HTTP 429 and `ResourceExhausted` provider quota limits, returning structured `{ isError: true }` responses so host agents fall back seamlessly without crashing the session.
5. **Interactive Go CLI (`hmcp` / `h0wzy-mcp`):**
   - Auto-detects local CLI installations (`claude`, `codex`, `agy`), tests binary health, checks for updates, and guides the user through an interactive checklist to configure MCP connections globally or per-project.

---

## 📁 Repository Layout

```text
H0wZy/mcp/
├── .github/workflows/          # CI/CD pipelines & cross-platform testing
├── cli/                        # Interactive CLI in Go (Bubble Tea / Lip Gloss)
│   ├── cmd/                    # Commands: doctor, install, list, remove, setup-path, upgrade, version
│   ├── config/                 # Read/write ~/.claude.json, config.toml, and mcp_config.json
│   ├── detector/               # Discovers local claude, codex, and agy CLIs + health checks
│   ├── ui/                     # Terminal user interface, lilac ASCII banner, and interactive TUI
│   └── version/                # Background update detector & registry version cache
├── servers/                    # Decoupled, host-agnostic MCP servers
│   ├── antigravity/            # Google Antigravity bridge (Gemini, default 3.8 Flash)
│   ├── claude/                 # Claude Code bridge (default opus), so Codex/Antigravity can call Claude
│   └── codex/                  # OpenAI Codex CLI bridge (GPT-6, default Astra)
├── shared/                     # Reusable core (@h0wzy/mcp-shared)
│   ├── server.js               # createMcpServer() generic JSON-RPC 2.0 stdio engine
│   ├── chain-guard.js          # Loop guard: depth, cycles, call budget, deadline (spec 006)
│   ├── ancestry.js · l1.js     # Nesting fallback via process ancestry · start agents without bridge tools
│   ├── configure-tool.js       # The configure_<agent> tool shared by every bridge
│   ├── executor.js             # Child process runner: timeouts, tree kill, cancel, output cap
│   ├── validate.js             # cwd / paths / timeout validation for agent command lines
│   ├── agent-config.js         # Model & reasoning-effort catalogs, tiers and ceilings
│   ├── resolver.js             # Cross-platform executable resolver
│   └── errors.js               # Resilient Quota, HTTP 429 handler & secret/token sanitizer
├── npm/                        # Lightweight npx runner wrapper & cross-platform binary installer
├── specs/                      # SpecKit feature specs & Archify diagrams
├── test/                       # Node.js integration & security resilience tests
├── SECURITY_AUDIT.md           # Security audit, credential double-check & hardening report
├── LICENSE                     # MIT License
└── package.json                # Monorepo workspaces configuration
```

---

## 🚀 Quick Start

### 1. Interactive Setup (Recommended)

Choose your preferred way to run H0wZy/mcp:

```bash
# 1. Instant execution via npx (Zero setup):
npx @h0wzy/mcp

# 2. Or install globally via npm (provides 'hmcp', 'hwzmcp', and 'h0wzy-mcp'):
npm install -g @h0wzy/mcp
hmcp

# 3. Or directly from source with Go:
go run ./cli setup-path
hmcp
```

#### 📦 Precompiled Standalone Binaries (v1.0.7)

Download zero-dependency native binaries directly from [Releases](https://github.com/H0wZy/mcp/releases):
- 🪟 **Windows (`amd64`):** [`h0wzy-mcp-windows-amd64.exe`](https://github.com/H0wZy/mcp/releases/download/v1.0.7/h0wzy-mcp-windows-amd64.exe)
- 🐧 **Linux (`amd64`):** [`h0wzy-mcp-linux-amd64`](https://github.com/H0wZy/mcp/releases/download/v1.0.7/h0wzy-mcp-linux-amd64)
- 🍏 **macOS Apple Silicon (`arm64`):** [`h0wzy-mcp-darwin-arm64`](https://github.com/H0wZy/mcp/releases/download/v1.0.7/h0wzy-mcp-darwin-arm64)
- 🍏 **macOS Intel (`amd64`):** [`h0wzy-mcp-darwin-amd64`](https://github.com/H0wZy/mcp/releases/download/v1.0.7/h0wzy-mcp-darwin-amd64)

The CLI will scan your system:
```text
🚀 H0wZy/mcp — Multi-Agent MCP Hub Setup
Scanning local AI developer CLIs...
  ✓ Claude Code (C:\Users\...\claude.exe)
  ✓ OpenAI Codex CLI (C:\Users\...\codex.cmd)
  ✓ Google Antigravity (C:\Users\...\agy.exe)

? Select MCP bridges to configure:
  [x] Claude Code -> Google Antigravity (Gemini)
  [x] Claude Code -> OpenAI Codex (GPT-6)
  [ ] OpenAI Codex -> Google Antigravity (Gemini)

? Configuration Scope: User (Global across all projects)
? Apply configuration now? Yes

✅ All selected bridges configured successfully!
```

---

### 2. Commands & Management

```bash
# Launch interactive TUI setup and configuration
hmcp

# Check version and verify if updates are available
hmcp version

# Upgrade hmcp to latest release (or 'hmcp update')
hmcp upgrade

# Windows, upgrading FROM v1.0.6 or older: those versions can't replace the running
# hmcp.exe, yet still print "Successfully upgraded". Upgrade through another alias,
# then check with 'hmcp version':
h0wzy-mcp upgrade --force

# Setup PATH and shims (~/.local/bin) so 'hmcp', 'hwzmcp', and 'h0wzy-mcp' work everywhere
hmcp setup-path

# Diagnose local environment, paths, and agent communication health
hmcp doctor

# Diagnose and output as JSON ({ tools, bridges, cycles, guard })
hmcp doctor --json

# Install all supported integrations automatically (asks before creating cycles;
# non-interactive runs skip cycle-forming directions unless --allow-cycles is given)
hmcp install --all
hmcp install --all --allow-cycles

# Install a specific bridge globally or locally
hmcp install claude-antigravity --scope user
hmcp install claude-codex --scope project
hmcp install codex-claude          # Codex → Claude Code
hmcp install antigravity-claude    # Antigravity → Claude Code

# List available bridges
hmcp list

# Remove an integration
hmcp remove claude-antigravity
```

---

## 🔌 Available MCP Tools (Symmetrical Parity)

| Provider | Tool Name | Description |
| :--- | :--- | :--- |
| **Antigravity** | `configure_antigravity` | **Session control.** Inspect or switch active model and reasoning effort. Supports tiers (`light`, `balanced`, `deep`), explicit models, or custom efforts (`low`..`max`). Actions: `get`, `set`, `reset`, `list`. |
| **Antigravity** | `ask_antigravity` | Independent second opinion or general inquiry from Gemini 3.8 Flash / Pro |
| **Antigravity** | `review_antigravity` | Comprehensive code & security review inspecting correctness, edge cases, and diffs |
| **Antigravity** | `brainstorm_antigravity` | Architectural exploration, trade-offs, and design patterns with Gemini |
| **Antigravity** | `plan_antigravity` | Structured implementation roadmaps and dependency-ordered execution steps |
| **Antigravity** | `delegate_antigravity` | **Edits files.** Hands an implementation task to Antigravity inside `cwd` (`prompt`, `cwd`, optional `paths`, `model`, `effort`, `timeout_minutes` 1-60, default 30). Review the diff afterwards |
| **Codex** | `configure_codex` | **Session control.** Inspect or switch active model and reasoning effort. Supports tiers (`light`, `balanced`, `deep`), explicit models, or custom efforts (`low`..`ultra`). Actions: `get`, `set`, `reset`, `list`. |
| **Codex** | `ask_codex` | Cross-verification with OpenAI Codex (GPT-6-Astra by default). Read-only sandbox |
| **Codex** | `review_codex` | Structured repository code review from OpenAI Codex. Read-only sandbox |
| **Codex** | `brainstorm_codex` | Architectural exploration, trade-offs, and system design ideation with Codex |
| **Codex** | `plan_codex` | Step-by-step implementation planning and checklist generation |
| **Codex** | `delegate_codex` | **Edits files.** Hands an implementation task to Codex inside `cwd` (workspace-write sandbox; `prompt`, `cwd`, optional `paths`, `model`, `effort`, `timeout_minutes` 1-60, default 30). Review the diff afterwards |
| **Claude Code** | `configure_claude` | **Session control.** Same actions and tiers as the others; models are Claude Code aliases (`opus`, `sonnet`, `haiku`, `fable`) or full ids. |
| **Claude Code** | `ask_claude` | Second opinion from Claude Code. Read-only: only `Read`, `Grep` and `Glob` exist in the session |
| **Claude Code** | `review_claude` | Structured code review. Read-only |
| **Claude Code** | `brainstorm_claude` | Architectural alternatives and trade-offs. Read-only |
| **Claude Code** | `plan_claude` | Dependency-ordered implementation plan. Read-only |
| **Claude Code** | `delegate_claude` | **Edits files.** Hands a task to Claude Code inside `cwd`: edits are auto-approved, anything else that would ask is denied, so it never waits on a prompt |

### 🎛️ Dynamic Model & Reasoning Effort Control

Claude Code can now autonomously (or on request) escalate or de-escalate reasoning power according to task complexity:

| Tier | Task Type Fit | Antigravity Default | Codex Default | Claude Code Default |
| :--- | :--- | :--- | :--- | :--- |
| **`light`** | Quick lookups, summaries, trivial syntax checks | `gemini-3.8-flash` @ `low` | `gpt-6-luna` @ `low` | `sonnet` @ `low` |
| **`balanced`** | Everyday coding, routine code reviews, checklists | `gemini-3.8-flash` @ `medium` | `gpt-6-astra` @ `medium` | `opus` @ `medium` |
| **`deep`** | Complex refactors, architectural trade-offs, security audits | `gemini-3.8-flash` @ `high` | `gpt-6-astra` @ `xhigh` | `fable` @ `high` |

Every task execution appends a standardized verification footer confirming the active settings:
`[codex · model=gpt-6-astra · effort=high · source=tier:deep]`

#### Developer Ceilings & Environment Overrides
To keep resource and quota consumption under strict developer control, set optional ceilings in your client's environment:
- `AGY_MAX_EFFORT` / `CODEX_MAX_EFFORT`: Clamps reasoning effort to a maximum level (e.g. `medium`).
- `AGY_MAX_TIER` / `CODEX_MAX_TIER`: Clamps autonomous model escalation to a maximum tier (e.g. `balanced`).
- `AGY_TIER_LIGHT` / `CODEX_TIER_DEEP`: Override default tier mappings using `model[:effort]` syntax (e.g. `gpt-6-sol:high`).
- Claude Code bridge: the same settings with the `CLAUDE_BRIDGE_` prefix (`CLAUDE_BRIDGE_MODEL`, `CLAUDE_BRIDGE_MAX_TIER`, …), plus `CLAUDE_BRIDGE_MAX_TURNS` and `CLAUDE_BRIDGE_MAX_BUDGET_USD` caps per call. The prefix is not `CLAUDE_`, because Claude Code exports `CLAUDE_EFFORT` and other `CLAUDE_*` variables to its children.

> **Delegation tools write to disk.** `delegate_codex` and `delegate_antigravity` run the agent inside the given `cwd` and may create or modify files. They never commit for you: always review the resulting diff (`git diff`) before keeping the changes.
>
> **Startup defaults:** Antigravity tools default to `Gemini 3.8 Flash (High)` (override with `AGY_MODEL` / `AGY_EFFORT`). Codex tools default to `gpt-6-astra` at `medium` effort (override with `CODEX_MODEL` / `CODEX_EFFORT`). Codex's read-only tools run in Codex's `read-only` sandbox, and Antigravity's run without auto-approval, so actions that need approval are skipped; only the `delegate_*` tools can write.


---

## 🛡️ Loop Guard (agents calling agents)

With bridges in every direction, Codex can ask Antigravity, which asks Claude, which asks Codex… Every bridge runs the same guard **before** it starts an agent:

| Rule | Default | Hard cap | Setting |
| :--- | :--- | :--- | :--- |
| Max depth (A → B → C, then stop) | 2 | 4 | `H0WZY_MCP_MAX_DEPTH` |
| Calling back an agent already in the chain | refused | — | `H0WZY_MCP_ALLOW_REVISIT=1` |
| Bridge calls per chain | 8 | 32 | `H0WZY_MCP_MAX_CALLS` |
| Chain deadline (children never outlive it) | 60 min | 240 min | `H0WZY_MCP_DEADLINE_MINUTES` |

- **Each top-level call starts its own chain.** The chain context travels to child agents in `H0WZY_MCP_*` variables. When a host strips them (Codex forwards only allow-listed variables), the bridge still finds its chain through a registry of running bridge-started agents (`~/.h0wzy-mcp/`) and its process ancestry. If it can't tell, it refuses.
- **No bridge tools at the maximum depth.** An agent started there gets no bridge tools where its CLI allows it (Claude Code `--strict-mcp-config`, Codex `mcp_servers.<name>.enabled=false`), and its prompt opens with its position in the chain.
- **Refusals start nothing.** They come back as `⛔ [Loop guard: …]` errors that tell the calling agent to finish the work itself. Every reply ends with a trace line such as `[chain claude→codex · depth 1/2 · calls 1/8 · run a1b2c3d4]`.
- `H0WZY_MCP_CHAIN_LOG=1` keeps a JSON Lines log at `~/.h0wzy-mcp/chain.log` (run id, agents, depth, outcome, duration; never prompt text).
- `hmcp doctor` lists every installed direction, the cycles they form, and the active limits.

### What an agent started by a bridge loads

A nested agent gets the mesh bridges (`codex`, `antigravity`, `claude`) and **none of your other MCP servers**. Measured on a real setup (11 MCP servers plus the claude.ai connectors in Claude Code, 11 servers in Codex):

| Call | All your MCP servers | Mesh only |
| :--- | :--- | :--- |
| `ask_claude` (Haiku, one-line answer) | ~380k tokens of tool definitions, US$ 0.38 | US$ 0.004 |
| `ask_codex` (one-line answer) | 37 s | 13 s |

- **Claude Code** runs with `--strict-mcp-config` plus a temporary `--mcp-config` that lists only the bridges registered in your user config (`~/.claude.json`, user and local scope). A project's `.mcp.json` is never passed on, because Claude Code asks you before it starts those servers.
- **Codex** runs with `-c mcp_servers.<name>.enabled=false` for every server that isn't a bridge.
- **Antigravity** has no per-call switch, so it always loads every server in `~/.gemini/config/mcp_config.json`, and it **waits until all of them have connected** before it starts. If an Antigravity call returns `⏱️ Antigravity did not finish…` and names a server it was waiting for, bring that server back online or remove it (`agy mcp remove <name>`); `agy mcp disable` was not enough in agy 1.3.1.
  - ⚠️ **Antigravity can call those servers' tools without asking.** In agy 1.3.1 an MCP tool runs without a permission prompt in every mode the bridge uses (read-only `ask_*` / `review_*` / …, and `delegate_antigravity`), and a custom `--agent` with a `tools` list does not restrict it. If your agy config has servers that publish, spend credits or drive other apps (a shop, a video generator, Blender, Unity…), any Antigravity bridge call or agy teammate can reach them. Keep such servers out of agy's config, or don't install the Antigravity bridge on that machine.
  - If agy rejects one MCP tool's schema, every call fails at once; the bridge's error names the tool. `agy mcp disable <server>` fixes that case.
- Read-only calls never reach the bridges' editing tools: nested Claude Code gets `--disallowedTools` for `delegate_*` / `configure_*`, nested Codex gets them in `disabled_tools`, whatever permission mode your own settings give the nested run.
- `H0WZY_MCP_USER_SERVERS=1` lets nested Claude Code and Codex load your own servers again. At the maximum depth they still get none.

---

## 👥 Agent Teams across vendors (spec 007)

`@h0wzy/mcp-server-team` lets **any** of the three agents lead a team whose teammates are any mix of Claude Code, Codex and Antigravity. It works like Claude Code's Agent Teams, but across vendors:

```bash
hmcp install team   # team server in every detected CLI + the agent-team skill where each one finds skills
```

Then, in your usual interactive session:

| Harness | Start a team |
| :--- | :--- |
| Claude Code | `/agent-team review the auth module with a Codex security reviewer and an Antigravity architect` |
| Codex | `$agent-team …` |
| Antigravity | `/agent-team …` |
| Any | Plain language, e.g. "put Codex and Antigravity on this so you don't spend your own tokens" |

- **Background teammates**: `team_spawn` returns at once. Each teammate has a role, a vendor and a tier, and is read-only unless spawned with `can_edit`. Editing teammates work in their own git worktree.
- **Shared task list**: tasks have dependencies, and claims are atomic. Teammates claim the next task themselves, and the orchestrator owns every status change.
- **Messages**: teammates message each other or the lead by name, and an idle teammate wakes for one turn.
- **`team_wait`**: returns as soon as something happens, with compact results capped at 8,000 chars. Full outputs are read on demand with `team_result`, which keeps the lead's own token use low.
- **Hard limits**: 3 teammates, 10 turns each, 30 in total, 60 min (`H0WZY_TEAM_*`). Every turn goes through the loop guard, and teammates can't start teams of their own.
- **Lean teammates**: like any agent a bridge starts, Claude Code and Codex teammates load only the mesh bridges, not your other MCP servers (see above).

See [`servers/team/README.md`](servers/team/README.md) for every tool and setting.

---

## 🔒 Security & Privacy

H0wZy/mcp is built with privacy and execution safety as first-class guarantees:
- **Automatic Token Redaction**: Built-in regex sanitizers proactively scrub OpenAI keys, Google Gemini keys, GitHub/NPM tokens, and Bearer authorization headers before errors or diagnostic messages reach host agents.
- **Owner-Only File Permissions**: Configuration files (`.claude.json`, `.codex/config.toml`, `.gemini/config/mcp_config.json`) are secured with POSIX mode `0600` (`0700` for directories) on Unix systems to prevent unauthorized local reading.
- **Atomic Precompiled Downloads**: The npm binary installer streams release archives to unique temporary files and validates payloads before atomic renames, preventing corrupt or truncated executables.

For full audit methodology and double-check verification, read the [Security Audit & Codebase Integrity Report](SECURITY_AUDIT.md).

---

## 🧪 Testing

```bash
# Run all Node.js MCP server & resilience tests
npm test

# Run all Go CLI detector & config tests
go test -v ./cli/...
```

---

## 📄 License & Acknowledgements

Created and architected by **Marcos (H0wZy)** under the [MIT License](LICENSE).

This project unifies and enhances foundational work from the open-source MCP community:
- [antigravity-claude-mcp](https://github.com/arjunthilak05/antigravity-claude-mcp) by Arjun Thilak (MIT License)
- [codex-mcp-tool](https://github.com/trishchuk/codex-mcp-tool) by Taras Trishchuk (MIT License)
