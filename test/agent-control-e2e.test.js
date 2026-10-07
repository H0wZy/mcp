import './helpers/guard-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createAntigravityServer, agentConfig as agyConfig } from '../servers/antigravity/src/index.js';
import { createServer as createCodexServer, agentConfig as codexConfig } from '../servers/codex/src/index.js';
import { createAgentConfig } from '../shared/agent-config.js';

test('E2E Scenario 1: Both servers register 6 tools including configure_*', async () => {
  const agy = createAntigravityServer();
  const codex = createCodexServer();

  let captured = null;
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    try {
      captured = JSON.parse(chunk.toString().trim());
    } catch {}
    return true;
  };

  try {
    await agy.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(captured.id, 1);
    assert.equal(captured.result.tools.length, 6);
    assert.ok(captured.result.tools.some((t) => t.name === 'configure_antigravity'));

    await codex.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal(captured.id, 2);
    assert.equal(captured.result.tools.length, 6);
    assert.ok(captured.result.tools.some((t) => t.name === 'configure_codex'));
  } finally {
    process.stdout.write = originalWrite;
  }
});


test('E2E Scenario 2: Inspect active settings and catalog via configure_*', async () => {
  const server = createAntigravityServer();
  let captured = null;
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    captured = JSON.parse(chunk.toString().trim());
    return true;
  };

  try {
    // 1. Action: get
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'configure_antigravity', arguments: { action: 'get' } },
    });

    assert.equal(captured.id, 10);
    assert.equal(captured.result.isError, false);
    assert.match(captured.result.content[0].text, /Google Antigravity Active Configuration/);
    assert.match(captured.result.content[0].text, /"source": "startup"/);

    // 2. Action: list
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'configure_antigravity', arguments: { action: 'list' } },
    });

    assert.equal(captured.id, 11);
    assert.equal(captured.result.isError, false);
    assert.match(captured.result.content[0].text, /Model Catalog & Tiers/);
    assert.match(captured.result.content[0].text, /gemini-3.8-flash/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('E2E Scenario 3: Escalate to deep tier and verify snapshot resolution', async () => {
  const server = createCodexServer();
  let captured = null;
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    captured = JSON.parse(chunk.toString().trim());
    return true;
  };

  try {
    // Apply deep tier
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: { name: 'configure_codex', arguments: { action: 'set', tier: 'deep' } },
    });

    assert.equal(captured.id, 20);
    assert.equal(captured.result.isError, false);
    assert.match(captured.result.content[0].text, /gpt-6-astra/);
    assert.match(captured.result.content[0].text, /"tier": "deep"/);

    // Snapshot inherits deep tier
    const snapshot = codexConfig.resolveCall();
    assert.equal(snapshot.model, 'gpt-6-astra');
    assert.equal(snapshot.effort, 'xhigh');
    assert.equal(snapshot.source, 'tier:deep');
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('E2E Scenario 4: Per-call override does not mutate session state', () => {
  // Session is on deep from previous test
  const overrideSnapshot = codexConfig.resolveCall({ model: 'gpt-6-luna', effort: 'low' });
  assert.equal(overrideSnapshot.model, 'gpt-6-luna');
  assert.equal(overrideSnapshot.effort, 'low');
  assert.equal(overrideSnapshot.source, 'override');

  // Verify session remained deep
  const state = codexConfig.get();
  assert.equal(state.active.tier, 'deep');
  assert.equal(state.active.model, 'gpt-6-astra');
});

test('E2E Scenario 5: Reset configuration returns to startup defaults', async () => {
  const server = createCodexServer();
  let captured = null;
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    captured = JSON.parse(chunk.toString().trim());
    return true;
  };

  try {
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: { name: 'configure_codex', arguments: { action: 'reset' } },
    });

    assert.equal(captured.id, 30);
    assert.equal(captured.result.isError, false);
    assert.match(captured.result.content[0].text, /Configuration Reset to Startup Defaults/);
    assert.match(captured.result.content[0].text, /"source": "startup"/);

    const snapshot = codexConfig.resolveCall();
    assert.equal(snapshot.source, 'startup');
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('E2E Scenario 6: Ceiling clamping with warnings', () => {
  const customConfig = createAgentConfig({
    provider: 'antigravity',
    env: {
      AGY_MAX_EFFORT: 'low',
    },
  });

  const setRes = customConfig.set({ effort: 'high' });
  assert.equal(setRes.active.effort, 'low');
  assert.ok(setRes.warnings.some((w) => w.includes('clamped to ceiling \'low\'')));

  const snapshot = customConfig.resolveCall({ effort: 'max' });
  assert.equal(snapshot.effort, 'low');
  assert.ok(snapshot.warnings.some((w) => w.includes('clamped to ceiling \'low\'')));
});

test('E2E Scenario 7: Validation error handling and fuzzy suggestions', async () => {
  const customConfig = createAgentConfig({
    provider: 'codex',
    catalogLoader: async () => [
      { id: 'gpt-6-astra', displayName: 'GPT-6-Astra', efforts: ['low', 'high'] },
      { id: 'gpt-6-sol', displayName: 'GPT-6-Sol', efforts: ['medium'] },
    ],
  });

  // Wait for catalog loader to complete
  customConfig.ensureCatalogLoading();
  await customConfig.catalogReady();

  // Unknown model against a live catalog: rejected with the closest names
  assert.throws(() => customConfig.set({ model: 'gpt-6-astr' }), /not recognized for codex\. Did you mean: gpt-6-astra/);

  // Test invalid effort
  assert.throws(
    () => customConfig.set({ effort: 'insane' }),
    /Invalid reasoning effort 'insane'/
  );

  // Test invalid tier
  assert.throws(
    () => customConfig.set({ tier: 'galactic' }),
    /Invalid tier 'galactic'/
  );
});
