import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCwd, normalizePaths, clampTimeoutMinutes } from '../validate.js';

test('validateCwd accepts an existing absolute folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmcp-cwd-'));
  try {
    assert.equal(validateCwd(dir), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateCwd rejects missing, relative, non-folder and multi-line values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmcp-cwd-'));
  const file = join(dir, 'f.txt');
  writeFileSync(file, 'x');
  try {
    assert.throws(() => validateCwd(undefined), /absolute path of an existing folder/);
    assert.throws(() => validateCwd('relative/dir'), /must be an absolute path/);
    assert.throws(() => validateCwd(join(dir, 'missing')), /does not exist/);
    assert.throws(() => validateCwd(file), /is not a folder/);
    assert.throws(() => validateCwd(`${dir}\nrm -rf /`), /line breaks/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizePaths accepts a single string and resolves relative entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmcp-paths-'));
  writeFileSync(join(dir, 'a.js'), '');
  try {
    assert.deepEqual(normalizePaths('a.js', dir), [{ path: join(dir, 'a.js'), isDir: false }]);
    assert.deepEqual(normalizePaths(['.', 'missing.js'], dir), [
      { path: dir, isDir: true },
      { path: join(dir, 'missing.js'), isDir: null },
    ]);
    assert.deepEqual(normalizePaths(undefined, dir), []);
    assert.throws(() => normalizePaths([42], dir), /non-empty string/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clampTimeoutMinutes never returns NaN and stays within bounds', () => {
  assert.equal(clampTimeoutMinutes(undefined), 30);
  assert.equal(clampTimeoutMinutes('abc'), 30);
  assert.equal(clampTimeoutMinutes(Number.NaN), 30);
  assert.equal(clampTimeoutMinutes('15'), 15);
  assert.equal(clampTimeoutMinutes(0), 1);
  assert.equal(clampTimeoutMinutes(999), 60);
  assert.equal(clampTimeoutMinutes(7.6), 8);
});
