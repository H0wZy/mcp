#!/usr/bin/env node
// H0wZy/mcp — Lightweight npm/npx runner for the Go CLI

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const cliDir = join(repoRoot, 'cli');

import { existsSync } from 'node:fs';

const isWindows = process.platform === 'win32';
const binaryName = isWindows ? 'h0wzy-mcp.exe' : 'h0wzy-mcp';
const localBin = join(cliDir, binaryName);

const args = process.argv.slice(2);

// 1. Try local precompiled binary if present
if (existsSync(localBin)) {
  const resBin = spawnSync(localBin, args, { stdio: 'inherit', shell: isWindows });
  process.exit(resBin.status ?? 0);
}

// 2. Fall back to `go run ./cli`
const resGo = spawnSync('go', ['run', './cli', ...args], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: isWindows,
});

if (resGo.error) {
  console.error('\n❌ Could not launch h0wzy-mcp.');
  console.error('   Please ensure Go (1.24+) is installed, or download the prebuilt binary from:');
  console.error('   https://github.com/H0wZy/mcp/releases');
  process.exit(1);
}

process.exit(resGo.status ?? 0);
