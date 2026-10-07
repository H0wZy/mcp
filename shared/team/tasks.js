// H0wZy/mcp — Team task list (spec 007): dependencies, availability and claims.
// Pure functions over a plain array, so the scheduler stays the only writer.

export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'unreported'];
const TASK_ID = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 8000;

/**
 * Finds a dependency cycle.
 * @param {{ id: string, dependsOn: string[] }[]} tasks
 * @returns {string[] | null} e.g. ["T1", "T2", "T1"]
 */
export function findCycle(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map(); // 1 = visiting, 2 = done
  const stack = [];
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn || []) {
      if (state.get(dep) === 1) return [...stack.slice(stack.indexOf(dep)), dep];
      if (!state.has(dep) && byId.has(dep)) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const t of tasks) {
    if (!state.has(t.id)) {
      const found = visit(t.id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Validates and adds a batch of tasks. Nothing is added if any task is invalid.
 *
 * @param {object[]} existing
 * @param {object[]} specs [{ id?, title, description?, assignee?, depends_on?, check? }]
 * @param {{ nextNumber: number, now?: number }} options
 * @returns {{ tasks: object[], created: object[], nextNumber: number }}
 * @throws {Error} with a message the lead can act on
 */
export function addTasks(existing, specs, { nextNumber, now = Date.now() }) {
  if (!Array.isArray(specs) || specs.length === 0) throw new Error('`tasks` must be a non-empty array.');
  if (specs.length > 50) throw new Error('At most 50 tasks per call.');
  const ids = new Set(existing.map((t) => t.id));
  let n = nextNumber;
  const created = [];
  for (const spec of specs) {
    if (!spec || typeof spec.title !== 'string' || !spec.title.trim()) {
      throw new Error('Every task needs a non-empty `title`.');
    }
    let id = spec.id;
    if (id === undefined || id === null || id === '') {
      while (ids.has(`T${n}`)) n++;
      id = `T${n++}`;
    } else if (!TASK_ID.test(String(id))) {
      throw new Error(`Task id '${id}' must match ${TASK_ID}.`);
    }
    if (ids.has(id)) throw new Error(`Task id '${id}' already exists.`);
    ids.add(id);
    const check = spec.check ?? null;
    if (check !== null && (!Array.isArray(check) || check.length === 0 || !check.every((a) => typeof a === 'string' && a.length > 0))) {
      throw new Error(`Task '${id}': \`check\` must be a non-empty array of strings (a command and its arguments, no shell).`);
    }
    created.push({
      id,
      title: spec.title.trim().slice(0, MAX_TITLE),
      description: String(spec.description ?? '').slice(0, MAX_DESCRIPTION),
      status: 'pending',
      assignee: spec.assignee ? String(spec.assignee) : null,
      dependsOn: Array.isArray(spec.depends_on) ? spec.depends_on.map(String) : [],
      check,
      result: null,
      note: null,
      updatedAt: now,
    });
  }
  const all = [...existing, ...created];
  for (const t of created) {
    const missing = t.dependsOn.filter((d) => !ids.has(d));
    if (missing.length) throw new Error(`Task '${t.id}' depends on unknown task(s): ${missing.join(', ')}.`);
  }
  const cycle = findCycle(all);
  if (cycle) throw new Error(`These dependencies form a cycle: ${cycle.join(' → ')}. Nothing was created.`);
  return { tasks: all, created, nextNumber: n };
}

/** Dependencies that are not completed yet. */
export function openDependencies(task, tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return task.dependsOn.filter((d) => byId.get(d)?.status !== 'completed');
}

/**
 * True when `task` can start for `member`: pending, dependencies completed, and
 * unassigned or assigned to that member.
 */
export function isAvailable(task, tasks, member = null) {
  if (task.status !== 'pending') return false;
  if (openDependencies(task, tasks).length > 0) return false;
  return !task.assignee || task.assignee === member;
}

/**
 * The task `member` should work on next: first its own assigned tasks, then (with
 * self-claim) the oldest unassigned available one.
 */
export function nextTaskFor(member, tasks, { selfClaim = true } = {}) {
  const mine = tasks.find((t) => t.assignee === member && isAvailable(t, tasks, member));
  if (mine) return mine;
  if (!selfClaim) return null;
  return tasks.find((t) => !t.assignee && isAvailable(t, tasks, member)) || null;
}

/** Claims `task` for `member` (the scheduler is the only caller, so this is atomic). */
export function claim(task, member, now = Date.now()) {
  task.status = 'in_progress';
  task.assignee = member;
  task.updatedAt = now;
}

/** Tasks that just became available because `doneId` completed. */
export function unblockedBy(doneId, tasks) {
  return tasks.filter((t) => t.status === 'pending' && t.dependsOn.includes(doneId) && openDependencies(t, tasks).length === 0);
}

/** One line per task for lead-facing output. */
export function formatTask(task) {
  const who = task.assignee ? ` @${task.assignee}` : '';
  const deps = task.dependsOn.length ? ` ← ${task.dependsOn.join(',')}` : '';
  const note = task.note ? ` (${task.note.slice(0, 120)})` : '';
  const ref = task.result?.ref ? ` · ref ${task.result.ref}` : '';
  return `${task.id} [${task.status}]${who} "${task.title}"${deps}${note}${ref}`;
}
