#!/usr/bin/env node
// H0wZy/mcp — High-performance cross-platform runner for the Go CLI

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, createWriteStream, chmodSync, renameSync, unlinkSync, readFileSync } from 'node:fs';
import { homedir, platform, arch } from 'node:os';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, '..', 'package.json');
let pkgVersion = '1.0.4';
try {
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.version) pkgVersion = pkg.version;
  }
} catch {}

const VERSION = pkgVersion;
const FALLBACK_RELEASE = '1.0.3';
const GITHUB_REPO = 'H0wZy/mcp';

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
  const res = spawnSync(join(cliDir, binaryAsset), args, { stdio: 'inherit' });
  process.exit(res.status ?? 0);
}

// 2. If in dev repository with Go installed, run `go run ./cli`
if (existsSync(join(cliDir, 'main.go'))) {
  const resGo = spawnSync('go', ['run', './cli', ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
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

// Helper to download binary with redirect support and atomic rename
async function downloadBinary(url, dest) {
  const tempDest = `${dest}.tmp-${Date.now()}`;
  return new Promise((resolve, reject) => {
    function getUrl(currentUrl) {
      https.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return getUrl(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with status ${res.statusCode}`));
        }
        const file = createWriteStream(tempDest);
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            try {
              renameSync(tempDest, dest);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });
      }).on('error', (err) => {
        try { if (existsSync(tempDest)) unlinkSync(tempDest); } catch {}
        reject(err);
      });
    }
    getUrl(url);
  });
}

async function run() {
  mkdirSync(cacheDir, { recursive: true });

  let downloadVersion = VERSION;
  let targetBinary = join(cacheDir, `${binaryAsset}-v${downloadVersion}`);

  if (existsSync(targetBinary)) {
    const res = spawnSync(targetBinary, args, { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  }

  // Also check if fallback release binary is already cached
  const fallbackBinary = join(cacheDir, `${binaryAsset}-v${FALLBACK_RELEASE}`);

  console.log(`⬇️ Downloading native H0wZy/mcp CLI (v${downloadVersion}) for ${platform()}-${arch()}...`);
  let downloadUrl = `https://github.com/${GITHUB_REPO}/releases/download/v${downloadVersion}/${binaryAsset}`;

  try {
    await downloadBinary(downloadUrl, targetBinary);
  } catch (err) {
    if (downloadVersion !== FALLBACK_RELEASE) {
      if (existsSync(fallbackBinary)) {
        const res = spawnSync(fallbackBinary, args, { stdio: 'inherit' });
        process.exit(res.status ?? 0);
      }
      downloadVersion = FALLBACK_RELEASE;
      targetBinary = fallbackBinary;
      downloadUrl = `https://github.com/${GITHUB_REPO}/releases/download/v${downloadVersion}/${binaryAsset}`;
      console.log(`⬇️ Resolving stable release v${downloadVersion}...`);
      try {
        await downloadBinary(downloadUrl, targetBinary);
      } catch (fallbackErr) {
        console.error(`❌ Could not download prebuilt binary: ${fallbackErr.message}`);
        console.error(`   Please download manually from: https://github.com/${GITHUB_REPO}/releases/tag/v${FALLBACK_RELEASE}`);
        process.exit(1);
      }
    } else {
      console.error(`❌ Could not download prebuilt binary: ${err.message}`);
      console.error(`   Please download manually from: https://github.com/${GITHUB_REPO}/releases/tag/v${VERSION}`);
      process.exit(1);
    }
  }

  if (!isWindows) {
    chmodSync(targetBinary, 0o755);
  }
  console.log('✅ Download complete! Starting CLI...\n');
  const res = spawnSync(targetBinary, args, { stdio: 'inherit' });
  process.exit(res.status ?? 0);
}

run();
