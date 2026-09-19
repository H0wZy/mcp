import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer } from '../server.js';
import { resolveBinary } from '../resolver.js';
import { isRateLimitError, isAuthError } from '../errors.js';

test('createMcpServer responds to initialize, ping, and tools/list', async () => {
  let lastOutput = null;
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    lastOutput = JSON.parse(chunk.toString().trim());
    return true;
  };

  try {
    const server = createMcpServer({
      name: 'test-server',
      version: '1.2.3',
      tools: [
        {
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: { type: 'object' },
          handler: async () => 'Hello from test tool!',
        },
      ],
    });

    // 1. initialize
    await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    assert.equal(lastOutput.id, 1);
    assert.equal(lastOutput.result.serverInfo.name, 'test-server');
    assert.equal(lastOutput.result.serverInfo.version, '1.2.3');

    // 2. ping
    await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'ping' });
    assert.equal(lastOutput.id, 2);
    assert.deepEqual(lastOutput.result, {});

    // 3. tools/list
    await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    assert.equal(lastOutput.id, 3);
    assert.equal(lastOutput.result.tools.length, 1);
    assert.equal(lastOutput.result.tools[0].name, 'test_tool');

    // 4. tools/call
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'test_tool', arguments: {} },
    });
    assert.equal(lastOutput.id, 4);
    assert.equal(lastOutput.result.isError, false);
    assert.equal(lastOutput.result.content[0].text, 'Hello from test tool!');
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('resolver finds executables on system', () => {
  const agy = resolveBinary('agy');
  assert.ok(agy, 'agy should be resolved');
  assert.match(agy, /agy(\.exe)?$/i);
});

test('errors detects rate limits and auth errors', () => {
  assert.equal(isRateLimitError('ResourceExhausted: Quota exceeded 429'), true);
  assert.equal(isRateLimitError('Normal response'), false);
  assert.equal(isAuthError('Please sign in with: agy login'), true);
  assert.equal(isAuthError('Success'), false);
});
