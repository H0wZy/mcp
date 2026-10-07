// H0wZy/mcp — Loop guard (spec 006). Decides, before any agent is started, whether a
// bridge call may run, and carries the chain context to the agent it starts.
// Contract: specs/006-bidirectional-agent-mesh/contracts/chain-context.md

import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { currentAncestors } from './ancestry.js';

export const POLICY_DEFAULTS = Object.freeze({ maxDepth: 2, maxCalls: 8, allowRevisit: false, deadlineMinutes: 60 });
export const POLICY_CAPS = Object.freeze({ maxDepth: 4, maxCalls: 32, deadlineMinutes: 240 });

export const CHAIN_ENV = Object.freeze({
  runId: 'H0WZY_MCP_RUN_ID',
  chain: 'H0WZY_MCP_CHAIN',
  depth: 'H0WZY_MCP_DEPTH',
  deadline: 'H0WZY_MCP_DEADLINE',
  stateDir: 'H0WZY_MCP_STATE_DIR',
});

const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const CHAIN = /^[a-z][a-z0-9-]{0,31}(>[a-z][a-z0-9-]{0,31}){0,15}$/;
const RUN_ID = /^[0-9a-f]{8,32}$/;
const STALE_GRACE_MS = 10 * 60 * 1000;
const RUN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Normalizes an agent name for the chain ("Claude Code" → "claude-code"); anything
 * unusable becomes "host".
 * @param {unknown} name
 * @returns {string}
 */
export function agentName(name) {
  const value = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return NAME.test(value) ? value : 'host';
}

function boundedInt(raw, fallback, cap, label, warnings) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 1) {
    warnings.push(`${label}='${raw}' is not a positive number; using ${fallback}`);
    return fallback;
  }
  const value = Math.floor(n);
  if (value > cap) {
    warnings.push(`${label}=${value} is above the hard cap; clamped to ${cap}`);
    return cap;
  }
  return value;
}

/**
 * Reads the developer's loop-guard limits from the environment, clamped to the hard caps.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{ maxDepth: number, maxCalls: number, allowRevisit: boolean, deadlineMinutes: number, logEnabled: boolean, warnings: string[] }}
 */
export function loadPolicy(env = process.env) {
  const warnings = [];
  const flag = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
  return {
    maxDepth: boundedInt(env.H0WZY_MCP_MAX_DEPTH, POLICY_DEFAULTS.maxDepth, POLICY_CAPS.maxDepth, 'H0WZY_MCP_MAX_DEPTH', warnings),
    maxCalls: boundedInt(env.H0WZY_MCP_MAX_CALLS, POLICY_DEFAULTS.maxCalls, POLICY_CAPS.maxCalls, 'H0WZY_MCP_MAX_CALLS', warnings),
    allowRevisit: flag(env.H0WZY_MCP_ALLOW_REVISIT),
    deadlineMinutes: boundedInt(
      env.H0WZY_MCP_DEADLINE_MINUTES,
      POLICY_DEFAULTS.deadlineMinutes,
      POLICY_CAPS.deadlineMinutes,
      'H0WZY_MCP_DEADLINE_MINUTES',
      warnings
    ),
    logEnabled: flag(env.H0WZY_MCP_CHAIN_LOG),
    warnings,
  };
}

/**
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {string} Absolute directory holding run state, the agent registry and the log
 */
export function stateDir(env = process.env) {
  const custom = String(env[CHAIN_ENV.stateDir] ?? '').trim();
  return custom || join(homedir(), '.h0wzy-mcp');
}

/**
 * Parses the chain context a parent bridge passed through the environment.
 * @returns {null | { invalid: true } | { runId: string, agents: string[], depth: number, deadline: number }}
 */
export function readEnvChain(env = process.env) {
  const raw = {
    runId: env[CHAIN_ENV.runId],
    chain: env[CHAIN_ENV.chain],
    depth: env[CHAIN_ENV.depth],
    deadline: env[CHAIN_ENV.deadline],
  };
  if (Object.values(raw).every((v) => v === undefined || v === '')) return null;
  const agents = String(raw.chain ?? '').split('>');
  const depth = Number(raw.depth);
  const deadline = Number(raw.deadline);
  if (
    !RUN_ID.test(String(raw.runId ?? '')) ||
    !CHAIN.test(String(raw.chain ?? '')) ||
    !Number.isInteger(depth) ||
    depth !== agents.length - 1 ||
    !Number.isFinite(deadline)
  ) {
    return { invalid: true };
  }
  return { runId: raw.runId, agents, depth, deadline };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Live records of agents started by bridges on this machine. Stale ones (process gone,
 * or long past their chain's deadline) are deleted.
 */
function liveAgentRecords(dir, now, alive = isAlive) {
  const agentsDir = join(dir, 'agents');
  let names;
  try {
    names = readdirSync(agentsDir);
  } catch {
    return [];
  }
  const live = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = join(agentsDir, name);
    const rec = readJson(file);
    const valid =
      rec &&
      Number.isInteger(rec.pid) &&
      Array.isArray(rec.agents) &&
      rec.agents.every((a) => NAME.test(a)) &&
      Number.isInteger(rec.depth) &&
      Number.isFinite(rec.deadline) &&
      RUN_ID.test(String(rec.runId ?? ''));
    if (!valid || !alive(rec.pid) || now > rec.deadline + STALE_GRACE_MS) {
      rmSync(file, { force: true });
      continue;
    }
    live.push(rec);
  }
  return live;
}

function sweepOldRuns(dir, now) {
  const runsDir = join(dir, 'runs');
  let names;
  try {
    names = readdirSync(runsDir);
  } catch {
    return;
  }
  for (const name of names) {
    try {
      if (now - statSync(join(runsDir, name)).mtimeMs > RUN_TTL_MS) {
        rmSync(join(runsDir, name), { recursive: true, force: true });
      }
    } catch {
      /* raced with another sweeper */
    }
  }
}

/**
 * Works out which chain this bridge call belongs to.
 *
 * @returns {{ kind: 'inherited' | 'registry' | 'new' | 'unknown', chain?: object, reason?: string }}
 */
export function resolveChain({ env = process.env, host = 'host', now = Date.now(), dir = stateDir(env), policy, ancestors = currentAncestors, alive } = {}) {
  const fromEnv = readEnvChain(env);
  if (fromEnv?.invalid) return { kind: 'unknown', reason: 'the chain context in the environment is malformed' };
  if (fromEnv) return { kind: 'inherited', chain: fromEnv };

  const records = liveAgentRecords(dir, now, alive);
  if (records.length > 0) {
    const lineage = typeof ancestors === 'function' ? ancestors() : ancestors;
    if (!Array.isArray(lineage)) {
      return { kind: 'unknown', reason: 'bridge-started agents are running and this process ancestry cannot be read' };
    }
    // Nearest ancestor wins: a chain nested inside another chain belongs to the inner one.
    for (const pid of lineage) {
      const rec = records.find((r) => r.pid === pid);
      if (rec) {
        return { kind: 'registry', chain: { runId: rec.runId, agents: rec.agents, depth: rec.depth, deadline: rec.deadline } };
      }
    }
  }

  const deadlineMinutes = policy?.deadlineMinutes ?? POLICY_DEFAULTS.deadlineMinutes;
  return {
    kind: 'new',
    chain: {
      runId: randomBytes(4).toString('hex'),
      agents: [agentName(host)],
      depth: 0,
      deadline: now + deadlineMinutes * 60000,
    },
  };
}

function runDir(dir, runId) {
  return join(dir, 'runs', runId);
}

function chainPolicy(dir, chain, own, isNew) {
  const file = join(runDir(dir, chain.runId), 'policy.json');
  if (isNew) return { ...own };
  const stored = readJson(file);
  if (!stored) return { ...own };
  // The chain's limits were fixed when it started; a nested host can only tighten them.
  return {
    ...own,
    maxDepth: Math.min(own.maxDepth, Number(stored.maxDepth) || own.maxDepth),
    maxCalls: Math.min(own.maxCalls, Number(stored.maxCalls) || own.maxCalls),
    allowRevisit: own.allowRevisit && stored.allowRevisit === true,
  };
}

function usedSlots(dir, runId) {
  try {
    return readdirSync(join(runDir(dir, runId), 'calls')).length;
  } catch {
    return 0;
  }
}

function claimSlot(dir, chain, policy, isNew) {
  const base = runDir(dir, chain.runId);
  const callsDir = join(base, 'calls');
  mkdirSync(callsDir, { recursive: true, mode: 0o700 });
  if (isNew) {
    writeFileSync(
      join(base, 'policy.json'),
      JSON.stringify({ maxDepth: policy.maxDepth, maxCalls: policy.maxCalls, allowRevisit: policy.allowRevisit, deadline: chain.deadline }),
      { mode: 0o600 }
    );
  }
  for (let n = 1; n <= policy.maxCalls; n++) {
    try {
      closeSync(openSync(join(callsDir, String(n)), 'wx', 0o600));
      return n;
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
    }
  }
  return 0;
}

/**
 * Formats the trace line every bridge reply ends with.
 */
export function formatTrace({ agents, depth, maxDepth, calls, maxCalls, runId }) {
  const path = agents && agents.length ? agents.join('→') : '?';
  return `[chain ${path} · depth ${depth ?? '?'}/${maxDepth ?? '?'} · calls ${calls ?? '?'}/${maxCalls ?? '?'} · run ${runId ?? '?'}]`;
}

const RULE_TITLES = {
  depth: 'depth limit',
  cycle: 'cycle',
  budget: 'call budget',
  deadline: 'deadline',
  'nesting-unknown': 'unknown nesting',
};

function refusal(rule, reason, traceInfo, policyWarnings = []) {
  const trace = formatTrace(traceInfo);
  const warnings = policyWarnings.length ? `\n⚠️ ${policyWarnings.join('\n⚠️ ')}` : '';
  return {
    ok: false,
    refusal: {
      rule,
      trace,
      runId: traceInfo.runId ?? null,
      caller: traceInfo.agents?.[traceInfo.agents.length - 1] ?? null,
      depth: Number.isInteger(traceInfo.depth) ? traceInfo.depth + 1 : null,
      text:
        `⛔ [Loop guard: ${RULE_TITLES[rule]}] Not started: ${reason}.\n` +
        `💡 Finish this task yourself without delegating to another agent.\n\n${trace}${warnings}`,
    },
  };
}

function chainNotice({ agents, target, depth, maxDepth, slot, maxCalls, atMaxDepth }) {
  const caller = agents[agents.length - 1];
  const path = [...agents, target].join(' → ');
  const before = agents.join(', ');
  const tail = atMaxDepth
    ? 'You are at the maximum depth: bridge tools are disabled or will be refused.'
    : 'Other bridge calls are limited and may be refused.';
  return (
    `[H0wZy/mcp chain] You are ${target}, called by ${caller} (chain ${path}, depth ${depth} of ${maxDepth}, ` +
    `bridge call ${slot} of ${maxCalls}). Do this task yourself. Do not call back ${before}. ${tail}`
  );
}

/**
 * Decides whether a bridge may start `target`, and returns the hop that carries the
 * chain context into it. Nothing is spawned here.
 *
 * @param {Object} options
 * @param {string} options.target Agent this bridge starts (e.g. "codex")
 * @param {string} [options.tool] Tool name, for the log
 * @param {string} [options.host] Agent hosting this bridge when there is no inherited chain
 * @param {NodeJS.ProcessEnv} [options.env=process.env]
 * @param {number} [options.now=Date.now()]
 * @param {(() => number[] | null) | number[] | null} [options.ancestors] Process ancestors (injectable for tests)
 * @param {(pid: number) => boolean} [options.alive] Liveness check (injectable for tests)
 * @returns {{ ok: true, hop: object } | { ok: false, refusal: { rule: string, text: string, trace: string } }}
 */
export function beginHop({ target, tool = '', host = 'host', env = process.env, now = Date.now(), ancestors, alive } = {}) {
  const own = loadPolicy(env);
  const dir = stateDir(env);
  const targetName = agentName(target);
  const resolved = resolveChain({ env, host, now, dir, policy: own, ancestors, alive });

  if (resolved.kind === 'unknown') {
    return refusal(
      'nesting-unknown',
      `this bridge looks nested inside another agent call, but ${resolved.reason}`,
      { agents: [agentName(host)], maxDepth: own.maxDepth, maxCalls: own.maxCalls },
      own.warnings
    );
  }

  const isNew = resolved.kind === 'new';
  const chain = resolved.chain;
  const policy = chainPolicy(dir, chain, own, isNew);
  const traceBase = {
    agents: chain.agents,
    depth: chain.depth,
    maxDepth: policy.maxDepth,
    maxCalls: policy.maxCalls,
    runId: chain.runId,
  };
  const caller = chain.agents[chain.agents.length - 1];

  if (now >= chain.deadline) {
    return refusal(
      'deadline',
      `the chain's deadline passed ${Math.round((now - chain.deadline) / 1000)} s ago`,
      { ...traceBase, calls: usedSlots(dir, chain.runId) },
      policy.warnings
    );
  }
  if (chain.agents.includes(targetName) && !policy.allowRevisit) {
    return refusal(
      'cycle',
      `${targetName} is already in the chain ${chain.agents.join(' → ')} (set H0WZY_MCP_ALLOW_REVISIT=1 to allow)`,
      { ...traceBase, calls: usedSlots(dir, chain.runId) },
      policy.warnings
    );
  }
  const targetDepth = chain.depth + 1;
  if (targetDepth > policy.maxDepth) {
    return refusal(
      'depth',
      `${caller} is at depth ${chain.depth} of ${policy.maxDepth}, the maximum, so it can't start ${targetName}`,
      { ...traceBase, calls: usedSlots(dir, chain.runId) },
      policy.warnings
    );
  }

  if (isNew) sweepOldRuns(dir, now);
  const slot = claimSlot(dir, chain, policy, isNew);
  if (!slot) {
    return refusal(
      'budget',
      `the chain already used its ${policy.maxCalls} bridge calls`,
      { ...traceBase, calls: policy.maxCalls },
      policy.warnings
    );
  }

  const agents = [...chain.agents, targetName];
  const atMaxDepth = targetDepth >= policy.maxDepth;
  const registered = new Set();
  const started = Date.now();

  const hop = {
    runId: chain.runId,
    caller,
    target: targetName,
    agents,
    depth: targetDepth,
    maxDepth: policy.maxDepth,
    slot,
    maxCalls: policy.maxCalls,
    deadline: chain.deadline,
    atMaxDepth,
    warnings: policy.warnings,
    childEnv: {
      [CHAIN_ENV.runId]: chain.runId,
      [CHAIN_ENV.chain]: agents.join('>'),
      [CHAIN_ENV.depth]: String(targetDepth),
      [CHAIN_ENV.deadline]: String(chain.deadline),
      [CHAIN_ENV.stateDir]: dir,
    },
    notice: chainNotice({
      agents: chain.agents,
      target: targetName,
      depth: targetDepth,
      maxDepth: policy.maxDepth,
      slot,
      maxCalls: policy.maxCalls,
      atMaxDepth,
    }),
    /** Milliseconds left before the chain's deadline. */
    remainingMs: () => Math.max(0, chain.deadline - Date.now()),
    /** A child never gets more time than its chain has left (FR-008). */
    capTimeoutMs(ms) {
      const left = Math.max(1000, chain.deadline - Date.now());
      return Number.isFinite(ms) && ms > 0 ? Math.min(ms, left) : left;
    },
    trace: () => formatTrace({ agents, depth: targetDepth, maxDepth: policy.maxDepth, calls: slot, maxCalls: policy.maxCalls, runId: chain.runId }),
    /** Records a started agent so nested bridges that lost the env can still find the chain. */
    registerAgent(pid) {
      if (!Number.isInteger(pid)) return;
      try {
        mkdirSync(join(dir, 'agents'), { recursive: true, mode: 0o700 });
        writeFileSync(
          join(dir, 'agents', `${pid}.json`),
          JSON.stringify({ pid, runId: chain.runId, agents, depth: targetDepth, deadline: chain.deadline, startedAt: Date.now() }),
          { mode: 0o600 }
        );
        registered.add(pid);
      } catch {
        /* the env context still works; the fallback is best effort */
      }
    },
    finish(outcome = 'ran') {
      for (const pid of registered) rmSync(join(dir, 'agents', `${pid}.json`), { force: true });
      registered.clear();
      if (!own.logEnabled) return;
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        appendFileSync(
          join(dir, 'chain.log'),
          JSON.stringify({
            ts: new Date().toISOString(),
            run: chain.runId,
            caller,
            agent: targetName,
            depth: targetDepth,
            tool,
            outcome,
            ms: Date.now() - started,
          }) + '\n',
          { mode: 0o600 }
        );
      } catch {
        /* logging never fails a call */
      }
    },
  };
  return { ok: true, hop };
}

/**
 * Appends a refused call to the chain log (refusals never get a hop to finish).
 */
export function logRefusal({ env = process.env, refusal: r, target, tool }) {
  if (!loadPolicy(env).logEnabled) return;
  const dir = stateDir(env);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(
      join(dir, 'chain.log'),
      JSON.stringify({
        ts: new Date().toISOString(),
        run: r.runId,
        caller: r.caller,
        agent: agentName(target),
        depth: r.depth,
        tool,
        outcome: `refused:${r.rule}`,
        ms: 0,
      }) + '\n',
      { mode: 0o600 }
    );
  } catch {
    /* logging never fails a call */
  }
}
