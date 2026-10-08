import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeProcess, quoteCmdArg, resolveNodeShim } from '../executor.js';

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

test('onSpawn sees the child pid once, before the process finishes', async () => {
  const seen = [];
  const res = await executeProcess(process.execPath, ['-e', 'console.log(process.pid)'], {
    onSpawn: (child) => seen.push(child.pid),
  });
  assert.equal(res.ok, true);
  assert.deepEqual(seen, [Number(res.stdout)]);
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

test('resolveNodeShim finds the script behind npm, pnpm and minimal shims and ignores the rest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmcp-shim-'));
  try {
    script(dir, 'tool.js', '');
    mkdirSync(join(dir, 'node_modules', '@openai', 'codex', 'bin'), { recursive: true });
    script(join(dir, 'node_modules', '@openai', 'codex', 'bin'), 'codex.js', '');
    const npm = script(
      dir,
      'codex.cmd',
      '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n' +
        'IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n' +
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n'
    );
    const found = resolveNodeShim(npm);
    assert.equal(found.command, process.execPath);
    assert.equal(found.args.length, 1);
    assert.match(found.args[0], /codex[\\/]bin[\\/]codex\.js$/);

    const pnpm = script(dir, 'p.cmd', '@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\tool.js" %*\r\n) ELSE (\r\n  node  "%~dp0\\tool.js" %*\r\n)\r\n');
    assert.match(resolveNodeShim(pnpm).args[0], /tool\.js$/);
    assert.match(resolveNodeShim(script(dir, 'm.cmd', '@node "%~dp0tool.js" %*\r\n')).args[0], /tool\.js$/);

    // Not a node shim, or a script that is not there: run through cmd.exe as before.
    assert.equal(resolveNodeShim(script(dir, 'other.cmd', '@set "S=%~dp0tool.js"\r\n@node "%S%" %*\r\n')), null);
    assert.equal(resolveNodeShim(script(dir, 'gone.cmd', '@node "%~dp0missing.js" %*\r\n')), null);
    assert.equal(resolveNodeShim(join(dir, 'nope.cmd')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a node .cmd shim receives line breaks, quotes and % untouched', { skip: !isWindows }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmcp cmd '));
  try {
    script(dir, 'echo.js', 'console.log(JSON.stringify(process.argv.slice(2)))');
    const shim = script(dir, 'fake.cmd', '@node "%~dp0echo.js" %*\r\n');
    const args = ['-p', 'line one\nline "two"', '100% sure!', 'C:\\dir with space\\', 'a&echo INJECTED', '(x)'];
    const res = await executeProcess(shim, args);
    assert.equal(res.ok, true, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), args);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('other .cmd files get quoted arguments that cannot inject commands', { skip: !isWindows }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmcp cmd '));
  try {
    script(dir, 'echo.js', 'console.log(JSON.stringify(process.argv.slice(2)))');
    const wrapper = script(dir, 'wrap.cmd', '@set "S=%~dp0echo.js"\r\n@node "%S%" %*\r\n');
    const args = ['-c', 'model=gpt-6-luna', 'C:\\dir with space\\', 'a&echo INJECTED', '(x)'];
    const res = await executeProcess(wrapper, args);
    assert.equal(res.ok, true, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), args);

    const refused = await executeProcess(wrapper, ['two\nlines']);
    assert.equal(refused.ok, false);
    assert.match(refused.stderr, /Refusing to pass/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
