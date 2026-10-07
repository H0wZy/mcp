// H0wZy/mcp — Team state on disk (spec 007). One folder per team, outside the repo:
// <state dir>/teams/<project-key>/<team>/ with team.json, tasks.json, events.jsonl,
// results/ and worktrees/.

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { stateDir } from '../chain-guard.js';

export const NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Stable folder name for a project: readable prefix + short hash of the absolute path.
 * @param {string} cwd
 */
export function projectKey(cwd) {
  const abs = resolve(cwd);
  const name =
    basename(abs)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'root';
  return `${name}-${createHash('sha256').update(abs).digest('hex').slice(0, 10)}`;
}

/** Folder holding every team of a project. */
export function projectTeamsDir(cwd, env = process.env) {
  return join(stateDir(env), 'teams', projectKey(cwd));
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

export class TeamStore {
  /**
   * @param {string} dir Team folder
   */
  constructor(dir) {
    this.dir = dir;
    this.resultsDir = join(dir, 'results');
    this.worktreesDir = join(dir, 'worktrees');
  }

  static forTeam(cwd, name, env = process.env) {
    return new TeamStore(join(projectTeamsDir(cwd, env), name));
  }

  exists() {
    return existsSync(join(this.dir, 'team.json'));
  }

  init() {
    mkdirSync(this.resultsDir, { recursive: true, mode: 0o700 });
  }

  loadTeam() {
    return readJson(join(this.dir, 'team.json'), null);
  }

  loadTasks() {
    return readJson(join(this.dir, 'tasks.json'), []);
  }

  saveTeam(data) {
    writeJsonAtomic(join(this.dir, 'team.json'), data);
  }

  saveTasks(tasks) {
    writeJsonAtomic(join(this.dir, 'tasks.json'), tasks);
  }

  appendEvent(event) {
    try {
      appendFileSync(join(this.dir, 'events.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 });
    } catch {
      /* the in-memory queue still has it */
    }
  }

  loadEvents() {
    try {
      return readFileSync(join(this.dir, 'events.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  /**
   * Claims the team for this process. Another live process keeps it.
   * @returns {{ ok: boolean, pid?: number }}
   */
  acquireOwner() {
    const file = join(this.dir, 'owner.json');
    const owner = readJson(file, null);
    if (owner && owner.pid !== process.pid && Number.isInteger(owner.pid) && isAlive(owner.pid)) {
      return { ok: false, pid: owner.pid };
    }
    writeJsonAtomic(file, { pid: process.pid, since: Date.now() });
    return { ok: true };
  }

  releaseOwner() {
    const file = join(this.dir, 'owner.json');
    const owner = readJson(file, null);
    if (owner?.pid === process.pid) rmSync(file, { force: true });
  }

  /**
   * Saves a turn's full output and returns its ref ("reviewer#2").
   */
  writeResult(key, text) {
    mkdirSync(this.resultsDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(this.resultsDir, `${key.replace('#', '-')}.md`), text, { mode: 0o600 });
    return key;
  }

  /**
   * Reads a page of a saved output.
   * @returns {{ text: string, total: number } | null}
   */
  readResult(ref, offset = 0, limit = 20000) {
    if (!/^[a-z][a-z0-9-]{0,31}#[a-z0-9-]{1,40}$/.test(String(ref))) return null;
    try {
      const full = readFileSync(join(this.resultsDir, `${ref.replace('#', '-')}.md`), 'utf8');
      return { text: full.slice(offset, offset + limit), total: full.length };
    } catch {
      return null;
    }
  }

  worktreePath(member) {
    return join(this.worktreesDir, member);
  }

  /** Names of the teams saved for a project. */
  static listTeams(cwd, env = process.env) {
    try {
      return readdirSync(projectTeamsDir(cwd, env)).filter((n) => NAME_PATTERN.test(n));
    } catch {
      return [];
    }
  }
}
