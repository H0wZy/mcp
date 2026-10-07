import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Copies a server the way npm ships it (bin/, src/, package.json) into an empty
// directory, optionally with @h0wzy/mcp-shared installed next to it.
function stageServer(name, { withShared }) {
  const root = mkdtempSync(join(tmpdir(), `hmcp-pkg-${name}-`));
  const pkgDir = join(root, 'node_modules', `@h0wzy/mcp-server-${name}`);
  for (const entry of ['bin', 'src', 'package.json']) {
    cpSync(join(repoRoot, 'servers', name, entry), join(pkgDir, entry), { recursive: true });
  }
  if (withShared) {
    cpSync(join(repoRoot, 'shared'), join(root, 'node_modules', '@h0wzy', 'mcp-shared'), {
      recursive: true,
      filter: (src) => !src.includes(`${join('shared', 'test')}`),
    });
  }
  return { root, cli: join(pkgDir, 'bin', 'cli.js') };
}

function initialize(cli) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 10000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('\n')) child.stdin.end();
    });
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
  });
}

for (const name of ['codex', 'antigravity', 'claude', 'team']) {
  test(`${name} server starts from its npm layout with @h0wzy/mcp-shared installed`, async () => {
    const { root, cli } = stageServer(name, { withShared: true });
    try {
      const res = await initialize(cli);
      assert.equal(res.stderr.includes('ERR_MODULE_NOT_FOUND'), false, res.stderr);
      const reply = JSON.parse(res.stdout.split('\n')[0]);
      assert.equal(reply.id, 1);
      assert.equal(reply.result.serverInfo.name, name);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`${name} server fails loudly when @h0wzy/mcp-shared is missing outside the repo`, async () => {
    const { root, cli } = stageServer(name, { withShared: false });
    try {
      const res = await initialize(cli);
      assert.notEqual(res.code, 0);
      assert.match(res.stderr, /ERR_MODULE_NOT_FOUND/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
