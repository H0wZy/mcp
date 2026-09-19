import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';

function queryServer(scriptPath, messages) {
  return new Promise((resolve, reject) => {
    const fullPath = path.resolve(process.cwd(), scriptPath);
    const child = spawn(process.execPath, [fullPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: { ...process.env },
    });

    const responses = [];
    let buffer = '';
    let stderrOutput = '';
    let isDone = false;

    const timer = setTimeout(() => {
      if (isDone) return;
      isDone = true;
      child.kill('SIGKILL');
      if (responses.length < messages.length) {
        reject(
          new Error(
            `Timeout (10s) waiting for server responses (received ${responses.length}/${messages.length}).\nStderr: ${stderrOutput}`
          )
        );
      } else {
        resolve(responses);
      }
    }, 10000);

    const finish = (result) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {}
      resolve(result);
    };

    const fail = (err) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {}
      reject(err);
    };

    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep last partial line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          responses.push(JSON.parse(trimmed));
          if (responses.length === messages.length) {
            finish(responses);
            return;
          }
        } catch {
          // ignore non-json lines
        }
      }
    });

    child.stderr.on('data', (err) => {
      stderrOutput += err.toString();
    });

    child.on('error', (err) => {
      fail(new Error(`Failed to spawn child process: ${err.message}\nStderr: ${stderrOutput}`));
    });

    child.on('close', (code) => {
      if (responses.length < messages.length && code !== 0 && code !== null) {
        fail(new Error(`Server exited prematurely with code ${code}.\nStderr: ${stderrOutput}`));
      }
    });

    for (const msg of messages) {
      child.stdin.write(JSON.stringify(msg) + '\n');
    }
  });
}

test('Antigravity MCP server answers initialize and lists all 4 tools', async () => {
  const responses = await queryServer('./servers/antigravity/bin/cli.js', [
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);

  assert.ok(responses.length >= 2, 'Should receive at least 2 responses');
  assert.equal(responses[0].id, 1);
  assert.equal(responses[0].result.serverInfo.name, 'antigravity');

  assert.equal(responses[1].id, 2);
  const toolNames = responses[1].result.tools.map((t) => t.name);
  assert.ok(toolNames.includes('ask_antigravity'), 'Must include ask_antigravity');
  assert.ok(toolNames.includes('review_antigravity'), 'Must include review_antigravity');
  assert.ok(toolNames.includes('brainstorm_antigravity'), 'Must include brainstorm_antigravity');
  assert.ok(toolNames.includes('plan_antigravity'), 'Must include plan_antigravity');
  assert.equal(toolNames.length, 4);
});

test('Codex MCP server answers initialize and lists all 4 tools', async () => {
  const responses = await queryServer('./servers/codex/bin/cli.js', [
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);

  assert.ok(responses.length >= 2, 'Should receive at least 2 responses');
  assert.equal(responses[0].id, 1);
  assert.equal(responses[0].result.serverInfo.name, 'codex');

  assert.equal(responses[1].id, 2);
  const toolNames = responses[1].result.tools.map((t) => t.name);
  assert.ok(toolNames.includes('ask_codex'), 'Must include ask_codex');
  assert.ok(toolNames.includes('review_codex'), 'Must include review_codex');
  assert.ok(toolNames.includes('brainstorm_codex'), 'Must include brainstorm_codex');
  assert.ok(toolNames.includes('plan_codex'), 'Must include plan_codex');
  assert.equal(toolNames.length, 4);
});
