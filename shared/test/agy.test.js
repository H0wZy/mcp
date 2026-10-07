import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { createAgyLog, hitPrintTimeout, parseAgyEnvelope, readLogTail, stuckMcpServers, stuckServersHint } from '../agy.js';

test('hitPrintTimeout spots agy stopping at its own --print-timeout', () => {
  assert.equal(hitPrintTimeout('[agy] print timeout after 2m0s with turn in progress; returning partial output'), true);
  assert.equal(hitPrintTimeout('Skipped write_file: not allowed'), false);
  assert.equal(hitPrintTimeout(undefined), false);
});

test('stuckMcpServers reads the last "still connecting" line', () => {
  const log = [
    'I1007 17:13:14.488184 326 mcp_manager.go:875] MCP: 2 server(s) still connecting after 30s: google-flow-remote, slow-one',
    'I1007 17:13:44.487902 326 mcp_manager.go:875] MCP: 1 server(s) still connecting after 1m0s: google-flow-remote',
    'W1007 17:13:46.995867 1 poll.go:188] Print mode: print timeout after 40s with turn in progress',
  ].join('\r\n');
  assert.deepEqual(stuckMcpServers(log), ['google-flow-remote']);
  assert.deepEqual(stuckMcpServers(log.split('\r\n')[0]), ['google-flow-remote', 'slow-one']);
  assert.deepEqual(stuckMcpServers('nothing here'), []);
});

test('stuckServersHint names the servers and how to get unstuck', () => {
  assert.equal(stuckServersHint([]), '');
  const one = stuckServersHint(['google-flow-remote']);
  assert.match(one, /connect: google-flow-remote\. /);
  assert.match(one, /Bring it back online or remove it \(`agy mcp remove google-flow-remote`\)/);
  assert.match(stuckServersHint(['a', 'b']), /connect: a, b\. .*Bring them back online or remove them/);
});

test('createAgyLog gives a private path, reads it back and removes it', () => {
  const log = createAgyLog();
  assert.equal(log.read(), '');
  writeFileSync(log.file, 'MCP: 1 server(s) still connecting after 30s: x\n');
  assert.deepEqual(stuckMcpServers(log.read()), ['x']);
  log.cleanup();
  assert.equal(existsSync(log.file), false);
  assert.equal(readLogTail(log.file), '');
});

test('parseAgyEnvelope reads the JSON envelope (verified with agy 1.3.1)', () => {
  const envelope = { conversation_id: 'c1', status: 'SUCCESS', response: 'PONG', duration_seconds: 1, num_turns: 1, usage: { input_tokens: 3 } };
  assert.deepEqual(parseAgyEnvelope(JSON.stringify(envelope)), envelope);
  assert.deepEqual(parseAgyEnvelope(`some banner\n${JSON.stringify(envelope)}`), envelope);
  assert.equal(parseAgyEnvelope('plain text answer'), null);
  assert.equal(parseAgyEnvelope('{"other": 1}'), null);
});
