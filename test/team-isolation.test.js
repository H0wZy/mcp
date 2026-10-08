// Spec 007 US7: an editing teammate works in its own git worktree; the lead sees its
// change set and the ownership check flags files outside the declared set.
import './helpers/guard-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeAgent } from './helpers/fake-agent.js';
import { McpClient } from './helpers/mcp-client.js';

const hasGit = spawnSync('git', ['--version']).status === 0;
const TEAM_SERVER = join(fileURLToPath(new URL('..', import.meta.url)), 'servers', 'team', 'bin', 'cli.js');

test('an editing teammate edits its own worktree, not the project', { skip: !hasGit && 'git is not installed' }, async () => {
  const fake = createFakeAgent('codex');
  const state = mkdtempSync(join(tmpdir(), 'hmcp-iso-state-'));
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'hmcp-iso-repo-')));
  const git = (...args) => {
    const res = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
  };
  git('init', '-q');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'app.js'), 'old\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');

  const client = new McpClient(TEAM_SERVER, {
    args: ['--host', 'claude'],
    env: { ...process.env, CODEX_CLI_PATH: fake.bin, FAKE_AGENT_MODE: 'teammate', FAKE_TEAMMATE_WRITE: 'notes.txt', H0WZY_MCP_STATE_DIR: state },
  });
  try {
    await client.call('team_create', { name: 'iso', cwd: repo });
    const spawned = await client.call('team_spawn', { name: 'dev', agent: 'codex', role: 'implementer', can_edit: true, owns: ['src/'], task: 'change the app' });
    assert.match(spawned.text, /^Spawned dev \(codex gpt-6-astra\/medium, edits in .*worktrees[\\/]dev\)/);

    let events = '';
    for (let i = 0; i < 10 && !/\[(idle|failed)\] dev/.test(events); i++) events += (await client.call('team_wait', { timeout_seconds: 30 })).text + '\n';
    assert.match(events, /\[ownership\] dev changed files outside its declared set: notes\.txt/);
    assert.match(events, /\[idle\] dev finished T1 \(done\)/);
    assert.equal(existsSync(join(repo, 'notes.txt')), false, 'the project folder must be untouched');

    const changes = await client.call('team_changes', { member: 'dev' });
    assert.match(changes.text, /Change set of dev/);
    assert.match(changes.text, /notes\.txt/);
    assert.match(changes.text, /Full diff: team_result\("dev#changes-\d+"\)/);
    const ref = changes.text.match(/team_result\("([^"]+)"\)/)[1];
    const diff = await client.call('team_result', { ref });
    assert.match(diff.text, /\+changed by dev/);

    const removed = await client.call('team_changes', { member: 'dev', remove: true });
    assert.match(removed.text, /Worktree removed\./);
  } finally {
    await client.close();
    fake.cleanup();
    rmSync(state, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});
