# Contract: `hmcp install team` (Go)

## Install

`hmcp install team [--scope user|project]` does the following for each **detected** host (`claude`, `codex`, `agy`):

1. **Registers the team server** under the server key `team`:
   - Claude Code: `~/.claude.json` (user) or `./.mcp.json` (project);
   - Codex: `~/.codex/config.toml`;
   - Antigravity: `~/.gemini/config/mcp_config.json`.

   The launch command comes from `ResolveServerScript("team")` (a local clone or `npx -y @h0wzy/mcp-server-team`), with `--host <host>` appended. Codex entries get the same `env_vars` and `tool_timeout_sec = 3900` / `startup_timeout_sec = 60` as the other bridges, plus the `H0WZY_TEAM_*` limits and `H0WZY_TEAM_ALLOW_CHECKS` in `env_vars`. Config writers keep the Phase 0 rules: atomic, `0600`, refuse unparsable files.
2. **Copies the skill** `agent-team/SKILL.md`, embedded in the binary from `cli/skills/agent-team/SKILL.md` with `//go:embed`, to every location that host reads:

   | Host | User scope | Project scope (`--scope project`) |
   |---|---|---|
   | Claude Code | `~/.claude/skills/agent-team/SKILL.md` | `./.claude/skills/agent-team/SKILL.md` |
   | Codex | `~/.agents/skills/agent-team/SKILL.md` | `./.agents/skills/agent-team/SKILL.md` |
   | Antigravity CLI | `~/.gemini/antigravity-cli/skills/agent-team/SKILL.md` | `./.agents/skills/agent-team/SKILL.md` |
   | Antigravity IDE | `~/.gemini/config/skills/agent-team/SKILL.md` (only if `~/.gemini/config/` exists) | same as CLI |

   The skill is copied, not symlinked (Windows). An existing file is overwritten only if it contains the marker `installed by hmcp`. Any other file at that path is kept, and the install reports `skipped: a different agent-team skill already exists at <path>`. Writes are atomic, mode `0644`, with folders `0755`.
3. Prints one line per host: `✓ Claude Code: team server + skill (/agent-team)`; `✓ OpenAI Codex: team server + skill ($agent-team)`; `✓ Google Antigravity: team server + skill (/agent-team)`.

`install --all` also installs `team` when at least one host is detected. A host → team edge never forms a cycle in the bridge graph.

## Remove

`hmcp remove team [--scope …]` removes the `team` server key from every host config. It deletes only the skill copies that carry the marker, along with their empty `agent-team/` folder.

## List / doctor

- `hmcp list` shows a `team` row: installed in which hosts.
- `hmcp doctor` adds:

  ```
  👥 Agent team
    claude: server ✓ · skill ✓ ~/.claude/skills/agent-team (current)
    codex: server ✓ · skill ✗ missing (run hmcp install team)
    antigravity: server ✓ · skill ⚠ outdated ~/.gemini/antigravity-cli/skills/agent-team
  ```

  A copy is "current" when it is byte-equal to the embedded file, "outdated" when it carries the marker but differs, and "foreign" when it has no marker. `doctor --json` adds a `team` key with the same data.
- In the bridge graph, `host → team` edges are listed under Bridges, with target `team`.

## Tests

Use a temp HOME and USERPROFILE, plus `t.Chdir` for project scope. Cover:
- install writes the server entry for each detected host and copies all skill files byte-equal to the embedded one;
- a reinstall updates a marked copy in place;
- a foreign file is kept;
- remove deletes only marked copies;
- doctor classifies current, outdated, foreign and missing.
