import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer, SUPPORTED_PROTOCOL_VERSIONS } from '../server.js';

// Runs fn while capturing every JSON-RPC message the server writes to stdout.
async function capture(fn) {
  const messages = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => {
    const text = chunk.toString().trim();
    if (text) messages.push(JSON.parse(text));
    const cb = rest.find((r) => typeof r === 'function');
    if (cb) cb();
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return messages;
}

test('initialize echoes a supported protocol version and falls back to the newest otherwise', async () => {
  const server = createMcpServer({ name: 't', version: '1.0.0' });
  const msgs = await capture(async () => {
    await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  });
  assert.equal(msgs[0].result.protocolVersion, '2024-11-05');
  assert.equal(msgs[1].result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);
});

test('tools/list includes annotations when a tool declares them', async () => {
  const server = createMcpServer({
    name: 't',
    tools: [
      { name: 'a', description: 'a', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true }, handler: () => 'ok' },
      { name: 'b', description: 'b', inputSchema: { type: 'object' }, handler: () => 'ok' },
    ],
  });
  const [msg] = await capture(() => server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  assert.deepEqual(msg.result.tools[0].annotations, { readOnlyHint: true });
  assert.equal('annotations' in msg.result.tools[1], false);
});

test('notifications/cancelled aborts the running tool call and suppresses its response', async () => {
  let sawAbort = false;
  const server = createMcpServer({
    name: 't',
    tools: [
      {
        name: 'slow',
        description: 'slow',
        inputSchema: { type: 'object' },
        handler: (_args, { signal }) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              sawAbort = true;
              resolve('finished after abort');
            });
          }),
      },
    ],
  });

  const msgs = await capture(async () => {
    const call = server.handleMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'slow', arguments: {} } });
    await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } });
    await call;
  });

  assert.equal(sawAbort, true);
  assert.equal(msgs.length, 0, 'a cancelled request must not get a response');
});
