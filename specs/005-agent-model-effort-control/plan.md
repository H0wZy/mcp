# Implementation Plan: Agent Model & Reasoning-Effort Control

**Branch**: `005-agent-model-effort-control` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-agent-model-effort-control/spec.md`

---

## Summary

Enable Claude Code and developers to dynamically control the model selection and reasoning effort of delegated agents (Google Antigravity and OpenAI Codex):
1. **Dynamic Configuration Tools**: Expose `configure_antigravity` and `configure_codex` tools supporting `get`, `set`, `reset`, and `list` actions with preset tiers (`light`, `balanced`, `deep`).
2. **Session-Scoped Defaults**: Changes made via `set` persist throughout the MCP server process lifetime for all subsequent task calls unless explicitly overridden per-call.
3. **Task Tool Parity & Effort Overrides**: Update all 10 task tools (`ask_*`, `review_*`, `brainstorm_*`, `plan_*`, `delegate_*`) to support optional `effort` parameters and append standardized execution metadata footers (`[provider · model=... · effort=... · source=...]`).
4. **Resilient Catalogs & Safe Execution**: Implement lazy catalog discovery with 5s timeout fallback to curated lists, strict regex input sanitization, and fix the `review_codex` argument incompatibility via `-c` config overrides.
5. **Developer Guardrails**: Support optional model and effort ceilings via environment variables (`<PROVIDER>_MAX_EFFORT`, `<PROVIDER>_MAX_TIER`).

---

## Technical Context

**Language/Version**: Node.js >= 20.0.0 (ES Modules).

**Primary Dependencies**:
- Native standard library: `node:child_process`, `node:readline`, `node:fs`, `node:path`, `node:os`.
- Zero third-party runtime dependencies.

**Storage**:
- In-memory per server process (`createAgentConfig` closure in `@h0wzy/mcp-shared`).
- No persistent disk writes; server restart returns cleanly to startup defaults.

**Testing**:
- Native Node.js test runner: `node --test test/stdio-verification.test.js`, `node --test test/resilience.test.js`, and `node --test shared/test/*.test.js`.

**Target Platform**:
- Cross-platform: Windows (PowerShell / cmd.exe via `shell: true` for `.cmd`), macOS, Linux.

**Project Type**:
- MCP (Model Context Protocol) JSON-RPC 2.0 stdio server bridge.

**Performance Goals**:
- <5ms latency for `configure_*` calls (`get`, `set`, `reset`).
- <500ms for cached model catalog retrieval.
- <5000ms hard timeout for external CLI catalog fetching before fallback to curated list.

**Constraints**:
- 100% backward compatibility for existing callers passing only `prompt` or `paths`.
- Input validation regex `^[A-Za-z0-9._-]{1,64}$` to prevent shell injection vulnerabilities on Windows.
- Immutable `CallSnapshot` to prevent in-flight calls from having their execution settings mutated.

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I: Library-First**: All agent configuration, catalog discovery, effort mapping, and clamping logic reside in `shared/agent-config.js` and `shared/index.js`, keeping server entrypoints minimal and DRY. (Pass)
- **Principle II: CLI Interface**: Stdio JSON-RPC protocol maintained. Tool outputs provide clear human-readable summaries followed by structured JSON and concise metadata footers. (Pass)
- **Principle III: Test-First**: Stdio protocol tests assert 6 tools per server and test configuration state transitions before and after code modifications. (Pass)
- **Principle IV: Simplicity**: In-memory state machine, closed effort vocabulary, simple environment variable ceilings. Zero complex background daemon requirements. (Pass)

---

## Project Structure

### Documentation (this feature)

```text
specs/005-agent-model-effort-control/
├── spec.md              # Feature specification
├── plan.md              # This implementation plan
├── research.md          # Phase 0 decisions and CLI probe findings
├── data-model.md        # Phase 1 in-memory entities and state transitions
├── quickstart.md        # Phase 1 runnable validation scenarios
├── checklists/
│   └── requirements.md  # Specification quality checklist
├── contracts/           # Phase 1 interface contracts
│   ├── configure-tool.md
│   └── mcp-tools.json
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code Layout

```text
shared/
├── agent-config.js      # [NEW] Configuration engine, catalog loader, effort mapping, ceiling clamping
├── errors.js            # Error formatting and credential redaction
├── executor.js          # Child process execution with timeout and path augmentation
├── index.js             # Shared exports (exports agent-config)
├── resolver.js          # Cross-platform binary resolution
└── test/
    ├── agent-config.test.js # [NEW] Unit tests for config state machine, tiers, ceilings, mapping
    └── server.test.js       # Stdio server protocol tests

servers/
├── antigravity/
│   └── src/index.js     # Exposes configure_antigravity + updated task tools with effort & footers
└── codex/
    └── src/index.js     # Exposes configure_codex + updated task tools with effort & footers (-c fix)

test/
├── resilience.test.js   # Scrubbing and error resilience tests
└── stdio-verification.test.js # Updated to verify 6 tools per server and configure_* tools
```

**Structure Decision**:
- Configuration and catalog logic is centralized in `shared/agent-config.js` so both Antigravity and Codex share identical state-machine mechanics, tier resolution, and clamping behavior.
- `servers/antigravity/src/index.js` and `servers/codex/src/index.js` instantiate their respective `createAgentConfig` stores and inject provider-specific CLI catalog loaders and execution arguments.

---

## Complexity Tracking

No constitution violations detected. Architecture remains zero-dependency, modular, and DRY.
