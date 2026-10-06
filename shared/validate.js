// H0wZy/mcp — Input validation for values that reach an agent's command line.

import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const CONTROL_CHARS = /[\0\r\n]/;

/**
 * Validates the working folder of a delegated task.
 *
 * @param {unknown} cwd
 * @returns {string} The absolute folder path
 * @throws {Error} with a message the calling agent can act on
 */
export function validateCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) {
    throw new Error('`cwd` must be the absolute path of an existing folder.');
  }
  if (CONTROL_CHARS.test(cwd)) {
    throw new Error('`cwd` must not contain line breaks or NUL characters.');
  }
  if (!isAbsolute(cwd)) {
    throw new Error(`\`cwd\` must be an absolute path, got "${cwd}".`);
  }
  let stat;
  try {
    stat = statSync(cwd);
  } catch {
    throw new Error(`\`cwd\` does not exist: ${cwd}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`\`cwd\` is not a folder: ${cwd}`);
  }
  return resolve(cwd);
}

/**
 * Normalizes the optional `paths` argument. Accepts a single string (a common slip
 * by calling models) and resolves relative entries against `base`.
 *
 * @param {unknown} paths
 * @param {string} [base=process.cwd()]
 * @returns {{ path: string, isDir: boolean | null }[]} isDir is null when the path does not exist
 * @throws {Error} on non-string entries or control characters
 */
export function normalizePaths(paths, base = process.cwd()) {
  if (paths === undefined || paths === null || paths === '') return [];
  const list = Array.isArray(paths) ? paths : [paths];
  return list.map((p) => {
    if (typeof p !== 'string' || !p.trim()) {
      throw new Error('Every entry in `paths` must be a non-empty string.');
    }
    if (CONTROL_CHARS.test(p)) {
      throw new Error('Entries in `paths` must not contain line breaks or NUL characters.');
    }
    const abs = resolve(base, p);
    try {
      return { path: abs, isDir: statSync(abs).isDirectory() };
    } catch {
      return { path: abs, isDir: null };
    }
  });
}

/**
 * Turns a model-supplied timeout into whole minutes within [min, max].
 * Missing or non-numeric values (including NaN) use the default.
 *
 * @param {unknown} value
 * @param {{ fallback?: number, min?: number, max?: number }} [options]
 * @returns {number}
 */
export function clampTimeoutMinutes(value, { fallback = 30, min = 1, max = 60 } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}
