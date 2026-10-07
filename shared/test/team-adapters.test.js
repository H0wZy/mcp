import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTurn, parseTurn, fitArgv } from '../team/adapters.js';

// resolveBinary accepts an override path only when it is an executable file.
const dir = mkdtempSync(join(tmpdir(), 'hmcp-adapters-'));
const fakeBin = join(dir, process.platform === 'win32' ? 'fake.cmd' : 'fake');
writeFileSync(fakeBin, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', { mode: 0o755 });
for (const key of ['CLAUDE_CLI_PATH', 'CODEX_CLI_PATH', 'AGY_BIN']) process.env[key] = fakeBin;
for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE_BRIDGE_')) delete process.env[key];
test.after(() => rmSync(dir, { recursive: true, force: true }));

const base = { cliModel: 'm1', cliEffort: 'high', workDir: dir, sessionId: null };
const hop = { atMaxDepth: false, childEnv: { H0WZY_MCP_CHAIN: 'team>x' } };

test('claude turns: read-only tools, a new session id, then --resume', () => {
  const first = buildTurn({ member: { ...base, agent: 'claude', canEdit: false }, prompt: 'P', hop });
  assert.equal(first.ok, true);
  assert.deepEqual(first.args.slice(0, 11), ['-p', '--output-format', 'json', '--model', 'm1', '--effort', 'high', '--permission-prompts', 'none', '--tools', 'Read,Grep,Glob']);
  assert.equal(first.args[11], '--session-id');
  assert.match(first.args[12], /^[0-9a-f-]{36}$/);
  assert.equal(first.sessionId, first.args[12]);
  assert.equal(first.input, 'P');
  assert.equal(first.env.H0WZY_MCP_CHAIN, 'team>x');
  assert.ok('CLAUDECODE' in first.env && first.env.CLAUDECODE === undefined, 'inherited Claude Code session vars are dropped');

  const next = buildTurn({ member: { ...base, agent: 'claude', canEdit: true, sessionId: 'abc' }, prompt: 'P', hop: { ...hop, atMaxDepth: true } });
  assert.deepEqual(next.args.slice(9), ['--permission-mode', 'acceptEdits', '--resume', 'abc', '--strict-mcp-config', '--disable-slash-commands']);
});

test('codex turns: read-only sandbox and ephemeral, or workspace-write with approvals; last message to a file', () => {
  const ro = buildTurn({ member: { ...base, agent: 'codex', canEdit: false }, prompt: 'P', hop, outputFile: '/tmp/out.txt' });
  assert.deepEqual(ro.args, [
    '--no-daemon', 'exec', '-c', 'model=m1', '-c', 'model_reasoning_effort=high',
    '-c', 'sandbox_mode=read-only', '-c', 'approval_policy=never',
    '-', '--color', 'never', '--skip-git-repo-check', '--ephemeral', '-o', '/tmp/out.txt', '-C', dir,
  ]);
  const rw = buildTurn({ member: { ...base, agent: 'codex', canEdit: true }, prompt: 'P', hop });
  assert.ok(rw.args.includes('sandbox_mode=workspace-write'));
  assert.ok(rw.args.includes('--approve-for-me'));
  assert.equal(rw.args.includes('--ephemeral'), false);
});

test('antigravity turns: prompt in -p, JSON output, conversation continued, auto-approve only when editing', () => {
  const ro = buildTurn({ member: { ...base, agent: 'antigravity', canEdit: false, cliEffort: null }, prompt: 'P', hop, minutes: 7.9 });
  assert.deepEqual(ro.args, ['-p', 'P', '--model', 'm1', '--print-timeout', '7m', '--output-format', 'json']);
  const rw = buildTurn({ member: { ...base, agent: 'antigravity', canEdit: true, sessionId: 'conv-9' }, prompt: 'P', hop: { ...hop, atMaxDepth: true } });
  assert.deepEqual(rw.args.slice(-4), ['--dangerously-skip-permissions', '--conversation', 'conv-9', '--disable-slash-commands']);
  assert.ok(rw.args.includes('--effort'));
});

test('a missing binary is an actionable error', () => {
  const saved = process.env.CODEX_CLI_PATH;
  process.env.CODEX_CLI_PATH = join(dir, 'nope');
  const savedPath = process.env.PATH;
  process.env.PATH = dir;
  try {
    const res = buildTurn({ member: { ...base, agent: 'codex', canEdit: false }, prompt: 'P', hop });
    if (!res.ok) assert.match(res.error, /`codex` not found\. Install the Codex CLI/);
  } finally {
    process.env.CODEX_CLI_PATH = saved;
    process.env.PATH = savedPath;
  }
  assert.match(buildTurn({ member: { ...base, agent: 'gpt' }, prompt: 'P' }).error, /Unknown agent 'gpt'/);
});

test('parseTurn reads each vendor format', () => {
  const ok = { ok: true, exitCode: 0, stderr: '', timedOut: false };
  const claude = parseTurn('claude', { ...ok, stdout: JSON.stringify({ result: 'R', is_error: false, session_id: 's1', total_cost_usd: 0.5 }) });
  assert.deepEqual(claude, { ok: true, text: 'R', sessionId: 's1', usage: { costUsd: 0.5 }, error: null });

  const agy = parseTurn('antigravity', { ...ok, stdout: JSON.stringify({ conversation_id: 'c1', status: 'success', response: 'A', usage: { input_tokens: 3, output_tokens: 4 } }) });
  assert.deepEqual(agy, { ok: true, text: 'A', sessionId: 'c1', usage: { inputTokens: 3, outputTokens: 4 }, error: null });
  const agyErr = parseTurn('antigravity', { ...ok, stdout: JSON.stringify({ error: 'quota' }) });
  assert.equal(agyErr.ok, false);
  assert.equal(agyErr.error, 'quota');

  const file = join(dir, 'last.txt');
  writeFileSync(file, 'from file');
  assert.equal(parseTurn('codex', { ...ok, stdout: 'noise' }, { outputFile: file }).text, 'from file');
  assert.equal(parseTurn('codex', { ...ok, stdout: 'stdout answer' }, { outputFile: join(dir, 'missing') }).text, 'stdout answer');
  assert.equal(parseTurn('codex', { ...ok, ok: false, exitCode: 2, stdout: '', stderr: 'boom' }).error, 'boom');
  assert.equal(parseTurn('claude', { ...ok, timedOut: true, ok: false, stdout: '' }).error, 'the turn timed out');
});

test('fitArgv keeps the head and tail of a prompt that is too long for a command line', () => {
  assert.equal(fitArgv('short', 100), 'short');
  const long = 'H'.repeat(500) + 'M'.repeat(5000) + 'T'.repeat(500);
  const cut = fitArgv(long, 2000);
  assert.ok(cut.length <= 2000, String(cut.length));
  assert.ok(cut.startsWith('H'.repeat(500)));
  assert.ok(cut.endsWith('T'.repeat(500)));
  assert.match(cut, /characters cut to fit the command line/);
});
