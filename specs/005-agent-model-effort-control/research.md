# Research: Agent Model & Reasoning-Effort Control

**Feature**: `specs/005-agent-model-effort-control` | **Date**: 2026-10-05

All findings below were checked against the CLIs installed on the dev machine (`agy`, `codex`) on 2026-10-05, unless marked otherwise.

---

## R1 — How Antigravity takes a model and an effort

**Evidence**
- `agy --help` → `--model <name>`, `--effort low|medium|high|xhigh|max`.
- `agy models` prints `id<TAB>Display Name`. The effort is part of the model variant id, for example `gemini-3.8-flash-high	Gemini 3.8 Flash (High)`. 18 variants exist, across these families: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash` (low/medium/high), `gemini-3.1-pro` (low/high), `claude-opus-5-5`, `claude-sonnet-5-5` (low/medium/high), `gpt-oss-120b` (medium).
- `agy -p … --model gemini-3.8-flash-low --effort high` → **hard error**: `--model gemini-3.8-flash-low conflicts with --effort=high`.
- `agy -p … --model gemini-3.8-flash --effort xhigh` → **hard error**: `gemini-3.8-flash has no "xhigh" effort (available: low, medium, high)`.
- Both errors come back right away (0 turns, 0 tokens), so they cost nothing.
- `agy -p … --model gemini-3.8-flash --effort low` passed validation, but in the probe it hit the 2-minute print timeout with empty output (0 turns). The result is inconclusive, but this form is less proven than variant ids.

**Decision**: Resolve the requested model to a **family** plus an **effort**, then pass the **exact variant id** (for example `gemini-3.8-flash-high`) through `--model` alone, without `--effort`. The `--effort` flag is used only when the model is **not** in the catalog (a family we have never seen). In that case agy does the validation itself.

**Rationale**: The variant id is the form that already works in production (the current default is `Gemini 3.8 Flash (High)`). It can never conflict with `--effort`, and it makes the "explicit effort wins over the suffix in the name" edge case easy to apply: we strip the suffix and build a new id.

**Alternatives considered**
- *Base family + `--effort`*: valid, but agy rejects any effort the family does not have, so we would need the same mapping logic anyway. It adds a second code path for nothing.
- *Pass the user's string through unchanged*: rejected. Effort-in-name and explicit effort would conflict, and the call would fail at run time.

---

## R2 — How Codex takes a model and an effort, including `review`

**Evidence**
- `codex exec --help` → `-m/--model`, `-c key=value` (the value is parsed as TOML; **if TOML parsing fails, the raw string is used as a literal**).
- `codex review --help` lists **no** `-m`, `--color`, `--add-dir` or `-C`. Running `codex review -m foo …` → `error: unexpected argument '-m' found`. **This means the current `review_codex` is broken for every call** (it always passes `-m`).
- `codex review -c model=… -c model_reasoning_effort=… --help` parses without error.
- `~/.codex/config.toml` uses the keys `model` and `model_reasoning_effort`.

**Decision**: For **all** Codex subcommands, set the model and effort the same way: `-c model=<slug> -c model_reasoning_effort=<level>`, with **unquoted** values. `exec` keeps its current extra flags. `review` gets only the flags it accepts: the prompt from stdin, `-c …`, and the process `cwd`. Context `paths` stay in the prompt text.

**Rationale**: `-c` is the one mechanism every subcommand accepts, which satisfies FR-008. Leaving values unquoted avoids `cmd.exe` quote mangling on Windows: `codex` resolves to `codex.cmd`, which runs with `shell: true`. A bare slug like `gpt-6-astra` is not valid TOML, so it is taken as a literal string, which is exactly what we want.

**Alternatives considered**: Keeping `-m` for `exec` and `-c` only for `review` gives two code paths and two ways to get it wrong. Rejected.

---

## R3 — Model catalogs: where they come from, how fast, and the fallback

**Evidence**
- `codex debug models` returns a JSON catalog in **~165 ms** (it is cached locally by the CLI). Each entry has `slug`, `display_name`, `description`, `visibility` (`list` / `hide`), `priority`, `default_reasoning_level` and `supported_reasoning_levels[].effort`. The visible models are: `gpt-6-astra` (efforts low…ultra, "Frontier intelligence for the most demanding work"), `gpt-6-sol`, `gpt-6-luna` (low…max, "Fast and affordable"), `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.5` (low…xhigh).
- `agy models` takes **~22 s** because it fetches over the network.

**Decision**
- Each server owns a **catalog loader** that returns `CatalogEntry[]`. Loading starts **lazily**, on the first call to any tool of that server, so stdio tests never spawn a CLI. The result is cached in memory for the life of the process.
- Any `configure_*` call waits **at most 5 s** for the catalog. If the catalog is not ready, the response uses a **curated built-in list** (source `curated`, `catalogStatus: "loading"`). Loading keeps going in the background, and later calls see the live catalog.
- If the loader fails (CLI missing or offline), the curated list is used for the rest of the session. A retry is allowed after 10 minutes.
- Codex: only entries with `visibility: "list"` are shown. Hidden slugs can still be set if typed exactly.

**Rationale**: Meets FR-011 (5 s cap) and SC-002, keeps the server dependency-free, and does not slow down server startup.

**Alternatives considered**
- *Warm the catalog at server startup*: rejected. It spawns an agy network fetch every time Claude Code starts the MCP server, and in every test.
- *Disk cache in `~/.h0wzy/`*: deferred. It would make Antigravity discovery instant across sessions, but it adds file I/O and invalidation for a small gain. Revisit if 22 s turns out to hurt in practice.

---

## R4 — Shared effort vocabulary and mapping

**Evidence**: agy uses `low|medium|high|xhigh|max`, and each family supports only a subset. Codex supports `low…max` plus **`ultra`** ("Maximum reasoning with automatic task delegation") on some models.

**Decision**
- Shared ordered vocabulary: `low < medium < high < xhigh < max < ultra`. *(Updates spec FR-009 to include `ultra`. It is native to Codex only.)*
- Mapping rule for a requested level `L` on a model that supports levels `S`: pick the **highest supported level ≤ L**. If no level in `S` is ≤ `L`, pick the **lowest level in `S`**. Report `mappedFrom: L` whenever the result differs.
- `ultra` is **never** used by built-in tiers (it spawns its own sub-delegation). It is only applied when explicitly requested, and the response carries a warning.

**Rationale**: Rounding down is the safe choice for cost and quota. Rounding up is only used when nothing lower exists.

---

## R5 — Built-in tiers and tier notes for models

**Decision** — built-in tiers (FR-013). All of them can be overridden by the developer (R7):

| Tier | Antigravity | Codex |
|------|-------------|-------|
| `light` | `gemini-3.8-flash` @ `low` | `gpt-6-luna` @ `low` |
| `balanced` | `gemini-3.8-flash` @ `medium` | `gpt-6-astra` @ `medium` *(= the user's `~/.codex/config.toml`)* |
| `deep` | `gemini-3.8-flash` @ `high` | `gpt-6-astra` @ `xhigh` |

**Model tier notes** (FR-012):
- **Codex**: taken from the catalog `description` by keyword. "frontier" / "most demanding" → `deep`; "fast" / "affordable" / "efficient" → `light`; anything else → `balanced`. The curated list fixes these for the known slugs.
- **Antigravity**: a curated table by family. `gemini-3.8-flash`, `claude-opus-5-5` → `deep`; `gemini-3.1-pro`, `claude-sonnet-5-5` → `balanced`; `gemini-3.7-flash`, `gemini-3.6-flash`, `gpt-oss-120b` → `light`. Unknown families → `balanced`.

**Rationale**: `gemini-3.8-flash` with high reasoning effort outperforms Gemini 3.1 Pro for complex coding, refactoring, and debugging tasks while retaining fast token throughput.


---

## R6 — Session state, snapshots and concurrency

**Decision**: A single shared module, `shared/agent-config.js`, exports a pure `createAgentConfig(options)`. It holds one mutable `current` configuration per server process and exposes `get / set / reset / list / resolveCall(overrides)`. `resolveCall` returns a **frozen snapshot** `{model, effort, cliModel, source, warnings}` that the task tool uses for the whole call. A later `set` replaces `current` but cannot touch snapshots that are already in flight (FR-020, concurrency edge case). Node runs JS on one thread, so no locking is needed.

**Rationale**: One implementation serves both servers. Pure functions are easy to unit-test with an injected catalog loader, and the module follows the existing `shared/` layout.

---

## R7 — Developer configuration (startup defaults, tier overrides, ceiling)

**Decision**: Use environment variables, following the existing `AGY_MODEL` / `CODEX_MODEL` pattern. They can be set per server in every MCP client config (`env` block). Prefix is `AGY_` or `CODEX_`:

| Variable | Meaning | Example |
|----------|---------|---------|
| `<P>_MODEL` *(existing)* | Startup model | `gpt-6-astra` |
| `<P>_EFFORT` | Startup effort | `medium` |
| `<P>_TIER_LIGHT` / `_BALANCED` / `_DEEP` | Tier override, `model[:effort]` | `gpt-6-sol:high` |
| `<P>_MAX_EFFORT` | Effort ceiling | `high` |
| `<P>_MAX_TIER` | Model-strength ceiling, as a tier note | `balanced` |

- Startup effort when `<P>_EFFORT` is unset: Antigravity uses the suffix in `AGY_MODEL` if it has one, otherwise `high`. Codex uses `medium`.
- Invalid env values are ignored, and a warning is shown in `configure_* get`. They never crash the server.
- A ceiling applies to **every** resolution path: set, tier, per-call override and startup default. Clamping is reported in the response (FR-017). Model clamping: if the model's tier note is above `<P>_MAX_TIER`, the strongest model allowed is the matching tier's built-in model.

**Alternatives considered**: A JSON file (`~/.h0wzy/agents.json`) would be more expressive, but it adds file discovery and parsing and diverges from how the hub is configured today. Rejected for v1.

---

## R8 — Input safety for model strings

**Evidence**: Codex runs through `cmd.exe` on Windows (`shell: true` for `.cmd`). The current code passes Claude-supplied `model` strings straight to argv, so a value like `x & calc` is a **command-injection risk today**.

**Decision**: Any value that reaches a CLI argument must match `^[A-Za-z0-9._-]{1,64}$`. Display names such as "Gemini 3.8 Flash (High)" are normalized to ids **before** that check. Effort values come from the closed vocabulary. If a value fails the check, the call is rejected with a clear error and nothing is spawned.

---

## R9 — Reporting what was used

**Decision**: Every task tool response (success or error) ends with a single footer line:

```text
[codex · model=gpt-6-astra · effort=high · source=tier:deep]
```

Warnings (mapping, clamping, unverified model) go after it on one extra line. `configure_*` returns a one-line human summary followed by a JSON object (see [contracts/configure-tool.md](./contracts/configure-tool.md)).

**Rationale**: It is short enough for Claude Code to relay in one line (US3-AS3), and easy to assert in tests.

---

## R10 — Constitution

`.specify/memory/constitution.md` is still the **unfilled template**, so there are no formal gates. The plan applies the principles the previous plans (001–003) used in practice: library-first shared module, zero runtime dependencies, test-first via `node --test`, and simplicity. Running `/speckit-constitution` is recommended so future gates are real.
