import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTurn, parseTurn, fitArgv } from '../team/adapters.js';

// resolveBinary accepts an override path only when it is an executable file.
const dir = mkdtempSync(join(tmpdir(), 'hmcp-adapters-'));
const fakeBin = join(dir, process.platform === 'win32' ? 'fake.cmd' : 'fake');
writeFileSync(fakeBin, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', { mode: 0o755 });
for (const key of ['CLAUDE_CLI_PATH', 'CODEX_CLI_PATH', 'AGY_BIN']) process.env[key] = fakeBin;
for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE_BRIDGE_')) delete process.env[key];
// Empty agent configs (FR-026 reads them), never the developer's own.
process.env.CODEX_HOME = dir;
process.env.CLAUDE_CONFIG_DIR = dir;
delete process.env.H0WZY_MCP_USER_SERVERS;
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
  // FR-026 (spec 006): none of the user's MCP servers; no mesh bridge is registered here.
  assert.deepEqual(first.args.slice(13), ['--strict-mcp-config']);
  assert.equal(typeof first.cleanup, 'function');
  assert.equal(first.input, 'P');
  assert.equal(first.env.H0WZY_MCP_CHAIN, 'team>x');
  assert.ok('CLAUDECODE' in first.env && first.env.CLAUDECODE === undefined, 'inherited Claude Code session vars are dropped');
  assert.ok('CLAUDE_CODE_SESSION_ATTENDED' in first.env && first.env.CLAUDE_CODE_SESSION_ATTENDED === undefined);

  const next = buildTurn({ member: { ...base, agent: 'claude', canEdit: true, sessionId: 'abc' }, prompt: 'P', hop: { ...hop, atMaxDepth: true } });
  assert.deepEqual(next.args.slice(9), ['--permission-mode', 'acceptEdits', '--resume', 'abc', '--strict-mcp-config', '--disable-slash-commands']);
});

test('claude turns get the mesh bridges from the user config, and cleanup removes the file', () => {
  const entry = { type: 'stdio', command: 'npx', args: ['-y', '@h0wzy/mcp-server-codex'] };
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { codex: entry, notes: { command: 'notes-mcp' } } }));
  try {
    const turn = buildTurn({ member: { ...base, agent: 'claude', canEdit: false }, prompt: 'P', hop });
    const at = turn.args.indexOf('--mcp-config');
    assert.equal(turn.args[at - 1], '--strict-mcp-config');
    const file = turn.args[at + 1];
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { mcpServers: { codex: entry } });
    turn.cleanup();
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(join(dir, '.claude.json'), { force: true });
  }
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

test('codex turns switch off the user\'s other MCP servers, and the bridges too at the maximum depth', () => {
  writeFileSync(
    join(dir, 'config.toml'),
    '[mcp_servers.claude]\ncommand = "npx"\nargs = ["-y", "@h0wzy/mcp-server-claude"]\n\n[mcp_servers.notes]\ncommand = "notes-mcp"\n'
  );
  try {
    const off = (turn) => turn.args.filter((a) => a.startsWith('mcp_servers.'));
    assert.deepEqual(off(buildTurn({ member: { ...base, agent: 'codex', canEdit: false }, prompt: 'P', hop })), ['mcp_servers.notes.enabled=false']);
    assert.deepEqual(off(buildTurn({ member: { ...base, agent: 'codex', canEdit: false }, prompt: 'P', hop: { ...hop, atMaxDepth: true } })), [
      'mcp_servers.claude.enabled=false',
      'mcp_servers.notes.enabled=false',
    ]);
  } finally {
    rmSync(join(dir, 'config.toml'), { force: true });
  }
});

test('antigravity turns: prompt in -p, JSON output, conversation continued, auto-approve only when editing', () => {
  const ro = buildTurn({ member: { ...base, agent: 'antigravity', canEdit: false, cliEffort: null }, prompt: 'P', hop, minutes: 7.9 });
  assert.deepEqual(ro.args, ['-p', 'P', '--model', 'm1', '--print-timeout', '7m', '--output-format', 'json']);
  const rw = buildTurn({ member: { ...base, agent: 'antigravity', canEdit: true, sessionId: 'conv-9' }, prompt: 'P', hop: { ...hop, atMaxDepth: true }, logFile: '/tmp/agy.log' });
  assert.deepEqual(rw.args.slice(-6), ['--dangerously-skip-permissions', '--conversation', 'conv-9', '--log-file', '/tmp/agy.log', '--disable-slash-commands']);
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

test('parseTurn: a Claude error result reports its errors, not an empty text', () => {
  // Shape verified with Claude Code 2.1.293: no `result` field on errors.
  const stdout = JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, errors: ['Reached maximum budget ($0.05)'], total_cost_usd: 0.38 });
  const res = parseTurn('claude', { ok: false, exitCode: 1, stderr: '', timedOut: false, stdout });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'Reached maximum budget ($0.05)');
  assert.deepEqual(res.usage, { costUsd: 0.38 });
});

test('parseTurn: an agy turn stopped by --print-timeout fails, even though agy says SUCCESS, and names stuck MCP servers', () => {
  // Envelope verified with agy 1.3.1: exit 0, status SUCCESS, empty response.
  const stdout = JSON.stringify({ conversation_id: 'c2', status: 'SUCCESS', response: '', num_turns: 0, usage: { input_tokens: 0, output_tokens: 0 } });
  const stderr = '[agy] print timeout after 20m0s with turn in progress; returning partial output';
  const log = join(dir, 'agy.log');
  writeFileSync(log, 'I1007 mcp_manager.go:875] MCP: 1 server(s) still connecting after 30s: google-flow-remote\n');
  const res = parseTurn('antigravity', { ok: true, exitCode: 0, timedOut: false, stdout, stderr }, { logFile: log });
  assert.equal(res.ok, false);
  assert.equal(res.sessionId, 'c2');
  assert.match(res.error, /^the turn hit agy's --print-timeout\. Antigravity was still waiting for MCP server\(s\) to connect: google-flow-remote\./);
  assert.match(parseTurn('antigravity', { ok: true, exitCode: 0, timedOut: false, stdout, stderr }).error, /^the turn hit agy's --print-timeout$/);
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
