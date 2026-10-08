// The agent-team skill (spec 007 US4) is plain text that three harnesses load; keep it
// consistent with the team server's real tools and with each harness's trigger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Normalize line endings: a Windows checkout may turn LF into CRLF.
const skill = readFileSync(fileURLToPath(new URL('../cli/skills/agent-team/SKILL.md', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const { TEAM_TOOLS } = await import('../servers/team/src/index.js');

test('frontmatter has the name and description every harness requires', () => {
  const front = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(front, 'SKILL.md must start with YAML frontmatter');
  assert.match(front[1], /^name: agent-team$/m);
  const description = front[1].match(/^description: (.+)$/m)?.[1] ?? '';
  assert.ok(description.length > 80 && description.length <= 1024, `description length ${description.length}`);
});

test('the skill carries the hmcp marker so reinstalls can update it', () => {
  assert.match(skill, /installed by hmcp/);
});

test('every tool the skill names exists on the team server', () => {
  const real = new Set(TEAM_TOOLS.map((t) => t.name));
  const params = new Set(['task_id']);
  const named = [...new Set(skill.match(/\b(team|task)_[a-z]+\b/g))].filter((n) => !params.has(n));
  for (const name of named) assert.ok(real.has(name), `SKILL.md mentions ${name}, which the team server does not have`);
  for (const core of ['team_create', 'team_spawn', 'team_wait', 'team_status', 'team_message', 'team_shutdown', 'task_create']) {
    assert.ok(named.includes(core), `SKILL.md should explain ${core}`);
  }
});

test('the skill names each harness trigger and never relies on @', () => {
  assert.match(skill, /`\/agent-team` in Claude Code and Antigravity/);
  assert.match(skill, /`\$agent-team` in Codex/);
  assert.doesNotMatch(skill, /@agent-team/);
});
