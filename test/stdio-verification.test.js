import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

function queryServer(scriptPath, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const responses = [];
    let buffer = '';

    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep last partial line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          responses.push(JSON.parse(line.trim()));
          if (responses.length === messages.length) {
            child.kill();
            resolve(responses);
          }
        } catch {
          // ignore non-json lines
        }
      }
    });

    child.stderr.on('data', (err) => {
      // keep for debugging
    });

    child.on('error', reject);

    for (const msg of messages) {
      child.stdin.write(JSON.stringify(msg) + '\n');
    }

    setTimeout(() => {
      child.kill();
      resolve(responses);
    }, 4000);
  });
}

test('Antigravity MCP server answers initialize and lists ask_antigravity', async () => {
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
});

test('Codex MCP server answers initialize and lists ask_codex and review_codex', async () => {
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
});
