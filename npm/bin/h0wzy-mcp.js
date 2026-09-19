#!/usr/bin/env node
// H0wZy/mcp — High-performance cross-platform runner for the Go CLI

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, createWriteStream, chmodSync } from 'node:fs';
import { homedir, platform, arch } from 'node:os';
import https from 'node:https';

const VERSION = '1.0.2';
const GITHUB_REPO = 'H0wZy/mcp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const cliDir = join(repoRoot, 'cli');

const isWindows = platform() === 'win32';
const isMac = platform() === 'darwin';
const isLinux = platform() === 'linux';

// Map platform and architecture to release asset names
function getBinaryAsset() {
  const currentArch = arch();
  if (isWindows) {
    return 'h0wzy-mcp-windows-amd64.exe';
  }
  if (isMac) {
    return currentArch === 'arm64' ? 'h0wzy-mcp-darwin-arm64' : 'h0wzy-mcp-darwin-amd64';
  }
  if (isLinux) {
    return 'h0wzy-mcp-linux-amd64';
  }
  return null;
}

const binaryAsset = getBinaryAsset();
const args = process.argv.slice(2);

// 1. Check local checkout compiled binary
if (binaryAsset && existsSync(join(cliDir, binaryAsset))) {
  const res = spawnSync(join(cliDir, binaryAsset), args, { stdio: 'inherit', shell: isWindows });
  process.exit(res.status ?? 0);
}

// 2. If in dev repository with Go installed, run `go run ./cli`
if (existsSync(join(cliDir, 'main.go'))) {
  const resGo = spawnSync('go', ['run', './cli', ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: isWindows,
  });
  if (!resGo.error && resGo.status === 0) {
    process.exit(0);
  }
}

// 3. Standalone mode: Cache & run prebuilt binary from GitHub Releases
if (!binaryAsset) {
  console.error(`❌ Unsupported platform/architecture: ${platform()} ${arch()}`);
  process.exit(1);
}

const cacheDir = join(homedir(), '.h0wzy', 'bin');
const cachedBinary = join(cacheDir, `${binaryAsset}-v${VERSION}`);

if (existsSync(cachedBinary)) {
  const res = spawnSync(cachedBinary, args, { stdio: 'inherit', shell: isWindows });
  process.exit(res.status ?? 0);
}

// Helper to download binary with redirect support
async function downloadBinary(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBinary(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed with status ${res.statusCode}`));
      }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve());
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log(`⬇️ Downloading native H0wZy/mcp CLI (v${VERSION}) for ${platform()}-${arch()}...`);
  mkdirSync(cacheDir, { recursive: true });
  const downloadUrl = `https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/${binaryAsset}`;

  try {
    await downloadBinary(downloadUrl, cachedBinary);
    if (!isWindows) {
      chmodSync(cachedBinary, 0o755);
    }
    console.log('✅ Download complete! Starting CLI...\n');
    const res = spawnSync(cachedBinary, args, { stdio: 'inherit', shell: isWindows });
    process.exit(res.status ?? 0);
  } catch (err) {
    console.error(`❌ Could not download prebuilt binary: ${err.message}`);
    console.error(`   Please download manually from: https://github.com/${GITHUB_REPO}/releases/tag/v${VERSION}`);
    process.exit(1);
  }
}

run();
