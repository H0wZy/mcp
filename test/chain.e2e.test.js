// End-to-end loop guard (spec 006): real bridge servers, fake agents that keep
// delegating forever. The chain must stop at the guard, with or without the host
// forwarding the chain environment.
import './helpers/guard-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeAgent } from './helpers/fake-agent.js';
import { callBridge } from './helpers/bridge-client.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const CODEX_SERVER = join(root, 'servers', 'codex', 'bin', 'cli.js');
const AGY_SERVER = join(root, 'servers', 'antigravity', 'bin', 'cli.js');

const codexFake = createFakeAgent('codex');
const agyFake = createFakeAgent('agy');

// codex keeps asking antigravity, antigravity keeps asking codex.
const LOOP = {
  codex: { server: AGY_SERVER, host: 'codex', tool: 'ask_antigravity' },
  agy: { server: CODEX_SERVER, host: 'antigravity', tool: 'ask_codex' },
};

test.after(() => {
  codexFake.cleanup();
  agyFake.cleanup();
});

function scenario(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hmcp-chain-'));
  const env = {
    ...process.env,
    CODEX_CLI_PATH: codexFake.bin,
    AGY_BIN: agyFake.bin,
    FAKE_AGENT_MODE: 'bridge',
    FAKE_BRIDGE_PLAN: JSON.stringify(LOOP),
    H0WZY_MCP_STATE_DIR: dir,
    H0WZY_MCP_CHAIN_LOG: '1',
    ...extra,
  };
  return { dir, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function onlyRun(dir) {
  const runs = readdirSync(join(dir, 'runs'));
  assert.equal(runs.length, 1, `expected one chain, got ${runs.join(', ')}`);
  return runs[0];
}

function assertNoAgentsLeft(dir) {
  const agentsDir = join(dir, 'agents');
  assert.deepEqual(existsSync(agentsDir) ? readdirSync(agentsDir) : [], [], 'agent registry should be empty after the chain');
}

test('a forwarded chain stops at the first revisit, two hops in', async () => {
  const { dir, env, cleanup } = scenario();
  try {
    const result = await callBridge(CODEX_SERVER, { host: 'tester', tool: 'ask_codex', args: { prompt: 'loop' }, env });
    const text = result.content[0].text;
    assert.equal(result.isError, false, text);
    assert.doesNotMatch(text, /RUNAWAY/);
    assert.match(text, /fake codex asked ask_antigravity:/);
    assert.match(text, /fake agy asked ask_codex:\n⛔ \[Loop guard: cycle\] Not started: codex is already in the chain tester → codex → antigravity/);
    assert.match(text, /\[chain tester→codex→antigravity · depth 2\/2 · calls 2\/8 · run [0-9a-f]{8}\]/);
    assert.match(text, /\[chain tester→codex · depth 1\/2 · calls 1\/8 · run [0-9a-f]{8}\]$/);

    const run = onlyRun(dir);
    assert.deepEqual(readdirSync(join(dir, 'runs', run, 'calls')).sort(), ['1', '2']);
    assertNoAgentsLeft(dir);

    const log = readFileSync(join(dir, 'chain.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(
      log.map((l) => `${l.caller}>${l.agent}:${l.outcome}`).sort(),
      ['antigravity>codex:refused:cycle', 'codex>antigravity:ran', 'tester>codex:ran']
    );
    assert.ok(log.every((l) => l.run === run));
    assert.doesNotMatch(JSON.stringify(log), /loop|delegating/, 'the log must not contain prompt text');
  } finally {
    cleanup();
  }
});

test('with revisits allowed, the depth limit still stops the chain', async () => {
  const { dir, env, cleanup } = scenario({ H0WZY_MCP_ALLOW_REVISIT: '1' });
  try {
    const result = await callBridge(CODEX_SERVER, { host: 'tester', tool: 'ask_codex', args: { prompt: 'loop' }, env });
    const text = result.content[0].text;
    assert.doesNotMatch(text, /RUNAWAY/);
    assert.match(text, /⛔ \[Loop guard: depth limit\] Not started: antigravity is at depth 2 of 2, the maximum, so it can't start codex/);
    assertNoAgentsLeft(dir);
  } finally {
    cleanup();
  }
});

test('a host that strips the chain env is still caught through the agent registry', async () => {
  const { dir, env, cleanup } = scenario({ FAKE_AGENT_STRIP_ENV: '1', H0WZY_MCP_ALLOW_REVISIT: '1' });
  try {
    const result = await callBridge(CODEX_SERVER, { host: 'tester', tool: 'ask_codex', args: { prompt: 'loop' }, env, timeoutMs: 120000 });
    const text = result.content[0].text;
    assert.doesNotMatch(text, /RUNAWAY/);
    assert.match(text, /⛔ \[Loop guard: depth limit\]/);
    // One chain, not a new chain per nested bridge.
    const run = onlyRun(dir);
    assert.match(text, new RegExp(`\\[chain tester→codex→antigravity · depth 2/2 · calls 2/8 · run ${run}\\]`));
    assertNoAgentsLeft(dir);
  } finally {
    cleanup();
  }
});

test('the budget refuses the call that would exceed it, and the trace shows it', async () => {
  const { env, cleanup } = scenario({ H0WZY_MCP_MAX_CALLS: '1' });
  try {
    const result = await callBridge(CODEX_SERVER, { host: 'tester', tool: 'ask_codex', args: { prompt: 'loop' }, env });
    const text = result.content[0].text;
    assert.match(text, /fake codex asked ask_antigravity:\n⛔ \[Loop guard: call budget\] Not started: the chain already used its 1 bridge calls/);
  } finally {
    cleanup();
  }
});
