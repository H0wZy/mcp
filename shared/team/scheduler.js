// H0wZy/mcp — The team engine (spec 007): members, task list, turns, events, limits.
// Everything that changes team state runs synchronously on the event loop, so a task
// claim can never happen twice (FR-009).

import { existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { executeProcess } from '../executor.js';
import { resolveBinary } from '../resolver.js';
import { beginHop, createRootChain } from '../chain-guard.js';
import { sanitizeOutput } from '../errors.js';
import { hitPrintTimeout } from '../agy.js';
import { TeamStore, NAME_PATTERN } from './store.js';
import { addTasks, nextTaskFor, claim, unblockedBy, formatTask, TASK_STATUSES } from './tasks.js';
import { parseReport, compact } from './report.js';
import { buildTurn, parseTurn, TEAM_AGENTS } from './adapters.js';
import { buildTurnPrompt } from './protocol.js';

export const TEAM_DEFAULTS = Object.freeze({
  maxTeammates: 3,
  maxTurnsPerTeammate: 10,
  maxTotalTurns: 30,
  deadlineMinutes: 60,
  turnMinutes: 20,
  resultCap: 8000,
});
export const TEAM_CAPS = Object.freeze({
  maxTeammates: 6,
  maxTurnsPerTeammate: 50,
  maxTotalTurns: 150,
  deadlineMinutes: 240,
  turnMinutes: 60,
  resultCap: 50000,
});
const ENV_KEYS = {
  maxTeammates: 'H0WZY_TEAM_MAX_TEAMMATES',
  maxTurnsPerTeammate: 'H0WZY_TEAM_MAX_TURNS',
  maxTotalTurns: 'H0WZY_TEAM_MAX_TOTAL_TURNS',
  deadlineMinutes: 'H0WZY_TEAM_DEADLINE_MINUTES',
  turnMinutes: 'H0WZY_TEAM_TURN_MINUTES',
  resultCap: 'H0WZY_TEAM_RESULT_CAP',
};
const LEAD_LIMIT_KEYS = {
  max_teammates: 'maxTeammates',
  max_turns_per_teammate: 'maxTurnsPerTeammate',
  max_total_turns: 'maxTotalTurns',
  deadline_minutes: 'deadlineMinutes',
  result_cap_chars: 'resultCap',
};
const CHECK_TIMEOUT_MS = 10 * 60 * 1000;
const CHECK_OUTPUT_CHARS = 4000;
const HISTORY_SIZE = 10;
const MEMORY_EVENTS = 500;
const WAIT_BATCH_MS = 250;

/**
 * The developer's ceilings from the environment, clamped to the hard caps.
 * @returns {{ limits: typeof TEAM_DEFAULTS, notes: string[] }}
 */
export function teamCeilings(env = process.env) {
  const limits = { ...TEAM_DEFAULTS };
  const notes = [];
  for (const [key, envKey] of Object.entries(ENV_KEYS)) {
    const raw = env[envKey];
    if (raw === undefined || String(raw).trim() === '') continue;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 1) {
      notes.push(`${envKey}='${raw}' is not a positive number; using ${limits[key]}`);
      continue;
    }
    if (n > TEAM_CAPS[key]) notes.push(`${envKey}=${n} is above the hard cap; clamped to ${TEAM_CAPS[key]}`);
    limits[key] = Math.min(n, TEAM_CAPS[key]);
  }
  return { limits, notes };
}

/**
 * Applies the lead's requested limits, which can only lower the developer's ceilings.
 */
export function effectiveLimits(ceilings, requested = {}) {
  const limits = { ...ceilings };
  const notes = [];
  for (const [leadKey, key] of Object.entries(LEAD_LIMIT_KEYS)) {
    const raw = requested?.[leadKey];
    if (raw === undefined || raw === null) continue;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 1) {
      notes.push(`${leadKey}=${raw} ignored (must be a positive number)`);
    } else if (n > ceilings[key]) {
      notes.push(`${leadKey}=${n} lowered to the developer's ceiling ${ceilings[key]}`);
    } else {
      limits[key] = n;
    }
  }
  return { limits, notes };
}

/** Walks up from `dir` to the folder holding `.git` (a repo or worktree root). */
export function findRepoRoot(dir) {
  let current = resolve(dir);
  for (;;) {
    try {
      statSync(join(current, '.git'));
      return current;
    } catch {
      /* keep walking */
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function git(args, cwd) {
  const bin = resolveBinary('git');
  if (!bin) return { ok: false, stdout: '', stderr: 'git not found on PATH', exitCode: -1 };
  return executeProcess(bin, args, { cwd, timeoutMs: 60000, toolName: 'git' });
}

/**
 * Runs one teammate turn for real: a spec-006 hop, the vendor CLI, and the parsed answer.
 */
export async function runTurnProcess({ team, member, prompt, signal, minutes }) {
  // Every turn is a hop of the team's own chain (FR-018): one deadline for the whole
  // team, and one call budget shared by every bridge its teammates use.
  const decision = beginHop({ target: member.agent, host: 'team', tool: 'team_turn', env: team.env, chain: team.chain(), claim: false });
  if (!decision.ok) return { ok: false, error: decision.refusal.text.split('\n')[0], text: '' };
  const hop = decision.hop;
  const scratch = (ext) => join(team.store.resultsDir, `.${member.agent}-${member.name}-${member.turns}.${ext}`);
  const outputFile = member.agent === 'codex' ? scratch('txt') : undefined;
  const logFile = member.agent === 'antigravity' ? scratch('log') : undefined;
  // agy needs ~25 s around --print-timeout to start and to return its partial output:
  // leave it that grace inside the team's deadline.
  const graceMs = member.agent === 'antigravity' ? 60000 : 0;
  if (graceMs) minutes = Math.max(1, Math.min(minutes, Math.floor((hop.remainingMs() - graceMs) / 60000)));
  let turn;
  try {
    turn = buildTurn({ member, prompt: `${hop.notice}\n\n${prompt}`, hop, outputFile, logFile, minutes, env: team.env, projectDir: team.data?.cwd });
  } catch (err) {
    turn = { ok: false, error: err?.message || String(err) };
  }
  if (!turn.ok) {
    hop.finish('failed');
    return { ok: false, error: turn.error, text: '' };
  }
  let res;
  let parsed;
  try {
    res = await executeProcess(turn.command, turn.args, {
      cwd: turn.cwd,
      input: turn.input,
      env: turn.env,
      timeoutMs: hop.capTimeoutMs(minutes * 60000 + graceMs),
      signal,
      toolName: member.agent === 'antigravity' ? 'agy' : member.agent,
      onSpawn: (child) => hop.registerAgent(child.pid),
    });
    parsed = parseTurn(member.agent, res, { outputFile, logFile, sessionId: turn.sessionId });
  } catch (err) {
    hop.finish('failed');
    throw err;
  } finally {
    turn.cleanup();
    for (const file of [outputFile, logFile]) {
      try {
        if (file) rmSync(file, { force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        /* a file still held on Windows; the team folder keeps it */
      }
    }
  }
  const timedOut = res.timedOut || (member.agent === 'antigravity' && !parsed.ok && hitPrintTimeout(res.stderr));
  hop.finish(res.cancelled ? 'cancelled' : parsed.ok ? 'ran' : timedOut ? 'timed-out' : 'failed');
  return { ...parsed, cancelled: res.cancelled, timedOut, warnings: turn.warnings };
}

export class Team {
  /**
   * @param {Object} options
   * @param {TeamStore} options.store
   * @param {object} options.data team.json content
   * @param {object[]} options.tasks
   * @param {NodeJS.ProcessEnv} [options.env]
   * @param {typeof runTurnProcess} [options.runner] Injectable for tests
   * @param {boolean} [options.readOnly] Another live process owns this team
   * @param {number} [options.ownerPid]
   */
  constructor({ store, data, tasks, env = process.env, runner = runTurnProcess, readOnly = false, ownerPid = null, events = [] }) {
    this.store = store;
    this.data = data;
    this.tasks = tasks;
    this.env = env;
    this.runner = runner;
    this.readOnly = readOnly;
    this.ownerPid = ownerPid;
    this.events = events.slice(-MEMORY_EVENTS);
    this.seq = events.length ? events[events.length - 1].seq : 0;
    this.leadSeq = this.seq;
    this.waiters = new Set();
    this.controllers = new Map();
    this.running = new Map();
    this.grace = new Map();
  }

  get name() {
    return this.data.name;
  }

  /** The team's spec-006 chain; teams saved by an older version get one now. */
  chain() {
    if (!this.data.chain) {
      this.data.chain = createRootChain({ env: this.env, agents: ['team'], deadline: this.data.deadline });
      this.save();
    }
    return this.data.chain;
  }

  /**
   * Creates a team, or takes over a saved one with the same name.
   */
  static create({ name, cwd, host = 'host', limits: requested, selfClaim = true, env = process.env, runner, now = Date.now() }) {
    if (!NAME_PATTERN.test(String(name ?? ''))) throw new Error(`Team name '${name}' must match ${NAME_PATTERN}.`);
    const store = TeamStore.forTeam(cwd, name, env);
    if (store.exists()) {
      const loaded = Team.load({ cwd, name, env, runner });
      if (loaded.readOnly) throw new Error(`Team '${name}' is led by another live session (pid ${loaded.ownerPid}).`);
      return { team: loaded, resumed: true, notes: [] };
    }
    const ceilings = teamCeilings(env);
    const { limits, notes } = effectiveLimits(ceilings.limits, requested);
    store.init();
    const owner = store.acquireOwner();
    if (!owner.ok) throw new Error(`Team '${name}' is led by another live session (pid ${owner.pid}).`);
    const data = {
      name,
      cwd: resolve(cwd),
      host,
      createdAt: now,
      deadline: now + limits.deadlineMinutes * 60000,
      limits,
      selfClaim: selfClaim !== false,
      turnsUsed: 0,
      nextTaskNumber: 1,
      members: [],
      limitsHit: [],
    };
    data.chain = createRootChain({ env, agents: ['team'], deadline: data.deadline });
    const team = new Team({ store, data, tasks: [], env, runner });
    team.save();
    return { team, resumed: false, notes: [...ceilings.notes, ...notes] };
  }

  /**
   * Loads a saved team. Turns that were running when its last lead session ended are
   * gone: their members become stopped and their tasks unreported.
   */
  static load({ cwd, name, env = process.env, runner }) {
    const store = TeamStore.forTeam(cwd, name, env);
    const data = store.loadTeam();
    if (!data) throw new Error(`No team named '${name}' in this project.`);
    const tasks = store.loadTasks();
    const owner = store.acquireOwner();
    const team = new Team({ store, data, tasks, env, runner, readOnly: !owner.ok, ownerPid: owner.pid ?? null, events: store.loadEvents() });
    if (team.readOnly) return team;
    for (const m of data.members) {
      if (m.state === 'working' || m.state === 'stopping') {
        m.state = 'stopped';
        m.lastError = 'the previous lead session ended during its turn';
      }
    }
    for (const t of tasks) {
      if (t.status === 'in_progress') {
        t.status = 'unreported';
        t.note = 'the previous lead session ended during the turn';
      }
    }
    team.save();
    return team;
  }

  /**
   * Loads a saved team by name from whichever project folder it was created for.
   * @returns {Team}
   * @throws when no team or more than one team has that name
   */
  static find({ name, env = process.env, runner }) {
    const matches = TeamStore.findByName(name, env);
    if (!matches.length) throw new Error(`No team named '${name}'. Create it with team_create.`);
    if (matches.length > 1) {
      throw new Error(`More than one saved team is named '${name}' (${matches.map((m) => m.cwd).join(', ')}); pass \`cwd\` to pick one.`);
    }
    return Team.load({ cwd: matches[0].cwd, name, env, runner });
  }

  save() {
    if (this.readOnly) return;
    this.store.saveTeam(this.data);
    this.store.saveTasks(this.tasks);
  }

  assertWritable() {
    if (this.readOnly) throw new Error(`Team '${this.name}' is led by another live session (pid ${this.ownerPid}); it can only be read here.`);
  }

  member(name) {
    return this.data.members.find((m) => m.name === name);
  }

  task(id) {
    return this.tasks.find((t) => t.id === id);
  }

  // -------------------------------------------------------------------------
  // Events and waiting
  // -------------------------------------------------------------------------

  emit(type, text, fields = {}) {
    const event = { seq: ++this.seq, at: Date.now(), type, text, ...fields };
    this.events.push(event);
    if (this.events.length > MEMORY_EVENTS) this.events.shift();
    this.store.appendEvent(event);
    for (const waiter of [...this.waiters]) waiter();
    return event;
  }

  takeEvents() {
    const fresh = this.events.filter((e) => e.seq > this.leadSeq);
    if (fresh.length) this.leadSeq = fresh[fresh.length - 1].seq;
    return fresh;
  }

  /**
   * Resolves with every event the lead hasn't seen, waiting for the next one if needed.
   * Events that arrive together are returned together.
   */
  wait(timeoutMs, signal) {
    const ready = this.takeEvents();
    if (ready.length || timeoutMs <= 0) return Promise.resolve(ready);
    return new Promise((resolvePromise) => {
      let timer;
      let batch;
      const finish = (deliver) => {
        clearTimeout(timer);
        clearTimeout(batch);
        this.waiters.delete(onEvent);
        signal?.removeEventListener('abort', onAbort);
        // A cancelled wait sends no reply, so its events stay unread for the next wait.
        resolvePromise(deliver ? this.takeEvents() : []);
      };
      const onAbort = () => finish(false);
      const onEvent = () => {
        if (!batch) batch = setTimeout(() => finish(true), WAIT_BATCH_MS);
      };
      this.waiters.add(onEvent);
      timer = setTimeout(() => finish(true), timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  // -------------------------------------------------------------------------
  // Lead actions
  // -------------------------------------------------------------------------

  /**
   * Adds a teammate, or revives a stopped / failed one with its history.
   * @param {Object} spec Validated by the server: agent, role, settings, canEdit, …
   */
  spawn(spec) {
    this.assertWritable();
    const { name } = spec;
    if (!NAME_PATTERN.test(String(name ?? '')) || name === 'lead' || name === 'team') {
      throw new Error(`Teammate name '${name}' must match ${NAME_PATTERN} and can't be 'lead' or 'team'.`);
    }
    if (!TEAM_AGENTS.includes(spec.agent)) throw new Error(`agent must be one of ${TEAM_AGENTS.join(', ')}.`);
    const existing = this.member(name);
    if (existing && !['stopped', 'failed'].includes(existing.state)) {
      throw new Error(`A teammate named '${name}' is already ${existing.state}.`);
    }
    const active = this.data.members.filter((m) => m.state !== 'stopped' && m.state !== 'failed' && m.name !== name);
    if (active.length >= this.data.limits.maxTeammates) {
      throw new Error(`The team already has ${active.length} active teammates (limit ${this.data.limits.maxTeammates}). Shut one down or raise H0WZY_TEAM_MAX_TEAMMATES.`);
    }

    // Validate everything before touching the team, so a refused spawn leaves no trace.
    const taskText = spec.task === undefined || spec.task === null ? null : String(spec.task).trim();
    if (spec.task !== undefined && spec.task !== null && !taskText) throw new Error('`task` must not be empty.');
    let existingTask = null;
    if (spec.taskId) {
      existingTask = this.task(spec.taskId);
      if (!existingTask) throw new Error(`No task '${spec.taskId}'.`);
      if (existingTask.status !== 'pending') throw new Error(`Task ${existingTask.id} is ${existingTask.status}; only pending tasks can be assigned.`);
    }

    const notes = [];
    let isolation = 'none';
    let workDir = this.data.cwd;
    let repoRoot = null;
    if (spec.canEdit) {
      repoRoot = findRepoRoot(this.data.cwd);
      const wanted = spec.isolation || (repoRoot ? 'worktree' : 'none');
      // An editing Antigravity teammate runs agy with every permission check off
      // (there is no edit-only mode), so it only ever gets a throwaway worktree.
      if (spec.agent === 'antigravity' && (wanted !== 'worktree' || !repoRoot)) {
        throw new Error(
          'An editing Antigravity teammate must work in its own git worktree (agy has no edit-only permission mode). ' +
            (repoRoot ? 'Use isolation "worktree".' : 'The project folder is not a git repository; spawn it read-only or use Claude Code / Codex for edits.')
        );
      }
      if (wanted === 'worktree' && !repoRoot) {
        notes.push('isolation "worktree" needs a git repository; this teammate edits the project folder directly');
      } else if (wanted === 'worktree') {
        isolation = 'worktree';
        workDir = join(this.store.worktreePath(name), relative(repoRoot, this.data.cwd));
      }
    }

    const maxTurns = Math.min(
      this.data.limits.maxTurnsPerTeammate,
      Number.isInteger(spec.maxTurns) && spec.maxTurns > 0 ? spec.maxTurns : Infinity
    );
    const member = {
      name,
      agent: spec.agent,
      role: String(spec.role ?? '').slice(0, 4000),
      model: spec.settings.model,
      effort: spec.settings.effort,
      effortApplied: spec.settings.effortApplied !== false,
      cliModel: spec.settings.cliModel,
      cliEffort: spec.settings.cliEffort,
      tier: spec.tier ?? null,
      canEdit: Boolean(spec.canEdit),
      isolation,
      repoRoot: isolation === 'worktree' ? repoRoot : null,
      workDir,
      owns: Array.isArray(spec.owns) ? spec.owns.map(String) : [],
      state: 'idle',
      turns: existing?.turns ?? 0,
      maxTurns,
      currentTask: null,
      sessionId: existing?.sessionId ?? null,
      history: existing?.history ?? [],
      mailbox: existing?.mailbox ?? [],
      notes: existing?.notes ?? [],
      usage: existing?.usage ?? { costUsd: 0, inputTokens: 0, outputTokens: 0 },
      lastError: null,
      claimNext: true,
      limitsHit: [],
    };
    if (existing) Object.assign(existing, member);
    else this.data.members.push(member);
    const target = existing || member;

    let assigned = null;
    if (taskText) {
      const created = this.createTasks([{ title: taskText.split('\n')[0].slice(0, 80), description: taskText, assignee: name }], { schedule: false });
      assigned = created[0];
    } else if (existingTask) {
      existingTask.assignee = name;
      existingTask.updatedAt = Date.now();
      assigned = existingTask;
    }
    this.data.closed = false;
    this.save();
    this.schedule();
    return { member: target, assigned, notes };
  }

  createTasks(specs, { schedule = true } = {}) {
    this.assertWritable();
    // A check runs a command with this server's rights, outside the host's own
    // permission prompts, so the developer has to allow checks explicitly.
    if (Array.isArray(specs) && specs.some((t) => t?.check) && !/^(1|true|yes|on)$/i.test(String(this.env.H0WZY_TEAM_ALLOW_CHECKS ?? ''))) {
      throw new Error(
        'Completion checks are off: they run a command without asking. The developer can turn them on with H0WZY_TEAM_ALLOW_CHECKS=1 in the team server environment. Nothing was created.'
      );
    }
    const { tasks, created, nextNumber } = addTasks(this.tasks, specs, { nextNumber: this.data.nextTaskNumber });
    this.tasks = tasks;
    this.data.nextTaskNumber = nextNumber;
    this.save();
    if (schedule) this.schedule();
    return created;
  }

  updateTask(id, patch = {}) {
    this.assertWritable();
    const t = this.task(id);
    if (!t) throw new Error(`No task '${id}'. Valid ids: ${this.tasks.map((x) => x.id).join(', ') || '(none)'}.`);
    if (patch.status !== undefined) {
      const allowed = ['pending', 'cancelled', 'completed', 'failed'];
      if (!allowed.includes(patch.status)) throw new Error(`status must be one of ${allowed.join(', ')}.`);
      t.status = patch.status;
      if (patch.status === 'pending') t.note = null;
    }
    if (patch.assignee !== undefined) {
      if (patch.assignee && !this.member(patch.assignee)) {
        throw new Error(`No teammate '${patch.assignee}'. Valid names: ${this.data.members.map((m) => m.name).join(', ') || '(none)'}.`);
      }
      t.assignee = patch.assignee || null;
    }
    if (patch.description !== undefined) t.description = String(patch.description).slice(0, 8000);
    if (patch.note !== undefined) t.note = patch.note ? String(patch.note).slice(0, 1000) : null;
    t.updatedAt = Date.now();
    this.save();
    this.schedule();
    return t;
  }

  message(to, text, from = 'lead') {
    this.assertWritable();
    const target = this.member(to);
    if (!target) {
      throw new Error(`No teammate '${to}'. Valid names: ${this.data.members.map((m) => m.name).join(', ') || '(none)'}.`);
    }
    target.mailbox.push({ from, text: String(text).slice(0, 4000), at: Date.now() });
    this.save();
    this.schedule();
    return target;
  }

  /**
   * Stops one teammate or the whole team. A running turn gets `graceMs`, then is killed.
   */
  shutdown({ member, graceMs = 60000 } = {}) {
    this.assertWritable();
    const targets = member ? [this.member(member)].filter(Boolean) : this.data.members;
    if (member && !targets.length) throw new Error(`No teammate '${member}'.`);
    if (!member) this.data.closed = true;
    const summary = [];
    for (const m of targets) {
      if (m.state === 'working') {
        m.state = 'stopping';
        const timer = setTimeout(() => this.controllers.get(m.name)?.abort(), graceMs);
        this.grace.set(m.name, timer);
        summary.push(`${m.name}: stopping (turn gets ${Math.round(graceMs / 1000)} s)`);
      } else if (m.state !== 'stopped') {
        m.state = 'stopped';
        summary.push(`${m.name}: stopped`);
      }
    }
    this.save();
    return summary;
  }

  /** Kills every running turn now (server shutdown). */
  abortAll() {
    for (const c of this.controllers.values()) c.abort();
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  limitHit(member, limit, value) {
    const key = `${member.name}:${limit}`;
    if (this.data.limitsHit.includes(key)) return;
    this.data.limitsHit.push(key);
    let tail = '';
    const t = member.currentTask && this.task(member.currentTask);
    if (t && t.status === 'in_progress') {
      t.status = 'unreported';
      t.note = `${limit} reached before it was done`;
      member.currentTask = null;
      tail = ` · ${t.id} left in_progress → unreported`;
    }
    this.emit('limit', `[limit] ${member.name} reached ${limit} (${value})${tail}`, { member: member.name });
  }

  /**
   * Starts a turn for every idle teammate that has work and budget left.
   */
  schedule() {
    if (this.readOnly || this.data.closed) return;
    const now = Date.now();
    for (const member of this.data.members) {
      if (member.state !== 'idle') continue;
      let task = null;
      const current = member.currentTask && this.task(member.currentTask);
      if (current && current.status === 'in_progress' && current.assignee === member.name) task = current;
      if (!task) task = nextTaskFor(member.name, this.tasks, { selfClaim: this.data.selfClaim && member.claimNext !== false });
      const hasMail = member.mailbox.length > 0;
      // A task this member reported as blocked waits for new input: a message wakes the
      // member on it again; otherwise only the lead (task_update) can reopen it.
      if (!task && hasMail) {
        const blocked = this.tasks.find((t) => t.status === 'blocked' && t.assignee === member.name);
        if (blocked) {
          blocked.status = 'pending';
          task = blocked;
        }
      }
      if (!task && !hasMail) continue;

      if (member.turns >= member.maxTurns) {
        this.limitHit(member, 'max_turns_per_teammate', member.maxTurns);
        continue;
      }
      if (this.data.turnsUsed >= this.data.limits.maxTotalTurns) {
        this.limitHit(member, 'max_total_turns', this.data.limits.maxTotalTurns);
        continue;
      }
      if (now >= this.data.deadline) {
        this.limitHit(member, 'deadline', `${this.data.limits.deadlineMinutes} min`);
        continue;
      }
      this.startTurn(member, task);
    }
    this.save();
  }

  startTurn(member, task) {
    member.state = 'working';
    member.turns += 1;
    this.data.turnsUsed += 1;
    if (task && task.status === 'pending') claim(task, member.name);
    member.currentTask = task ? task.id : null;
    const messages = [...(member.notes || []).splice(0), ...member.mailbox.splice(0)];
    const controller = new AbortController();
    this.controllers.set(member.name, controller);
    const run = this.runTurn(member, task, messages, controller.signal)
      .catch((err) => this.finishFailed(member, task, err?.message || String(err)))
      .finally(() => {
        this.controllers.delete(member.name);
        this.running.delete(member.name);
        clearTimeout(this.grace.get(member.name));
        this.grace.delete(member.name);
        this.save();
        this.schedule();
      });
    this.running.set(member.name, run);
  }

  /** Resolves when no turn is running (tests and shutdown). */
  async idle() {
    while (this.running.size) await Promise.allSettled([...this.running.values()]);
  }

  async ensureWorktree(member) {
    if (member.isolation !== 'worktree') return null;
    const root = this.store.worktreePath(member.name);
    if (existsSync(root)) return null;
    const res = await git(['worktree', 'add', '--detach', root, 'HEAD'], member.repoRoot);
    return res.ok ? null : `could not create its worktree: ${(res.stderr || res.stdout).trim().slice(0, 300)}`;
  }

  async runTurn(member, task, messages, signal) {
    const worktreeError = await this.ensureWorktree(member);
    if (worktreeError) return this.finishFailed(member, task, worktreeError);

    const prompt = buildTurnPrompt({
      team: this.name,
      member,
      members: this.data.members,
      task,
      dependencies: task ? task.dependsOn.map((id) => this.task(id)).filter(Boolean) : [],
      messages,
      carryHistory: member.agent === 'codex' || !member.sessionId,
    });
    const minutes = Math.max(1, Math.min(this.data.limits.turnMinutes, Math.floor((this.data.deadline - Date.now()) / 60000)));
    const result = await this.runner({ team: this, member, task, prompt, signal, minutes });
    return this.applyTurn(member, task, result);
  }

  finishFailed(member, task, error) {
    if (member.state === 'stopping') {
      member.state = 'stopped';
    } else {
      member.state = 'failed';
    }
    // Provider stderr and agy log hints end up here: redact before storing or emitting.
    member.lastError = sanitizeOutput(String(error)).slice(0, 500);
    let tail = '';
    if (task && task.status === 'in_progress' && task.assignee === member.name) {
      task.status = 'pending';
      task.assignee = null;
      task.note = `released: ${member.name} ${member.state === 'stopped' ? 'was stopped' : 'failed'}`;
      task.updatedAt = Date.now();
      tail = ` · ${task.id} released to pending`;
    }
    member.currentTask = null;
    const firstLine = member.lastError.split('\n')[0];
    if (member.state === 'stopped') this.emit('stopped', `[stopped] ${member.name}${tail}`, { member: member.name });
    else this.emit('failed', `[failed] ${member.name}: ${firstLine}${tail}`, { member: member.name, task: task?.id });
  }

  async applyTurn(member, task, result) {
    if (!result.ok) return this.finishFailed(member, task, result.cancelled ? 'stopped by the lead' : result.error || 'the turn failed');

    if (result.sessionId) member.sessionId = result.sessionId;
    if (result.usage) {
      member.usage.costUsd += result.usage.costUsd || 0;
      member.usage.inputTokens += result.usage.inputTokens || 0;
      member.usage.outputTokens += result.usage.outputTokens || 0;
    }

    const n = member.turns;
    const cap = this.data.limits.resultCap;
    const { answer, report } = parseReport(result.text);
    const ref = this.store.writeResult(`${member.name}#${n}`, sanitizeOutput(answer || '(no answer)'));
    const preview = compact(sanitizeOutput(answer), cap, ref);
    const stillMine = task && task.status === 'in_progress' && task.assignee === member.name;
    const settle = () => {
      member.state = member.state === 'stopping' ? 'stopped' : 'idle';
    };

    if (!report) {
      if (stillMine) {
        task.status = 'unreported';
        task.note = `no team-report from ${member.name} (turn ${n})`;
        task.result = { summary: '', ref };
        task.updatedAt = Date.now();
      }
      member.currentTask = null;
      member.history = [...member.history, { turn: n, task: task?.id ?? null, status: 'unreported', summary: answer.slice(0, 200) }].slice(-HISTORY_SIZE);
      settle();
      this.emit(
        'unreported',
        `[unreported] ${member.name} ended turn ${n} without a team-report block${stillMine ? ` · ${task.id} marked unreported` : ''} · ref ${ref}\n${preview}`,
        { member: member.name, task: task?.id, ref }
      );
      return;
    }

    // Messages to the lead become events; others go to mailboxes.
    const names = new Set(this.data.members.map((m) => m.name));
    const dropped = [];
    for (const msg of report.messages) {
      if (msg.to === member.name) continue;
      if (msg.to === 'lead') {
        this.emit('message', `[message] ${member.name} → lead: ${JSON.stringify(msg.text)}`, { member: member.name });
      } else if (names.has(msg.to)) {
        this.member(msg.to).mailbox.push({ from: member.name, text: msg.text, at: Date.now() });
      } else {
        dropped.push(msg.to);
      }
    }
    if (dropped.length) {
      // Not mail: a bounce must not wake the sender (it could loop on its own mistake).
      const valid = `lead, ${[...names].join(', ')}`;
      (member.notes ||= []).push({
        from: 'team',
        text: `Your message(s) to ${dropped.join(', ')} were not delivered: no such member. Valid names: ${valid}.`,
        at: Date.now(),
      });
      this.emit('message', `[message] ${member.name} tried to message unknown member(s) ${dropped.join(', ')} (valid: ${valid}); not delivered`, { member: member.name });
    }

    let outcome = '';
    if (stillMine) {
      const now = Date.now();
      if (report.status === 'done') {
        const check = task.check ? await this.runCheck(task, member, this.controllers.get(member.name)?.signal) : { ok: true };
        if (check.ok) {
          task.status = 'completed';
          task.result = { summary: report.summary, ref };
          task.note = null;
          member.currentTask = null;
          const freed = unblockedBy(task.id, this.tasks).map((t) => t.id);
          outcome = ` → ${task.id} completed${freed.length ? `; ${freed.join(', ')} now available` : ''}`;
        } else {
          member.mailbox.push({ from: 'check', text: `The check for ${task.id} (\`${task.check.join(' ')}\`) failed:\n${check.output}`, at: now });
          task.note = 'check failed; sent back';
          this.emit('check', `[check] ${task.id} check failed (exit ${check.exitCode}) · sent back to ${member.name}`, { member: member.name, task: task.id });
          outcome = ` → ${task.id} check failed`;
        }
      } else if (report.status === 'failed') {
        task.status = 'failed';
        task.note = report.summary || 'reported failed';
        task.result = { summary: report.summary, ref };
        member.currentTask = null;
        outcome = ` → ${task.id} failed`;
      } else if (report.status === 'blocked') {
        task.status = 'blocked';
        task.note = `blocked: ${report.summary}`;
        member.currentTask = null;
        outcome = ` → ${task.id} blocked (waits for a message or task_update)`;
      } else {
        outcome = ` → ${task.id} continues`;
      }
      task.updatedAt = now;
    }

    member.claimNext = report.claimNext;
    member.history = [...member.history, { turn: n, task: task?.id ?? null, status: report.status, summary: report.summary }].slice(-HISTORY_SIZE);
    // In a shared folder, git status also shows the lead's and other teammates' edits.
    if (member.canEdit && member.isolation === 'worktree' && member.owns.length) await this.checkOwnership(member);
    settle();
    this.emit(
      'idle',
      `[idle] ${member.name} finished ${task ? task.id : 'its turn'} (${report.status})${outcome} — ${JSON.stringify(report.summary)} · ref ${ref} · turns ${member.turns}/${member.maxTurns}\n${preview}`,
      { member: member.name, task: task?.id, ref }
    );
  }

  async runCheck(task, member, signal) {
    const [command, ...args] = task.check;
    const bin = resolveBinary(command) || command;
    const res = await executeProcess(bin, args, { cwd: member.workDir, timeoutMs: CHECK_TIMEOUT_MS, toolName: command, signal });
    const output = sanitizeOutput(`${res.stdout}\n${res.stderr}`.trim()).slice(-CHECK_OUTPUT_CHARS);
    return { ok: res.ok, exitCode: res.exitCode, output };
  }

  async changedFiles(member) {
    const root = member.isolation === 'worktree' ? this.store.worktreePath(member.name) : findRepoRoot(member.workDir);
    if (!root) return null;
    const res = await git(['status', '--porcelain', '--untracked-files=all'], root);
    if (!res.ok) return null;
    return res.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop());
  }

  async checkOwnership(member) {
    const files = await this.changedFiles(member);
    if (!files) return;
    const owned = member.owns.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, ''));
    const outside = files.filter((f) => !owned.some((p) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`)));
    if (outside.length) {
      this.emit('ownership', `[ownership] ${member.name} changed files outside its declared set: ${outside.slice(0, 20).join(', ')}`, { member: member.name });
    }
  }

  /**
   * The isolated teammate's change set, saved in full and summarized.
   */
  async changes(memberName, { remove = false } = {}) {
    const member = this.member(memberName);
    if (!member) throw new Error(`No teammate '${memberName}'.`);
    if (member.isolation !== 'worktree') {
      throw new Error(`${memberName} edits the project folder directly (isolation "none"); use git in the project to see its changes.`);
    }
    const root = this.store.worktreePath(member.name);
    if (!existsSync(root)) return { text: `${memberName} has no worktree yet (it hasn't run a turn).` };
    await git(['add', '-A', '-N'], root);
    const status = await git(['status', '--porcelain', '--untracked-files=all'], root);
    const stat = await git(['diff', '--stat'], root);
    const diff = await git(['diff'], root);
    const ref = this.store.writeResult(`${member.name}#changes-${Date.now()}`, diff.stdout || '(no changes)');
    let text =
      `Change set of ${memberName} (worktree ${root}):\n` +
      (status.stdout.trim() || '(no changes)') +
      (stat.stdout.trim() ? `\n\n${stat.stdout.trim()}` : '') +
      `\n\nFull diff: team_result("${ref}")`;
    if (remove) {
      if (member.state === 'working') throw new Error(`${memberName} is working; shut it down before removing its worktree.`);
      const rm = await git(['worktree', 'remove', '--force', root], member.repoRoot || this.data.cwd);
      text += rm.ok ? '\nWorktree removed.' : `\nCould not remove the worktree: ${rm.stderr.trim()}`;
    }
    return { text, ref };
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  status() {
    const d = this.data;
    const minutesLeft = Math.max(0, Math.round((d.deadline - Date.now()) / 60000));
    const lines = [
      `Team "${d.name}" · lead: ${d.host} · ${d.cwd}${this.readOnly ? ` · READ-ONLY (led by pid ${this.ownerPid})` : ''}`,
      `Turns ${d.turnsUsed}/${d.limits.maxTotalTurns} · deadline in ${minutesLeft} min · teammates ≤ ${d.limits.maxTeammates} · self-claim ${d.selfClaim ? 'on' : 'off'}${d.closed ? ' · shut down' : ''}`,
      '',
      'Members:',
    ];
    if (!d.members.length) lines.push('  (none yet — team_spawn adds one)');
    for (const m of d.members) {
      const usage = [
        m.usage.costUsd ? `$${m.usage.costUsd.toFixed(4)}` : '',
        m.usage.inputTokens || m.usage.outputTokens ? `${m.usage.inputTokens}+${m.usage.outputTokens} tokens` : '',
      ]
        .filter(Boolean)
        .join(', ');
      lines.push(
        `  ${m.name} (${m.agent} ${m.model}/${m.effortApplied === false ? 'n/a' : m.effort}, ${m.canEdit ? `edits ${m.isolation === 'worktree' ? 'in its worktree' : 'the project'}` : 'read-only'}) ` +
          `${m.state}${m.currentTask ? ` on ${m.currentTask}` : ''} · turns ${m.turns}/${m.maxTurns}` +
          (usage ? ` · ${usage}` : '') +
          (m.mailbox.length ? ` · ${m.mailbox.length} unread` : '') +
          (m.lastError ? ` · last error: ${m.lastError.split('\n')[0].slice(0, 120)}` : '')
      );
    }
    lines.push('', 'Tasks:');
    if (!this.tasks.length) lines.push('  (none yet — task_create adds them)');
    for (const t of this.tasks) lines.push(`  ${formatTask(t)}`);
    const owned = this.tasks.filter((t) => t.status === 'in_progress' && t.assignee);
    if (owned.length) {
      lines.push('', `Owned by teammates (don't redo these yourself): ${owned.map((t) => `${t.id} (${t.assignee})`).join(', ')}`);
    }
    return compact(lines.join('\n'), Math.max(this.data.limits.resultCap, 4000));
  }

  taskList() {
    return this.tasks.length ? this.tasks.map(formatTask).join('\n') : '(no tasks)';
  }
}

export { TASK_STATUSES };
