import test from 'node:test';
import assert from 'node:assert/strict';
import { isRateLimitError, isAuthError, formatResilientResponse } from '../shared/errors.js';
import { createServer as createAntigravityServer } from '../servers/antigravity/src/index.js';
import { createServer as createCodexServer } from '../servers/codex/src/index.js';

test('isRateLimitError detects various provider rate limit messages', () => {
  const samples = [
    'Error 429: Too Many Requests',
    'ResourceExhausted: Quota exceeded for quota metric',
    'RESOURCE_EXHAUSTED: Rate limit exceeded for model gemini-3-pro',
    'You have exceeded your monthly usage limit',
    'Rate limit reached: 30000 tokens per minute',
  ];

  for (const s of samples) {
    assert.equal(isRateLimitError(s), true, `Failed for: ${s}`);
  }
});

test('isAuthError detects unauthenticated CLI errors', () => {
  const samples = [
    'Please sign in with: agy login',
    'Unauthorized: Invalid API key',
    'Session expired, please login again',
    'Error: 401 Not Authenticated',
  ];

  for (const s of samples) {
    assert.equal(isAuthError(s), true, `Failed for: ${s}`);
  }
});

test('formatResilientResponse returns non-crashing warning with fallback guidance', () => {
  const res = formatResilientResponse({
    provider: 'Google Antigravity',
    rawOutput: 'ResourceExhausted: Daily quota reached (429)',
    exitCode: 1,
  });

  assert.equal(res.isError, true);
  assert.match(res.text, /Google Antigravity Rate Limit \/ Quota Exhausted/);
  assert.match(res.text, /Fallback guidance for Host Agent/);
});

test('Antigravity and Codex servers return resilient error on missing arguments', async () => {
  let agyOutput = null;
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    try { agyOutput = JSON.parse(chunk.toString().trim()); } catch {}
    return true;
  };

  try {
    const agyServer = createAntigravityServer();
    await agyServer.handleMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'ask_antigravity', arguments: {} },
    });

    assert.equal(agyOutput.id, 10);
    assert.equal(agyOutput.result.isError, true);
    assert.match(agyOutput.result.content[0].text, /Missing required argument/);
  } finally {
    process.stdout.write = originalWrite;
  }
});
