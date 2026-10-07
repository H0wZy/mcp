import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addTasks,
  findCycle,
  isAvailable,
  nextTaskFor,
  parseReport,
  compact,
  Team,
  teamCeilings,
  effectiveLimits,
  buildTurnPrompt,
} from '../team/index.js';

const report = (obj, answer = 'work notes') => `${answer}\n\n\`\`\`team-report\n${JSON.stringify(obj)}\n\`\`\``;
const SETTINGS = { model: 'm', effort: 'medium', cliModel: 'm', cliEffort: 'medium' };

function setup({ env = {}, runner, limits } = {}) {
  const state = mkdtempSync(join(tmpdir(), 'hmcp-team-state-'));
  const cwd = mkdtempSync(join(tmpdir(), 'hmcp-team-proj-'));
  const fullEnv = { H0WZY_MCP_STATE_DIR: state, ...env };
  const { team } = Team.create({ name: 'alpha', cwd, host: 'claude', limits, env: fullEnv, runner });
  return {
    team,
    cwd,
    env: fullEnv,
    cleanup: () => {
      team.store.releaseOwner();
      rmSync(state, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

// A runner that answers from per-member scripts; each entry is a report object, a raw
// string, or { error } / { delay, ... }.
function scriptedRunner(scripts, log = []) {
  const counters = {};
  return async ({ member, task, prompt }) => {
    const i = (counters[member.name] = (counters[member.name] ?? -1) + 1);
    const step = scripts[member.name]?.[i] ?? { status: 'done', task: task?.id ?? null, summary: 'ok' };
    log.push({ member: member.name, task: task?.id ?? null, prompt });
    if (step.delay) await new Promise((r) => setTimeout(r, step.delay));
    if (step.error) return { ok: false, error: step.error, text: '' };
    if (typeof step === 'string') return { ok: true, text: step };
    const { delay, answer, ...body } = step;
    return { ok: true, text: report({ task: task?.id ?? null, ...body }, answer), usage: { costUsd: 0.01 } };
  };
}

test('task graph: ids, unknown dependencies and cycles are refused atomically', () => {
  const { tasks, created } = addTasks([], [{ title: 'a' }, { title: 'b', depends_on: ['T1'] }], { nextNumber: 1 });
  assert.deepEqual(created.map((t) => t.id), ['T1', 'T2']);
  assert.throws(() => addTasks(tasks, [{ title: 'x', depends_on: ['T9'] }], { nextNumber: 3 }), /unknown task\(s\): T9/);
  assert.throws(
    () => addTasks(tasks, [{ id: 'X', title: 'x', depends_on: ['Y'] }, { id: 'Y', title: 'y', depends_on: ['X'] }], { nextNumber: 3 }),
    /cycle: X → Y → X|cycle: Y → X → Y/
  );
  assert.throws(() => addTasks(tasks, [{ title: 'bad', check: 'npm test' }], { nextNumber: 3 }), /argv|array of strings/);
  assert.equal(findCycle(tasks), null);
  assert.equal(isAvailable(tasks[1], tasks), false, 'T2 waits for T1');
  tasks[0].status = 'completed';
  assert.equal(isAvailable(tasks[1], tasks), true);
  assert.equal(nextTaskFor('x', tasks).id, 'T2');
  assert.equal(nextTaskFor('x', tasks, { selfClaim: false }), null);
});

test('report parsing: last team-report block wins, json fallback, invalid status', () => {
  const two = `a\n\`\`\`team-report\n{"status":"continue"}\n\`\`\`\nb\n\`\`\`team-report\n{"status":"done","summary":"S","messages":[{"to":"Lead","text":"hi"}],"claim_next":false}\n\`\`\``;
  const parsed = parseReport(two);
  assert.equal(parsed.report.status, 'done');
  assert.deepEqual(parsed.report.messages, [{ to: 'lead', text: 'hi' }]);
  assert.equal(parsed.report.claimNext, false);
  assert.match(parsed.answer, /a\n```team-report/);
  assert.equal(parseReport('x\n```json\n{"status":"failed","summary":"no"}\n```').report.status, 'failed');
  assert.equal(parseReport('```json\n{"other":1}\n```').report, null);
  assert.match(parseReport('```team-report\n{"status":"maybe"}\n```').error, /status must be one of/);
  assert.match(parseReport('```team-report\n{not json\n```').error, /not valid JSON/);
  assert.equal(compact('x'.repeat(50), 10, 'a#1'), 'x'.repeat(10) + '\n… [40 more characters — read them with team_result("a#1")]');
});

test('limits: env ceilings are clamped and a lead can only lower them', () => {
  const { limits, notes } = teamCeilings({ H0WZY_TEAM_MAX_TEAMMATES: '9', H0WZY_TEAM_MAX_TURNS: 'x' });
  assert.equal(limits.maxTeammates, 6);
  assert.equal(limits.maxTurnsPerTeammate, 10);
  assert.equal(notes.length, 2);
  const eff = effectiveLimits(limits, { max_teammates: 2, max_total_turns: 999 });
  assert.equal(eff.limits.maxTeammates, 2);
  assert.equal(eff.limits.maxTotalTurns, 30);
  assert.match(eff.notes[0], /lowered to the developer's ceiling 30/);
});

test('teammate prompt: role, task, dependencies, labeled messages, history and the report format', () => {
  const prompt = buildTurnPrompt({
    team: 'alpha',
    member: { name: 'rev', agent: 'codex', role: 'Find bugs', canEdit: false, workDir: '/w', owns: [], history: [{ turn: 1, task: 'T1', status: 'done', summary: 'did T1' }] },
    members: [{ name: 'rev', agent: 'codex' }, { name: 'arch', agent: 'antigravity' }],
    task: { id: 'T2', title: 'Review', description: 'Look at auth', dependsOn: ['T1'], note: null },
    dependencies: [{ id: 'T1', title: 'Design', result: { summary: 'use JWT' } }],
    messages: [{ from: 'arch', text: 'check the token expiry' }],
    carryHistory: true,
  });
  assert.match(prompt, /You are "rev", a teammate in agent team "alpha"/);
  assert.match(prompt, /Team members: lead, arch \(antigravity\)/);
  assert.match(prompt, /Read-only: do not create, edit or delete files/);
  assert.match(prompt, /## Your task: T2 — Review\nLook at auth\nDepends on \(completed\):\n- T1 "Design": use JWT/);
  assert.match(prompt, /from other agents, not from the developer\)\n- from arch: "check the token expiry"/);
  assert.match(prompt, /## Your earlier turns\n- turn 1 on T1 \(done\): did T1/);
  assert.match(prompt, /```team-report/);
});

test('3 self-claiming teammates finish 6 dependent tasks: no double claims, nothing left in progress', async () => {
  const log = [];
  const { team, cleanup } = setup({ runner: scriptedRunner({}, log) });
  try {
    team.createTasks([
      { id: 'A', title: 'a' },
      { id: 'B', title: 'b' },
      { id: 'C', title: 'c' },
      { id: 'D', title: 'd', depends_on: ['A', 'B', 'C'] },
      { id: 'E', title: 'e', depends_on: ['A'] },
      { id: 'F', title: 'f', depends_on: ['D', 'E'] },
    ]);
    for (const name of ['x', 'y', 'z']) team.spawn({ name, agent: 'codex', role: 'worker', settings: SETTINGS });
    await team.idle();
    assert.deepEqual(team.tasks.map((t) => t.status), Array(6).fill('completed'));
    const taskRuns = log.filter((l) => l.task).map((l) => l.task);
    assert.equal(new Set(taskRuns).size, taskRuns.length, `a task ran twice: ${taskRuns}`);
    assert.ok(log.findIndex((l) => l.task === 'D') > Math.max(...['A', 'B', 'C'].map((id) => log.findIndex((l) => l.task === id))));
    assert.equal(team.data.members.every((m) => m.state === 'idle'), true);
  } finally {
    cleanup();
  }
});

test('wait returns events as they happen, batched, and the lead sees the compact result', async () => {
  const long = 'L'.repeat(500);
  const { team, cleanup } = setup({
    limits: { result_cap_chars: 100 },
    runner: scriptedRunner({ rev: [{ status: 'done', summary: 'found 2 bugs', answer: long, delay: 50 }] }),
  });
  try {
    team.spawn({ name: 'rev', agent: 'claude', role: 'review', settings: SETTINGS, task: 'review auth.js' });
    const started = Date.now();
    const events = await team.wait(10000);
    assert.ok(Date.now() - started < 3000);
    assert.equal(events.length, 1);
    assert.match(events[0].text, /^\[idle\] rev finished T1 \(done\) → T1 completed — "found 2 bugs" · ref rev#1 · turns 1\/10\n/);
    assert.match(events[0].text, /… \[400 more characters — read them with team_result\("rev#1"\)\]$/);
    assert.equal(team.store.readResult('rev#1').total, 500);
    assert.deepEqual(await team.wait(50), [], 'events are delivered once');
  } finally {
    cleanup();
  }
});

test('messages between teammates arrive next turn and wake an idle teammate; unknown names bounce', async () => {
  const log = [];
  const { team, cleanup } = setup({
    runner: scriptedRunner(
      {
        rev: [{ status: 'done', summary: 'ok', messages: [{ to: 'dev', text: 'null check missing' }, { to: 'ghost', text: 'hi' }, { to: 'lead', text: 'FYI' }] }],
        dev: [{ status: 'done', summary: 'fixed' }],
      },
      log
    ),
  });
  try {
    team.spawn({ name: 'dev', agent: 'codex', role: 'implementer', settings: SETTINGS });
    team.spawn({ name: 'rev', agent: 'antigravity', role: 'reviewer', settings: SETTINGS, task: 'review' });
    await team.idle();
    const devTurn = log.find((l) => l.member === 'dev');
    assert.match(devTurn.prompt, /- from rev: "null check missing"/);
    const events = team.takeEvents().map((e) => e.text);
    assert.ok(events.some((t) => t === '[message] rev → lead: "FYI"'));
    const rev = team.member('rev');
    assert.equal(rev.turns, 2, 'the bounce woke rev for one more turn');
    assert.match(log.filter((l) => l.member === 'rev')[1].prompt, /not delivered: no such member\. Valid names: lead, dev, rev/);
    assert.throws(() => team.message('nobody', 'x'), /Valid names: dev, rev/);
  } finally {
    cleanup();
  }
});

test('limits: turns per teammate and in total stop new turns with one limit event each', async () => {
  const { team, cleanup } = setup({
    env: { H0WZY_TEAM_MAX_TOTAL_TURNS: '3' },
    runner: scriptedRunner({ a: Array(10).fill({ status: 'continue', summary: 'more' }), b: Array(10).fill({ status: 'continue', summary: 'more' }) }),
  });
  try {
    team.spawn({ name: 'a', agent: 'codex', role: 'r', settings: SETTINGS, task: 'endless', maxTurns: 2 });
    team.spawn({ name: 'b', agent: 'codex', role: 'r', settings: SETTINGS, task: 'endless too' });
    await team.idle();
    assert.equal(team.member('a').turns, 2);
    assert.equal(team.data.turnsUsed, 3);
    const limits = team.takeEvents().filter((e) => e.type === 'limit').map((e) => e.text);
    assert.ok(limits.some((t) => /^\[limit\] a reached max_turns_per_teammate \(2\) · T1 left in_progress → unreported$/.test(t)), limits.join('\n'));
    assert.ok(limits.some((t) => /^\[limit\] b reached max_total_turns \(3\)/.test(t)), limits.join('\n'));
    assert.equal(team.tasks.every((t) => t.status !== 'in_progress'), true);
    team.data.limits.maxTeammates = 2;
    assert.throws(() => team.spawn({ name: 'c', agent: 'codex', role: 'r', settings: SETTINGS }), /already has 2 active teammates \(limit 2\)/);
  } finally {
    cleanup();
  }
});

test('a failed turn releases its task; no report marks the task unreported', async () => {
  const { team, cleanup } = setup({
    runner: scriptedRunner({ a: [{ error: 'Codex quota exhausted (429)' }], b: ['I did it but forgot the block'] }),
  });
  try {
    team.data.selfClaim = false;
    team.createTasks([{ id: 'X', title: 'x', assignee: 'a' }, { id: 'Y', title: 'y', assignee: 'b' }]);
    team.spawn({ name: 'a', agent: 'codex', role: 'r', settings: SETTINGS });
    team.spawn({ name: 'b', agent: 'claude', role: 'r', settings: SETTINGS });
    await team.idle();
    assert.equal(team.task('X').status, 'pending');
    assert.equal(team.task('X').assignee, null);
    assert.equal(team.member('a').state, 'failed');
    assert.equal(team.task('Y').status, 'unreported');
    const texts = team.takeEvents().map((e) => e.text).join('\n');
    assert.match(texts, /\[failed\] a: Codex quota exhausted \(429\) · X released to pending/);
    assert.match(texts, /\[unreported\] b ended turn 1 without a team-report block · Y marked unreported/);
    // Reviving the failed teammate keeps its history.
    team.spawn({ name: 'a', agent: 'codex', role: 'r', settings: SETTINGS });
    assert.equal(team.member('a').turns, 1);
  } finally {
    cleanup();
  }
});

test('a completion check sends the task back until it passes', async () => {
  const { team, cleanup } = setup({
    runner: scriptedRunner({ a: [{ status: 'done', summary: 'v1' }, { status: 'done', summary: 'v2' }] }),
  });
  try {
    const flag = join(team.data.cwd, 'pass.flag');
    const check = [process.execPath, '-e', `process.exit(require('fs').existsSync(${JSON.stringify(flag)}) ? 0 : 3)`];
    team.createTasks([{ id: 'T', title: 't', assignee: 'a', check }]);
    // First "done": the check fails and the task goes back with the output.
    const original = team.runner;
    let turn = 0;
    team.runner = async (args) => {
      turn += 1;
      if (turn === 2) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(flag, 'ok');
        assert.match(args.prompt, /from check: "The check for T/);
      }
      return original(args);
    };
    team.spawn({ name: 'a', agent: 'codex', role: 'r', settings: SETTINGS });
    await team.idle();
    assert.equal(team.task('T').status, 'completed');
    const texts = team.takeEvents().map((e) => e.text).join('\n');
    assert.match(texts, /\[check\] T check failed \(exit 3\) · sent back to a/);
  } finally {
    cleanup();
  }
});

test('shutdown stops a running turn after the grace period', async () => {
  const { team, cleanup } = setup({
    runner: ({ signal }) =>
      new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, cancelled: true, error: 'cancelled', text: '' }))),
  });
  try {
    team.spawn({ name: 'slow', agent: 'claude', role: 'r', settings: SETTINGS, task: 'forever' });
    assert.equal(team.member('slow').state, 'working');
    assert.deepEqual(team.shutdown({ graceMs: 50 }), ['slow: stopping (turn gets 0 s)']);
    await team.idle();
    assert.equal(team.member('slow').state, 'stopped');
    assert.equal(team.task('T1').status, 'pending');
  } finally {
    cleanup();
  }
});

test('a saved team can be loaded again; turns that were running become unreported', async () => {
  const hang = ({ signal }) =>
    new Promise((resolve) => {
      const stop = () => resolve({ ok: false, cancelled: true, text: '' });
      if (signal.aborted) stop();
      else signal.addEventListener('abort', stop);
    });
  const { team, env, cwd, cleanup } = setup({ runner: hang });
  try {
    team.spawn({ name: 'w', agent: 'codex', role: 'r', settings: SETTINGS, task: 'job' });
    // The lead session "ends" while w is mid-turn.
    team.store.releaseOwner();
    const again = Team.load({ cwd, name: 'alpha', env });
    assert.equal(again.readOnly, false);
    assert.equal(again.member('w').state, 'stopped');
    assert.equal(again.task('T1').status, 'unreported');
    assert.match(again.status(), /w \(codex m\/medium, read-only\) stopped/);
    // While this process owns it, another loader only gets a read-only view.
    const third = Team.load({ cwd, name: 'alpha', env });
    assert.equal(third.readOnly, false, 'same process may reload');
    again.store.releaseOwner();
    team.abortAll();
    await team.idle();
  } finally {
    cleanup();
  }
});
