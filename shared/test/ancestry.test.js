import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readAncestors, currentAncestors } from '../ancestry.js';

const moduleUrl = pathToFileURL(fileURLToPath(new URL('../ancestry.js', import.meta.url))).href;

test('the current process lists its parent first', () => {
  const ancestors = readAncestors();
  assert.ok(Array.isArray(ancestors), 'ancestry should be readable on CI platforms');
  assert.equal(ancestors[0], process.ppid);
  assert.deepEqual(currentAncestors(), ancestors);
});

test('a grandchild sees this test process among its ancestors', () => {
  // node -e spawns another node that prints its ancestors: test → child → grandchild.
  const inner = `import(${JSON.stringify(moduleUrl)}).then((m) => console.log(JSON.stringify(m.readAncestors())))`;
  const outer = `const r = require('node:child_process').spawnSync(process.execPath, ['-e', ${JSON.stringify(inner)}], { encoding: 'utf8' }); process.stdout.write(r.stdout)`;
  const res = spawnSync(process.execPath, ['-e', outer], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const ancestors = JSON.parse(res.stdout.trim());
  assert.ok(ancestors.includes(process.pid), `${process.pid} not in ${ancestors}`);
});
