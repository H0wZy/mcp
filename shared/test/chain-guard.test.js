import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beginHop, loadPolicy, readEnvChain, formatTrace, agentName, logRefusal, createRootChain } from '../chain-guard.js';

function freshDir() {
  return mkdtempSync(join(tmpdir(), 'hmcp-guard-'));
}

function envFor(dir, extra = {}) {
  return { H0WZY_MCP_STATE_DIR: dir, ...extra };
}

// Child env of one hop, as the next bridge would see it.
function nestedEnv(hop, extra = {}) {
  return { ...hop.childEnv, ...extra };
}

const noAncestors = () => [];

test('policy defaults, clamping and invalid values', () => {
  assert.deepEqual(
    (({ maxDepth, maxCalls, allowRevisit, deadlineMinutes, logEnabled }) => ({ maxDepth, maxCalls, allowRevisit, deadlineMinutes, logEnabled }))(loadPolicy({})),
    { maxDepth: 2, maxCalls: 8, allowRevisit: false, deadlineMinutes: 60, logEnabled: false }
  );
  const clamped = loadPolicy({ H0WZY_MCP_MAX_DEPTH: '9', H0WZY_MCP_MAX_CALLS: '100', H0WZY_MCP_DEADLINE_MINUTES: '999' });
  assert.equal(clamped.maxDepth, 4);
  assert.equal(clamped.maxCalls, 32);
  assert.equal(clamped.deadlineMinutes, 240);
  assert.equal(clamped.warnings.length, 3);
  const bad = loadPolicy({ H0WZY_MCP_MAX_DEPTH: 'abc', H0WZY_MCP_MAX_CALLS: '0', H0WZY_MCP_ALLOW_REVISIT: 'yes' });
  assert.equal(bad.maxDepth, 2);
  assert.equal(bad.maxCalls, 8);
  assert.equal(bad.allowRevisit, true);
});

test('agent names are normalized for the chain', () => {
  assert.equal(agentName('Claude Code'), 'claude-code');
  assert.equal(agentName('codex'), 'codex');
  assert.equal(agentName(''), 'host');
  assert.equal(agentName('9lives'), 'host');
});

test('a top-level call starts a new chain and carries it to the child', () => {
  const dir = freshDir();
  try {
    const res = beginHop({ target: 'codex', host: 'claude', env: envFor(dir), ancestors: noAncestors });
    assert.equal(res.ok, true);
    const { hop } = res;
    assert.deepEqual(hop.agents, ['claude', 'codex']);
    assert.equal(hop.depth, 1);
    assert.equal(hop.slot, 1);
    assert.equal(hop.atMaxDepth, false);
    assert.equal(hop.childEnv.H0WZY_MCP_CHAIN, 'claude>codex');
    assert.equal(hop.childEnv.H0WZY_MCP_DEPTH, '1');
    assert.equal(hop.childEnv.H0WZY_MCP_STATE_DIR, dir);
    assert.match(hop.trace(), /^\[chain claude→codex · depth 1\/2 · calls 1\/8 · run [0-9a-f]{8}\]$/);
    assert.match(hop.notice, /You are codex, called by claude .* Do not call back claude\./);
    const policy = JSON.parse(readFileSync(join(dir, 'runs', hop.runId, 'policy.json'), 'utf8'));
    assert.equal(policy.maxDepth, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('depth: A → B → C runs, C cannot start anyone, and nothing is claimed', () => {
  const dir = freshDir();
  try {
    const first = beginHop({ target: 'codex', host: 'claude', env: envFor(dir), ancestors: noAncestors }).hop;
    const second = beginHop({ target: 'antigravity', env: nestedEnv(first), ancestors: noAncestors });
    assert.equal(second.ok, true);
    assert.equal(second.hop.depth, 2);
    assert.equal(second.hop.atMaxDepth, true);
    assert.match(second.hop.notice, /maximum depth/);

    const started = Date.now();
    const third = beginHop({ target: 'claude-two', env: nestedEnv(second.hop), ancestors: noAncestors });
    assert.equal(third.ok, false);
    assert.equal(third.refusal.rule, 'depth');
    assert.ok(Date.now() - started < 1000, 'refusal must be fast');
    assert.match(third.refusal.text, /^⛔ \[Loop guard: depth limit\] Not started: antigravity is at depth 2 of 2/);
    assert.match(third.refusal.text, /Finish this task yourself/);
    assert.match(third.refusal.text, /\[chain claude→codex→antigravity · depth 2\/2 · calls 2\/8/);
    assert.equal(readdirSync(join(dir, 'runs', first.runId, 'calls')).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cycle: calling back an agent in the chain is refused unless revisits are allowed', () => {
  const dir = freshDir();
  try {
    const first = beginHop({ target: 'codex', host: 'claude', env: envFor(dir), ancestors: noAncestors }).hop;
    const back = beginHop({ target: 'claude', env: nestedEnv(first), ancestors: noAncestors });
    assert.equal(back.ok, false);
    assert.equal(back.refusal.rule, 'cycle');
    assert.match(back.refusal.text, /claude is already in the chain claude → codex/);

    // Revisits must be allowed by the chain's policy *and* the nested bridge.
    const dir2 = freshDir();
    try {
      const allowed = beginHop({ target: 'codex', host: 'claude', env: envFor(dir2, { H0WZY_MCP_ALLOW_REVISIT: '1' }), ancestors: noAncestors }).hop;
      const onlyNested = beginHop({ target: 'claude', env: nestedEnv(first, { H0WZY_MCP_ALLOW_REVISIT: '1' }), ancestors: noAncestors });
      assert.equal(onlyNested.ok, false, 'the chain started without revisits');
      const both = beginHop({ target: 'claude', env: nestedEnv(allowed, { H0WZY_MCP_ALLOW_REVISIT: '1' }), ancestors: noAncestors });
      assert.equal(both.ok, true);
      assert.deepEqual(both.hop.agents, ['claude', 'codex', 'claude']);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a nested host cannot raise the limits the chain started with', () => {
  const dir = freshDir();
  try {
    const first = beginHop({ target: 'codex', host: 'claude', env: envFor(dir), ancestors: noAncestors }).hop;
    const second = beginHop({ target: 'antigravity', env: nestedEnv(first, { H0WZY_MCP_MAX_DEPTH: '4' }), ancestors: noAncestors });
    assert.equal(second.hop.maxDepth, 2);
    const third = beginHop({ target: 'zed', env: nestedEnv(second.hop, { H0WZY_MCP_MAX_DEPTH: '4' }), ancestors: noAncestors });
    assert.equal(third.refusal.rule, 'depth');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('budget: parallel siblings share the slots and only the budget runs', async () => {
  const dir = freshDir();
  try {
    const env = envFor(dir, { H0WZY_MCP_MAX_CALLS: '3' });
    const first = beginHop({ target: 'codex', host: 'claude', env, ancestors: noAncestors }).hop;
    // Five siblings under codex, in separate processes' worth of contention: the slot
    // files are claimed with exclusive create, so the outcome can't depend on timing.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        Promise.resolve().then(() => beginHop({ target: `agent-${i}`, env: nestedEnv(first), ancestors: noAncestors }))
      )
    );
    const ran = results.filter((r) => r.ok);
    const refused = results.filter((r) => !r.ok);
    assert.equal(ran.length, 2, 'slot 1 went to the first hop');
    assert.equal(refused.length, 3);
    assert.ok(refused.every((r) => r.refusal.rule === 'budget'));
    assert.deepEqual(ran.map((r) => r.hop.slot).sort(), [2, 3]);
    assert.match(refused[0].refusal.text, /used its 3 bridge calls/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deadline: a passed deadline is refused and timeouts are capped to the time left', () => {
  const dir = freshDir();
  try {
    const first = beginHop({ target: 'codex', host: 'claude', env: envFor(dir, { H0WZY_MCP_DEADLINE_MINUTES: '1' }), ancestors: noAncestors }).hop;
    assert.ok(first.capTimeoutMs(30 * 60000) <= 60000);
    assert.ok(first.capTimeoutMs(5000) === 5000);
    const late = beginHop({ target: 'antigravity', env: nestedEnv(first), now: first.deadline + 1, ancestors: noAncestors });
    assert.equal(late.ok, false);
    assert.equal(late.refusal.rule, 'deadline');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed chain env fails closed', () => {
  const dir = freshDir();
  try {
    for (const bad of [
      { H0WZY_MCP_RUN_ID: 'zz', H0WZY_MCP_CHAIN: 'claude>codex', H0WZY_MCP_DEPTH: '1', H0WZY_MCP_DEADLINE: '9' },
      { H0WZY_MCP_RUN_ID: 'abcdef12', H0WZY_MCP_CHAIN: 'claude>codex', H0WZY_MCP_DEPTH: '0', H0WZY_MCP_DEADLINE: '9' },
      { H0WZY_MCP_RUN_ID: 'abcdef12', H0WZY_MCP_CHAIN: 'claude;rm -rf', H0WZY_MCP_DEPTH: '1', H0WZY_MCP_DEADLINE: '9' },
      { H0WZY_MCP_DEPTH: '1' },
    ]) {
      assert.deepEqual(readEnvChain(bad), { invalid: true });
      const res = beginHop({ target: 'codex', env: envFor(dir, bad), ancestors: noAncestors });
      assert.equal(res.ok, false);
      assert.equal(res.refusal.rule, 'nesting-unknown');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a bridge whose host dropped the env finds its chain through the agent registry', () => {
  const dir = freshDir();
  try {
    const first = beginHop({ target: 'codex', host: 'claude', env: envFor(dir), ancestors: noAncestors }).hop;
    const fakeAgentPid = 424242;
    first.registerAgent(fakeAgentPid);
    const alive = (pid) => pid === fakeAgentPid;

    // Same machine, codex's bridge without H0WZY_MCP_* vars: its parent is the agent.
    const nested = beginHop({ target: 'antigravity', host: 'codex', env: envFor(dir), ancestors: () => [999, fakeAgentPid, 1], alive });
    assert.equal(nested.ok, true);
    assert.deepEqual(nested.hop.agents, ['claude', 'codex', 'antigravity']);
    assert.equal(nested.hop.runId, first.runId);

    // A fresh session in another terminal is not under that agent: new chain.
    const fresh = beginHop({ target: 'antigravity', host: 'codex', env: envFor(dir), ancestors: () => [555, 1], alive });
    assert.equal(fresh.ok, true);
    assert.notEqual(fresh.hop.runId, first.runId);
    assert.deepEqual(fresh.hop.agents, ['codex', 'antigravity']);

    // Ancestry unreadable while agents are registered: fail closed.
    const blind = beginHop({ target: 'antigravity', host: 'codex', env: envFor(dir), ancestors: () => null, alive });
    assert.equal(blind.ok, false);
    assert.equal(blind.refusal.rule, 'nesting-unknown');

    first.finish('ran');
    assert.equal(existsSync(join(dir, 'agents', `${fakeAgentPid}.json`)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stale agent records are swept and do not affect new chains', () => {
  const dir = freshDir();
  try {
    mkdirSync(join(dir, 'agents'), { recursive: true });
    writeFileSync(
      join(dir, 'agents', '31337.json'),
      JSON.stringify({ pid: 31337, runId: 'abcdef12', agents: ['claude', 'codex'], depth: 1, deadline: Date.now() + 60000 })
    );
    writeFileSync(join(dir, 'agents', 'garbage.json'), '{not json');
    const res = beginHop({ target: 'codex', host: 'claude', env: envFor(dir), ancestors: () => null, alive: () => false });
    assert.equal(res.ok, true, 'dead records must not force fail-closed');
    assert.deepEqual(readdirSync(join(dir, 'agents')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the chain log records hops and refusals without prompt text', () => {
  const dir = freshDir();
  try {
    const env = envFor(dir, { H0WZY_MCP_CHAIN_LOG: '1' });
    const first = beginHop({ target: 'codex', host: 'claude', tool: 'ask_codex', env, ancestors: noAncestors }).hop;
    first.finish('ran');
    const back = beginHop({ target: 'claude', tool: 'ask_claude', env: { ...nestedEnv(first), H0WZY_MCP_CHAIN_LOG: '1' }, ancestors: noAncestors });
    logRefusal({ env, refusal: back.refusal, target: 'claude', tool: 'ask_claude' });
    const lines = readFileSync(join(dir, 'chain.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.deepEqual(Object.keys(lines[0]).sort(), ['agent', 'caller', 'depth', 'ms', 'outcome', 'run', 'tool', 'ts']);
    assert.equal(lines[0].outcome, 'ran');
    assert.equal(lines[1].outcome, 'refused:cycle');
    assert.equal(lines[1].run, first.runId);
    assert.equal(lines[1].caller, 'codex');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatTrace tolerates unknown values', () => {
  assert.equal(formatTrace({}), '[chain ? · depth ?/? · calls ?/? · run ?]');
});

test('a call that never started an agent gives its budget slot back', () => {
  const dir = freshDir();
  try {
    const env = envFor(dir, { H0WZY_MCP_MAX_CALLS: '2' });
    const first = beginHop({ target: 'codex', host: 'claude', env, ancestors: noAncestors }).hop;
    first.registerAgent(1234);
    first.finish('ran');
    // Two nested calls that fail before spawning (bad cwd, missing binary, …).
    for (let i = 0; i < 2; i++) {
      const failed = beginHop({ target: 'antigravity', env: nestedEnv(first), ancestors: noAncestors });
      assert.equal(failed.ok, true);
      failed.hop.finish('failed');
    }
    const real = beginHop({ target: 'antigravity', env: nestedEnv(first), ancestors: noAncestors });
    assert.equal(real.ok, true, 'the failed attempts must not have used the budget');
    assert.equal(real.hop.slot, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a root chain (team) shares its deadline and nested budget across all its hops', () => {
  const dir = freshDir();
  try {
    const env = envFor(dir, { H0WZY_MCP_MAX_CALLS: '2' });
    const deadline = Date.now() + 5 * 60000;
    const root = createRootChain({ env, agents: ['team'], deadline });
    // Team turns: hops of the root chain that don't spend its call budget.
    const turns = [1, 2, 3].map(() => beginHop({ target: 'codex', env, chain: root, claim: false }));
    assert.ok(turns.every((t) => t.ok));
    assert.equal(turns[0].hop.childEnv.H0WZY_MCP_RUN_ID, root.runId);
    assert.equal(turns[0].hop.childEnv.H0WZY_MCP_CHAIN, 'team>codex');
    assert.equal(turns[0].hop.deadline, deadline);
    // Bridges called by teammates share one budget for the whole team.
    const a = beginHop({ target: 'claude', env: nestedEnv(turns[0].hop), ancestors: noAncestors });
    const b = beginHop({ target: 'claude', env: nestedEnv(turns[1].hop), ancestors: noAncestors });
    const c = beginHop({ target: 'claude', env: nestedEnv(turns[2].hop), ancestors: noAncestors });
    assert.equal(a.ok && b.ok, true);
    assert.equal(c.ok, false);
    assert.equal(c.refusal.rule, 'budget');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
