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

  // Model clamped (gpt-6-astra is deep, max tier is balanced -> gpt-6-astra mapped to balanced tier model)
  assert.equal(res.active.model, 'gpt-6-astra'); // balanced tier model for codex
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

