import './helpers/guard-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeAgent, isProcessAlive } from './helpers/fake-agent.js';
import { createServer as createCodexServer } from '../servers/codex/src/index.js';
import { createServer as createAntigravityServer } from '../servers/antigravity/src/index.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

async function call(server, name, args) {
  let reply;
  const originalWrite = process.stdout.write;
  // Only swallow the server's JSON-RPC line; the test runner writes here too.
  process.stdout.write = (chunk, ...rest) => {
    const text = chunk.toString();
    if (!text.startsWith('{"jsonrpc"')) return originalWrite.call(process.stdout, chunk, ...rest);
    reply = JSON.parse(text.trim());
    return true;
  };
  try {
    await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  } finally {
    process.stdout.write = originalWrite;
  }
  return reply.result;
}

for (const [label, createServer, tool] of [
  ['codex', createCodexServer, 'delegate_codex'],
  ['antigravity', createAntigravityServer, 'delegate_antigravity'],
]) {
  test(`${tool} rejects a missing, relative or non-existent cwd before starting the agent`, async () => {
    const server = createServer();
    for (const [cwd, pattern] of [
      [undefined, /absolute path of an existing folder/],
      ['relative/dir', /must be an absolute path/],
      [join(tmpdir(), 'hmcp-definitely-missing-dir'), /does not exist/],
    ]) {
      const result = await call(server, tool, { prompt: 'do it', cwd });
      assert.equal(result.isError, true, `${label}: cwd=${cwd}`);
      assert.match(result.content[0].text, pattern);
    }
  });
}

test('servers stop the agents they started when the client closes stdin', { skip: process.platform === 'win32' }, async () => {
  const fake = createFakeAgent('codex');
  const work = mkdtempSync(join(tmpdir(), 'hmcp-shutdown-'));
  try {
    const server = spawn(process.execPath, [join(repoRoot, 'servers', 'codex', 'bin', 'cli.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CODEX_CLI_PATH: fake.bin, FAKE_AGENT_MODE: 'sleep', FAKE_AGENT_PIDFILE: fake.pidFile },
    });
    const exited = new Promise((resolve) => server.on('exit', resolve));
    server.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'delegate_codex', arguments: { prompt: 'long task', cwd: work } },
      }) + '\n'
    );

    const deadline = Date.now() + 10000;
    while (!existsSync(fake.pidFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(fake.pidFile), 'fake agent never started');
    const agentPid = Number(readFileSync(fake.pidFile, 'utf8'));

    server.stdin.end();
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 8000))]);
    assert.notEqual(code, 'timeout', 'server did not exit after stdin closed');

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(isProcessAlive(agentPid), false, 'agent kept running after the server shut down');
  } finally {
    fake.cleanup();
    rmSync(work, { recursive: true, force: true });
  }
});
