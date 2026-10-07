// Fake `codex` / `agy` binaries for tests: they record argv and stdin and answer
// without touching any real model. Behaviour is driven by environment variables
// that the servers pass through to the agents they spawn (FAKE_AGENT_LOG,
// FAKE_AGENT_MODE=sleep, FAKE_AGENT_PIDFILE, FAKE_AGENT_STDERR).
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AGENT_SOURCE = `
const fs = require('node:fs');
const argv = process.argv.slice(2);
if (argv.includes('debug') || argv[0] === 'models') { process.stdout.write(''); process.exit(0); }
let input = '';
process.stdin.on('data', (c) => (input += c));
let fired = false;
const done = () => {
  if (fired) return;
  fired = true;
  if (process.env.FAKE_AGENT_LOG) {
    fs.appendFileSync(process.env.FAKE_AGENT_LOG, JSON.stringify({ argv, input, cwd: process.cwd() }) + '\\n');
  }
  if (process.env.FAKE_AGENT_PIDFILE) fs.writeFileSync(process.env.FAKE_AGENT_PIDFILE, String(process.pid));
  if (process.env.FAKE_AGENT_MODE === 'sleep') { setTimeout(() => {}, 60000); return; }
  if (process.env.FAKE_AGENT_STDERR) process.stderr.write(process.env.FAKE_AGENT_STDERR);
  process.stdout.write('fake agent answer');
};
if (process.stdin.isTTY || process.stdin.readableEnded) done();
else { process.stdin.on('end', done); process.stdin.on('error', done); setTimeout(done, 1500).unref(); }
`;

/**
 * Creates a fake agent executable named `name` in a temp dir.
 * @returns {{ bin: string, log: string, pidFile: string, calls: () => any[], cleanup: () => void }}
 */
export function createFakeAgent(name) {
  const dir = mkdtempSync(join(tmpdir(), `hmcp-fake-${name}-`));
  const js = join(dir, `${name}.js`);
  writeFileSync(js, AGENT_SOURCE);
  let bin;
  if (process.platform === 'win32') {
    bin = join(dir, `${name}.cmd`);
    writeFileSync(bin, `@node "%~dp0${name}.js" %*\r\n`);
  } else {
    bin = join(dir, name);
    writeFileSync(bin, `#!/usr/bin/env node\n${AGENT_SOURCE}`);
    chmodSync(bin, 0o755);
  }
  const log = join(dir, 'calls.jsonl');
  const pidFile = join(dir, 'agent.pid');
  return {
    bin,
    log,
    pidFile,
    dir,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l))
        : [],
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * True while pid is running. A killed process that its new parent never reaps
 * (PID 1 in some containers) lingers as a zombie; that counts as dead.
 */
export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
  } catch {
    return true; // no /proc (macOS): signal 0 succeeding means it is alive
  }
}
