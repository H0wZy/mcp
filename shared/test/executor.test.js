import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeProcess, quoteCmdArg } from '../executor.js';

const isWindows = process.platform === 'win32';

function script(dir, name, body) {
  const file = join(dir, name);
  writeFileSync(file, body);
  return file;
}

// A killed process whose new parent never reaps it (e.g. PID 1 in some containers)
// lingers as a zombie: signal 0 still succeeds, but it is dead.
function isAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
  } catch {
    return true;
  }
}

test('quoteCmdArg leaves plain arguments alone and quotes the rest', () => {
  assert.equal(quoteCmdArg('--no-daemon'), '--no-daemon');
  assert.equal(quoteCmdArg('-'), '-');
  assert.equal(quoteCmdArg(''), '""');
  assert.equal(quoteCmdArg('C:\\My Projects\\app'), '"C:\\My Projects\\app"');
  assert.equal(quoteCmdArg('a&calc'), '"a&calc"');
  assert.equal(quoteCmdArg('model=gpt-6-luna'), '"model=gpt-6-luna"');
  assert.equal(quoteCmdArg('C:\\dir with space\\'), '"C:\\dir with space\\\\"');
});

test('quoteCmdArg refuses characters cmd.exe expands or splits on even inside quotes', () => {
  for (const bad of ['a"b', '%PATH%', 'wow!', 'two\nlines']) {
    assert.throws(() => quoteCmdArg(bad), /Refusing to pass/);
  }
});

test('executeProcess captures output and the exit code', async () => {
  const res = await executeProcess(process.execPath, ['-e', 'console.log("hi"); console.error("warn"); process.exit(3)']);
  assert.equal(res.stdout, 'hi');
  assert.equal(res.stderr, 'warn');
  assert.equal(res.exitCode, 3);
  assert.equal(res.ok, false);
});

test('executeProcess writes input to stdin', async () => {
  const res = await executeProcess(
    process.execPath,
    ['-e', 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(d.toUpperCase()))'],
    { input: 'prompt via stdin' }
  );
  assert.equal(res.ok, true);
  assert.equal(res.stdout, 'PROMPT VIA STDIN');
});

test('executeProcess falls back to the default timeout for NaN instead of running unbounded', async () => {
  const res = await executeProcess(process.execPath, ['-e', 'console.log("done")'], { timeoutMs: Number.NaN });
  assert.equal(res.ok, true);
  assert.equal(res.timedOut, false);
});

test('executeProcess keeps the tail of oversized output and says it was cut', async () => {
  const res = await executeProcess(
    process.execPath,
    ['-e', 'process.stdout.write("x".repeat(5000) + "THE-END")'],
    { maxOutputChars: 1000 }
  );
  assert.match(res.stdout, /^\[output truncated: showing the last 1000 characters\]/);
  assert.ok(res.stdout.endsWith('THE-END'));
  assert.ok(res.stdout.length < 1100);
});

test('executeProcess does not start anything when the signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const res = await executeProcess(process.execPath, ['-e', 'console.log("should not run")'], {
    signal: controller.signal,
  });
  assert.equal(res.cancelled, true);
  assert.equal(res.stdout, '');
});

test('aborting kills the running process promptly', async () => {
  const controller = new AbortController();
  const started = Date.now();
  const pending = executeProcess(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
    signal: controller.signal,
    timeoutMs: 60000,
  });
  setTimeout(() => controller.abort(), 200);
  const res = await pending;
  assert.equal(res.cancelled, true);
  assert.equal(res.ok, false);
  assert.ok(Date.now() - started < 10000, 'cancel should not wait for the child to finish');
});

test('a timeout kills grandchildren and does not hang on pipes they still hold', { skip: isWindows }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmcp-exec-'));
  try {
    const pidFile = join(dir, 'grandchild.pid');
    // The grandchild inherits stdout and outlives its parent: the classic hang.
    const grandchild = script(dir, 'grandchild.js', 'setTimeout(() => {}, 60000);');
    const parent = script(
      dir,
      'parent.js',
      `const { spawn } = require('node:child_process');
       const fs = require('node:fs');
       const g = spawn(process.execPath, [${JSON.stringify(grandchild)}], { stdio: ['ignore', 'inherit', 'inherit'] });
       fs.writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
       setTimeout(() => {}, 60000);`
    );
    const started = Date.now();
    const res = await executeProcess(process.execPath, [parent], { timeoutMs: 500 });
    assert.equal(res.timedOut, true);
    assert.ok(Date.now() - started < 8000, `took ${Date.now() - started}ms`);

    const grandchildPid = Number(readFileSync(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(isAlive(grandchildPid), false, 'grandchild survived the timeout');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('arguments survive a .cmd shim intact and cannot inject commands', { skip: !isWindows }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmcp cmd '));
  try {
    script(dir, 'echo.js', 'console.log(JSON.stringify(process.argv.slice(2)))');
    const shim = script(dir, 'fake.cmd', '@node "%~dp0echo.js" %*\r\n');
    const args = ['-c', 'model=gpt-6-luna', 'C:\\dir with space\\', 'a&echo INJECTED', '(x)'];
    const res = await executeProcess(shim, args);
    assert.equal(res.ok, true, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), args);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
