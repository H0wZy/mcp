// Fake `codex` / `agy` binaries for tests: they record argv and stdin and answer
// without touching any real model. Behaviour is driven by environment variables
// that the servers pass through to the agents they spawn (FAKE_AGENT_LOG,
// FAKE_AGENT_MODE=sleep|bridge, FAKE_AGENT_PIDFILE, FAKE_AGENT_STDERR, FAKE_AGENT_STDOUT,
// FAKE_AGENT_EXIT, FAKE_BRIDGE_PLAN, FAKE_AGENT_STRIP_ENV, FAKE_TEAMMATE_SLEEP_MS,
// FAKE_TEAMMATE_TEXT, FAKE_TEAMMATE_WRITE).
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
  if (process.env.FAKE_AGENT_MODE === 'bridge') { bridge(); return; }
  if (process.env.FAKE_AGENT_MODE === 'teammate') { teammate(); return; }
  if (process.env.FAKE_AGENT_STDERR) process.stderr.write(process.env.FAKE_AGENT_STDERR);
  process.stdout.write(process.env.FAKE_AGENT_STDOUT || 'fake agent answer');
  if (process.env.FAKE_AGENT_EXIT) process.exitCode = Number(process.env.FAKE_AGENT_EXIT);
};
// Bridge mode: act like an agent that uses an MCP bridge itself. FAKE_BRIDGE_PLAN maps
// this agent's name to { server, host, tool }; every agent in a chain keeps delegating,
// which is exactly the runaway loop the guard must stop.
function bridge() {
  const path = require('node:path');
  const { spawn } = require('node:child_process');
  const me = path.basename(process.argv[1]).replace(/\\.js$/, '');
  const level = Number(process.env.FAKE_NEST_LEVEL || 0) + 1;
  const step = JSON.parse(process.env.FAKE_BRIDGE_PLAN || '{}')[me];
  if (level > 6) { process.stdout.write('RUNAWAY'); return; }
  if (!step) { process.stdout.write('fake ' + me + ' did the work'); return; }
  const env = { ...process.env, FAKE_NEST_LEVEL: String(level) };
  if (process.env.FAKE_AGENT_STRIP_ENV === '1') {
    for (const k of ['H0WZY_MCP_RUN_ID', 'H0WZY_MCP_CHAIN', 'H0WZY_MCP_DEPTH', 'H0WZY_MCP_DEADLINE']) delete env[k];
  }
  const server = spawn(process.execPath, [step.server, '--host', step.host], { env, stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id === 2) {
        const text = msg.result ? msg.result.content[0].text : JSON.stringify(msg.error);
        process.stdout.write('fake ' + me + ' asked ' + step.tool + ':\\n' + text);
        server.stdin.end();
      }
    }
  });
  const send = (m) => server.stdin.write(JSON.stringify(m) + '\\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: step.tool, arguments: { prompt: 'keep delegating forever' } } });
}
// Teammate mode (spec 007): answer like the vendor CLI would, ending with a team-report
// block for the task named in the prompt.
function teammate() {
  const path = require('node:path');
  const me = path.basename(process.argv[1]).replace(/\\.js$/, '');
  const prompt = me === 'agy' ? (argv[argv.indexOf('-p') + 1] || '') : input;
  const task = (prompt.match(/## Your task: (\\S+)/) || [])[1] || null;
  const who = (prompt.match(/You are "([^"]+)"/) || [])[1] || me;
  const fence = String.fromCharCode(96).repeat(3);
  const extra = process.env.FAKE_TEAMMATE_TEXT || '';
  const text = 'fake ' + who + ' worked on ' + (task || 'messages') + extra + '\\n\\n' + fence + 'team-report\\n' +
    JSON.stringify({ status: 'done', task, summary: who + ' finished ' + (task || 'its messages') }) + '\\n' + fence;
  const finish = () => {
    if (me === 'claude') {
      const i = argv.indexOf('--session-id');
      const r = argv.indexOf('--resume');
      const sid = i >= 0 ? argv[i + 1] : r >= 0 ? argv[r + 1] : null;
      process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sid, total_cost_usd: 0.001, num_turns: 1 }));
    } else if (me === 'agy') {
      process.stdout.write(JSON.stringify({ conversation_id: 'conv-' + who, status: 'success', response: text, usage: { input_tokens: 10, output_tokens: 5 } }));
    } else {
      const o = argv.indexOf('-o');
      if (o >= 0) fs.writeFileSync(argv[o + 1], text);
      process.stdout.write('codex progress log');
    }
  };
  if (process.env.FAKE_TEAMMATE_WRITE) fs.writeFileSync(path.join(process.cwd(), process.env.FAKE_TEAMMATE_WRITE), 'changed by ' + who + '\\n');
  const ms = Number(process.env.FAKE_TEAMMATE_SLEEP_MS || 0);
  if (ms) setTimeout(finish, ms);
  else finish();
}
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
