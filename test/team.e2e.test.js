// End-to-end agent team (spec 007): the team server as its own process, with fake
// claude / codex / agy teammates that answer with team-report blocks.
import './helpers/guard-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeAgent, isProcessAlive } from './helpers/fake-agent.js';
import { McpClient } from './helpers/mcp-client.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const TEAM_SERVER = join(root, 'servers', 'team', 'bin', 'cli.js');

const fakes = { claude: createFakeAgent('claude'), codex: createFakeAgent('codex'), agy: createFakeAgent('agy') };
test.after(() => Object.values(fakes).forEach((f) => f.cleanup()));

function startTeam(extra = {}) {
  const state = mkdtempSync(join(tmpdir(), 'hmcp-team-e2e-'));
  const project = mkdtempSync(join(tmpdir(), 'hmcp-team-project-'));
  const env = {
    ...process.env,
    CLAUDE_CLI_PATH: fakes.claude.bin,
    CODEX_CLI_PATH: fakes.codex.bin,
    AGY_BIN: fakes.agy.bin,
    FAKE_AGENT_MODE: 'teammate',
    H0WZY_MCP_STATE_DIR: state,
    ...extra,
  };
  for (const key of Object.keys(env)) if (key.startsWith('CLAUDE_BRIDGE_')) delete env[key];
  const client = new McpClient(TEAM_SERVER, { args: ['--host', 'claude'], env });
  return {
    client,
    state,
    project,
    cleanup: async () => {
      await client.close();
      rmSync(state, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    },
  };
}

async function waitUntil(client, predicate, { rounds = 20 } = {}) {
  const seen = [];
  for (let i = 0; i < rounds; i++) {
    const res = await client.call('team_wait', { timeout_seconds: 30 });
    seen.push(res.text);
    if (predicate(seen.join('\n\n'))) return seen.join('\n\n');
  }
  throw new Error(`condition not met; events:\n${seen.join('\n\n')}`);
}

test('a mixed-vendor team spawns at once, works in parallel and reports compact results', async () => {
  const { client, project, cleanup } = startTeam({ FAKE_TEAMMATE_SLEEP_MS: '1500', FAKE_TEAMMATE_TEXT: 'X'.repeat(300), FAKE_AGENT_LOG: fakes.claude.log });
  try {
    let res = await client.call('team_create', { name: 'squad', cwd: project, limits: { result_cap_chars: 120 } });
    assert.equal(res.isError, false, res.text);
    assert.match(res.text, /Created team "squad"/);
    assert.match(res.text, /results capped at 120 chars/);

    res = await client.call('task_create', {
      tasks: [
        { id: 'A', title: 'review auth' },
        { id: 'B', title: 'design cache' },
        { id: 'C', title: 'write summary', depends_on: ['A', 'B'] },
      ],
    });
    assert.match(res.text, /Created A, B, C/);

    const started = Date.now();
    const spawnRev = await client.call('team_spawn', { name: 'rev', agent: 'codex', role: 'security reviewer', tier: 'deep', task_id: 'A' });
    const spawnArch = await client.call('team_spawn', { name: 'arch', agent: 'antigravity', role: 'architect', tier: 'balanced', task_id: 'B' });
    const spawnWriter = await client.call('team_spawn', { name: 'writer', agent: 'claude', role: 'writes the summary', tier: 'light', task_id: 'C' });
    assert.ok(Date.now() - started < 3000, 'spawns must return before the teammates finish');
    assert.match(spawnRev.text, /^Spawned rev \(codex gpt-6-astra\/xhigh, read-only\) — working on A\./);
    assert.match(spawnArch.text, /^Spawned arch \(antigravity gemini-3\.8-flash\/medium, read-only\) — working on B\./);
    assert.match(spawnWriter.text, /^Spawned writer \(claude sonnet\/low, read-only\) — waiting for C\./);

    const events = await waitUntil(client, (all) => /writer finished C/.test(all));
    // rev and arch were both "working" right after their spawns: they ran in parallel.
    assert.match(events, /\[idle\] rev finished A \(done\) → A completed/);
    assert.match(events, /\[idle\] arch finished B \(done\) → B completed/);
    assert.match(events, /→ C completed/);
    assert.match(events, /… \[\d+ more characters — read them with team_result\("rev#1"\)\]/);

    const full = await client.call('team_result', { ref: 'rev#1' });
    assert.match(full.text, /^fake rev worked on AX{300}/);

    const status = await client.call('team_status');
    assert.match(status.text, /A \[completed\] @rev "review auth"/);
    assert.match(status.text, /C \[completed\] @writer "write summary" ← A,B/);
    assert.match(status.text, /writer \(claude sonnet\/low, read-only\) idle · turns 1\/10 · \$0\.0010/);
    assert.match(status.text, /arch \(antigravity gemini-3\.8-flash\/medium, read-only\) idle · turns 1\/10 · 10\+5 tokens/);

    // The Claude teammate started a session it can resume; it ran read-only.
    const claudeRun = fakes.claude.calls().find((c) => c.argv.includes('--session-id'));
    assert.ok(claudeRun, 'claude teammate should be started with --session-id');
    assert.deepEqual(claudeRun.argv.slice(claudeRun.argv.indexOf('--tools'), claudeRun.argv.indexOf('--tools') + 2), ['--tools', 'Read,Grep,Glob']);
    assert.match(claudeRun.input, /^\[H0wZy\/mcp chain\] You are claude, called by team/);
  } finally {
    await cleanup();
  }
});

test('messages from the lead wake an idle teammate, and unknown names list the valid ones', async () => {
  const { client, project, cleanup } = startTeam();
  try {
    await client.call('team_create', { name: 'pair', cwd: project });
    await client.call('team_spawn', { name: 'dev', agent: 'codex', role: 'implementer' });
    const again = await client.call('team_create', { name: 'pair', cwd: project });
    assert.match(again.text, /^Team "pair" already exists in this session; using it\./);
    const bad = await client.call('team_message', { to: 'nobody', text: 'hi' });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /No teammate 'nobody'\. Valid names: dev\./);
    const queued = await client.call('team_message', { to: 'dev', text: 'please look at foo.js' });
    assert.match(queued.text, /^Queued for dev/);
    const events = await waitUntil(client, (all) => /\[idle\] dev finished its turn/.test(all));
    assert.match(events, /\[idle\] dev finished its turn \(done\)/);
  } finally {
    await cleanup();
  }
});

test('a teammate cannot create a team (nested call)', async () => {
  const { client, project, cleanup } = startTeam({
    H0WZY_MCP_RUN_ID: 'abcdef12',
    H0WZY_MCP_CHAIN: 'team>codex',
    H0WZY_MCP_DEPTH: '1',
    H0WZY_MCP_DEADLINE: String(Date.now() + 600000),
  });
  try {
    const res = await client.call('team_create', { name: 'inner', cwd: project });
    assert.equal(res.isError, true);
    assert.match(res.text, /Teammates can't create teams or spawn teammates/);
  } finally {
    await cleanup();
  }
});

test('shutdown stops a long turn and leaves no teammate process behind', async () => {
  const { client, project, state, cleanup } = startTeam({ FAKE_TEAMMATE_SLEEP_MS: '60000', FAKE_AGENT_PIDFILE: '' });
  try {
    const pidFile = join(state, 'teammate.pid');
    await client.call('team_create', { name: 'slow', cwd: project });
    // FAKE_AGENT_PIDFILE must be in the server's env before the turn starts.
    await client.close();
    const restarted = new McpClient(TEAM_SERVER, {
      args: ['--host', 'claude'],
      env: {
        ...process.env,
        CODEX_CLI_PATH: fakes.codex.bin,
        FAKE_AGENT_MODE: 'teammate',
        FAKE_TEAMMATE_SLEEP_MS: '60000',
        FAKE_AGENT_PIDFILE: pidFile,
        H0WZY_MCP_STATE_DIR: state,
      },
    });
    let res = await restarted.call('team_create', { name: 'slow', cwd: project });
    assert.match(res.text, /Resumed saved team "slow"/);
    await restarted.call('team_spawn', { name: 'w', agent: 'codex', role: 'r', task: 'sleep a minute' });
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 50));
    const { readFileSync } = await import('node:fs');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    res = await restarted.call('team_shutdown', { grace_seconds: 0 });
    assert.match(res.text, /w: stopping/);
    const events = await (async () => {
      for (let i = 0; i < 10; i++) {
        const r = await restarted.call('team_wait', { timeout_seconds: 10 });
        if (/\[stopped\] w/.test(r.text)) return r.text;
      }
      return '';
    })();
    assert.match(events, /\[stopped\] w · T1 released to pending/);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(isProcessAlive(pid), false, 'the teammate process must be gone');
    await restarted.close();
    const agentsDir = join(state, 'agents');
    assert.deepEqual(existsSync(agentsDir) ? readdirSync(agentsDir) : [], [], 'agent registry should be empty');
  } finally {
    rmSync(state, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});
