import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EFFORT_LEVELS,
  TIER_NAMES,
  mapEffort,
  isValidEffort,
  isValidTier,
  isValidIdentifier,
  findModelInCatalog,
  findClosestModels,
  createAgentConfig,
} from '../agent-config.js';

test('effort vocabulary and validation', () => {
  assert.deepEqual(EFFORT_LEVELS, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.equal(isValidEffort('low'), true);
  assert.equal(isValidEffort('MAX'), true);
  assert.equal(isValidEffort('extreme'), false);
  assert.equal(isValidTier('light'), true);
  assert.equal(isValidTier('DEEP'), true);
  assert.equal(isValidTier('super'), false);
});

test('mapEffort rounds down to highest supported level or lowest available', () => {
  const supported = ['low', 'medium', 'high'];

  // Exact match
  assert.deepEqual(mapEffort('low', supported), { effort: 'low' });
  assert.deepEqual(mapEffort('high', supported), { effort: 'high' });

  // Map xhigh down to high
  assert.deepEqual(mapEffort('xhigh', supported), { effort: 'high', mappedFrom: 'xhigh' });
  assert.deepEqual(mapEffort('max', supported), { effort: 'high', mappedFrom: 'max' });

  // Pro model with only low and high
  const proSupported = ['low', 'high'];
  assert.deepEqual(mapEffort('medium', proSupported), { effort: 'low', mappedFrom: 'medium' });

  // gpt-oss model with only medium
  const ossSupported = ['medium'];
  assert.deepEqual(mapEffort('low', ossSupported), { effort: 'medium', mappedFrom: 'low' });
});

test('input validation protects against shell injection on Windows', () => {
  assert.equal(isValidIdentifier('gpt-6-astra'), true);
  assert.equal(isValidIdentifier('gemini-3.8-flash'), true);
  assert.equal(isValidIdentifier('model_v1.0'), true);
  assert.equal(isValidIdentifier('model; rm -rf /'), false);
  assert.equal(isValidIdentifier('model & calc.exe'), false);
  assert.equal(isValidIdentifier('model|echo'), false);
  assert.equal(isValidIdentifier(''), false);
});

test('findModelInCatalog matches by id, variant, and display name', () => {
  const catalog = [
    {
      id: 'gemini-3.8-flash',
      displayName: 'Gemini 3.8 Flash',
      efforts: ['low', 'medium', 'high'],
      variants: {
        low: 'gemini-3.8-flash-low',
        high: 'gemini-3.8-flash-high',
      },
    },
  ];

  // By id
  const byId = findModelInCatalog('gemini-3.8-flash', catalog);
  assert.ok(byId);
  assert.equal(byId.entry.id, 'gemini-3.8-flash');

  // By variant
  const byVariant = findModelInCatalog('gemini-3.8-flash-high', catalog);
  assert.ok(byVariant);
  assert.equal(byVariant.entry.id, 'gemini-3.8-flash');
  assert.equal(byVariant.impliedEffort, 'high');

  // By display name with effort in parenthesis
  const byDisplayName = findModelInCatalog('Gemini 3.8 Flash (High)', catalog);
  assert.ok(byDisplayName);
  assert.equal(byDisplayName.entry.id, 'gemini-3.8-flash');
  assert.equal(byDisplayName.impliedEffort, 'high');
});

test('findClosestModels provides useful suggestions for typos', () => {
  const catalog = [
    { id: 'gpt-6-astra', displayName: 'GPT-6-Astra' },
    { id: 'gpt-6-sol', displayName: 'GPT-6-Sol' },
    { id: 'gpt-6-luna', displayName: 'GPT-6-Luna' },
  ];

  const suggestions = findClosestModels('gpt-6-astrax', catalog);
  assert.equal(suggestions[0], 'gpt-6-astra');
});

test('createAgentConfig state machine: get, set, reset, list', () => {
  const config = createAgentConfig({
    provider: 'codex',
    defaultModel: 'gpt-5.6-terra',
    defaultEffort: 'medium',
    env: {},
  });

  // Initial get
  const initial = config.get();
  assert.equal(initial.active.model, 'gpt-5.6-terra');
  assert.equal(initial.active.effort, 'medium');
  assert.equal(initial.active.source, 'startup');

  // Set explicit
  const updated = config.set({ model: 'gpt-6-astra', effort: 'high' });
  assert.equal(updated.active.model, 'gpt-6-astra');
  assert.equal(updated.active.effort, 'high');
  assert.equal(updated.active.source, 'explicit');
  assert.equal(updated.previous.model, 'gpt-5.6-terra');

  // Set tier deep
  const tierDeep = config.set({ tier: 'deep' });
  assert.equal(tierDeep.active.model, 'gpt-6-astra');
  assert.equal(tierDeep.active.effort, 'xhigh');
  assert.equal(tierDeep.active.tier, 'deep');
  assert.equal(tierDeep.active.source, 'tier:deep');

  // Reset
  const resetState = config.reset();
  assert.equal(resetState.active.model, 'gpt-5.6-terra');
  assert.equal(resetState.active.effort, 'medium');
  assert.equal(resetState.active.source, 'startup');

  // List
  const listing = config.list();
  assert.ok(listing.models.length > 0);
  assert.ok(listing.supportedEfforts.includes('ultra'));
});

test('resolveCall provides isolated snapshots without altering session state', () => {
  const config = createAgentConfig({
    provider: 'antigravity',
    defaultModel: 'gemini-3.8-flash',
    defaultEffort: 'high',
    env: {},
  });

  // Call with no override inherits session state
  const call1 = config.resolveCall();
  assert.equal(call1.model, 'gemini-3.8-flash');
  assert.equal(call1.effort, 'high');
  assert.equal(call1.cliModel, 'gemini-3.8-flash-high'); // variant mapped
  assert.equal(call1.source, 'startup');

  // Call with one-off override
  const call2 = config.resolveCall({ model: 'gemini-3.1-pro', effort: 'low' });
  assert.equal(call2.model, 'gemini-3.1-pro');
  assert.equal(call2.effort, 'low');
  assert.equal(call2.cliModel, 'gemini-3.1-pro-low');
  assert.equal(call2.source, 'override');

  // Session state remains unaffected
  const state = config.get();
  assert.equal(state.active.model, 'gemini-3.8-flash');
  assert.equal(state.active.effort, 'high');
});

test('developer ceilings clamp effort and models with explicit warnings', () => {
  const config = createAgentConfig({
    provider: 'codex',
    env: {
      CODEX_MAX_EFFORT: 'medium',
      CODEX_MAX_TIER: 'balanced',
    },
  });

  const res = config.set({ model: 'gpt-6-astra', effort: 'max' });
  // Effort clamped
  assert.equal(res.active.effort, 'medium');
  assert.ok(res.warnings.some((w) => w.includes('clamped to ceiling \'medium\' by CODEX_MAX_EFFORT')));

  // gpt-6-astra (deep) is above the 'balanced' ceiling; that tier is gpt-6-astra at medium
  assert.equal(res.active.model, 'gpt-6-astra');
  assert.ok(res.warnings.some((w) => w.includes("clamped to ceiling 'balanced'")));
});

test('a light tier ceiling swaps the model and re-maps effort to what it supports', () => {
  const config = createAgentConfig({ provider: 'codex', env: { CODEX_MAX_TIER: 'light' } });
  const res = config.set({ model: 'gpt-6-astra', effort: 'ultra' });
  assert.equal(res.active.model, 'gpt-6-luna');
  assert.equal(res.active.effort, 'low'); // capped by the light tier's own effort
  assert.ok(res.warnings.some((w) => w.includes("clamped to ceiling 'light' (gpt-6-luna)")));
});

test('an effort ceiling re-maps to a level the model actually offers', () => {
  const config = createAgentConfig({ provider: 'antigravity', env: { AGY_MAX_EFFORT: 'medium' } });
  // gemini-3.1-pro only offers low and high; medium does not exist for it
  const snapshot = config.resolveCall({ model: 'gemini-3.1-pro', effort: 'high' });
  assert.equal(snapshot.effort, 'low');
  assert.equal(snapshot.cliModel, 'gemini-3.1-pro-low');
  assert.ok(snapshot.warnings.some((w) => w.includes("not supported by gemini-3.1-pro; mapped to 'low'")));
});

test('an unverified model cannot slip under a tier ceiling', () => {
  const config = createAgentConfig({ provider: 'codex', env: { CODEX_MAX_TIER: 'balanced' } });
  const res = config.set({ model: 'gpt-7-nova', effort: 'max' });
  assert.equal(res.active.model, 'gpt-6-astra');
  assert.equal(res.active.effort, 'medium');
});

test("'ultra' effort always carries a cost warning", () => {
  const config = createAgentConfig({ provider: 'codex', env: {} });
  const res = config.set({ model: 'gpt-6-astra', effort: 'ultra' });
  assert.equal(res.active.effort, 'ultra');
  assert.ok(res.warnings.some((w) => w.includes("'ultra'")));
});

test('get() reports the normalized, ceiling-applied startup state', () => {
  const agy = createAgentConfig({ provider: 'antigravity', env: { AGY_MODEL: 'Gemini 3.8 Flash (Low)' } });
  assert.equal(agy.get().active.model, 'gemini-3.8-flash');
  assert.equal(agy.get().active.effort, 'low');

  const codex = createAgentConfig({ provider: 'codex', env: { CODEX_EFFORT: 'max', CODEX_MAX_EFFORT: 'low' } });
  assert.equal(codex.get().active.effort, 'low');
  assert.equal(codex.resolveCall().effort, 'low');
});

test('a session model rejected by the late live catalog falls back to startup instead of failing every call', async () => {
  let release;
  const config = createAgentConfig({
    provider: 'codex',
    env: {},
    catalogLoader: () =>
      new Promise((resolve) => {
        release = () => resolve([{ id: 'gpt-6-astra', displayName: 'GPT-6-Astra', efforts: ['low', 'medium', 'high'] }]);
      }),
  });

  // Accepted unverified while the catalog is still loading
  const res = config.set({ model: 'gpt-7-nova' });
  assert.equal(res.active.model, 'gpt-7-nova');

  release();
  await config.catalogReady();

  const snapshot = config.resolveCall();
  assert.equal(snapshot.model, 'gpt-6-astra');
  assert.ok(snapshot.warnings.some((w) => w.includes("Session model 'gpt-7-nova' is not in the live catalog")));
  assert.equal(config.get().active.model, 'gpt-6-astra');

  // An explicit per-call model that the live catalog rejects is still an error
  assert.throws(() => config.resolveCall({ model: 'gpt-7-nova' }), /not recognized/);
});

test('a slow or failing catalog loader times out and is retried later', async () => {
  let attempts = 0;
  const config = createAgentConfig({
    provider: 'codex',
    env: {},
    catalogTimeoutMs: 50,
    catalogRetryMs: 300,
    catalogLoader: () => {
      attempts += 1;
      return attempts === 1
        ? new Promise((resolve) => setTimeout(() => resolve([]), 1000)) // slower than the 50 ms budget
        : Promise.resolve([{ id: 'gpt-6-astra', displayName: 'GPT-6-Astra', efforts: ['medium'] }]);
    },
  });

  config.ensureCatalogLoading();
  await config.catalogReady();
  // Inside the retry window: reads do not hammer the CLI again
  assert.equal(config.list().catalogStatus, 'failed');
  assert.equal(attempts, 1);

  await new Promise((r) => setTimeout(r, 350));
  config.ensureCatalogLoading();
  await config.catalogReady();
  assert.equal(attempts, 2);
  assert.equal(config.list().catalogSource, 'live');
});

test('environment variable tier overrides', () => {
  const config = createAgentConfig({
    provider: 'antigravity',
    env: {
      AGY_TIER_LIGHT: 'gemini-3.7-flash:low',
    },
  });

  const res = config.set({ tier: 'light' });
  assert.equal(res.active.model, 'gemini-3.7-flash');
  assert.equal(res.active.effort, 'low');
});

test('formatFooter produces standardized text', () => {
  const config = createAgentConfig({ provider: 'codex', env: {} });
  const snapshot = config.resolveCall({ model: 'gpt-6-astra', effort: 'high' });
  const footer = config.formatFooter(snapshot);

  assert.match(footer, /\[codex · model=gpt-6-astra · effort=high · source=override\]/);
});

test('Antigravity builtin tiers resolve to 3.8 flash at low, medium, and high', () => {
  const config = createAgentConfig({ provider: 'antigravity', env: {} });

  const light = config.set({ tier: 'light' });
  assert.equal(light.active.model, 'gemini-3.8-flash');
  assert.equal(light.active.effort, 'low');

  const balanced = config.set({ tier: 'balanced' });
  assert.equal(balanced.active.model, 'gemini-3.8-flash');
  assert.equal(balanced.active.effort, 'medium');

  const deep = config.set({ tier: 'deep' });
  assert.equal(deep.active.model, 'gemini-3.8-flash');
  assert.equal(deep.active.effort, 'high');
});

