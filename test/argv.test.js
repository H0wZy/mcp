// Asserts the exact command lines the servers hand to the agent CLIs, using fake
// binaries. This is what actually reaches `codex` and `agy`, so it is the contract
// that matters most for model / effort control and sandboxing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeAgent } from './helpers/fake-agent.js';

const codexFake = createFakeAgent('codex');
const agyFake = createFakeAgent('agy');
process.env.CODEX_CLI_PATH = codexFake.bin;
process.env.AGY_BIN = agyFake.bin;
delete process.env.CODEX_MODEL;
delete process.env.CODEX_EFFORT;
delete process.env.AGY_MODEL;
delete process.env.AGY_EFFORT;

const { createServer: createCodexServer } = await import('../servers/codex/src/index.js');
const { createServer: createAntigravityServer } = await import('../servers/antigravity/src/index.js');

const work = mkdtempSync(join(tmpdir(), 'hmcp-argv-'));
// tmpdir can be a symlink (macOS) or an 8.3 short path (Windows); compare real paths.
const samePath = (a, b) => realpathSync.native(a) === realpathSync.native(b);

test.after(() => {
  codexFake.cleanup();
  agyFake.cleanup();
  rmSync(work, { recursive: true, force: true });
});

async function callTool(server, name, args) {
  let reply;
  const originalWrite = process.stdout.write;
  // Only swallow the server's JSON-RPC line; the test runner writes here too.
  process.stdout.write = (chunk, ...rest) => {
    const text = chunk.toString();
    if (!text.startsWith('{"jsonrpc"')) return originalWrite.call(process.stdout, chunk, ...rest);
    reply = JSON.parse(text.trim());
    return true;
  };
  try {
    await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  } finally {
    process.stdout.write = originalWrite;
  }
  return reply.result;
}

function lastCall(fake) {
  const calls = fake.calls().filter((c) => !c.argv.includes('debug') && c.argv[0] !== 'models');
  return calls[calls.length - 1];
}

function withLog(fake, fn) {
  process.env.FAKE_AGENT_LOG = fake.log;
  return fn().finally(() => delete process.env.FAKE_AGENT_LOG);
}

const codex = createCodexServer();
const agy = createAntigravityServer();

test('ask_codex runs read-only, never asks for approval, and sends the prompt on stdin', async () => {
  const result = await withLog(codexFake, () => callTool(codex, 'ask_codex', { prompt: 'what is 2+2?' }));
  assert.equal(result.isError, false, result.content[0].text);
  const { argv, input } = lastCall(codexFake);
  assert.deepEqual(argv, [
    '--no-daemon', 'exec',
    '-c', 'model=gpt-6-astra',
    '-c', 'model_reasoning_effort=medium',
    '-c', 'sandbox_mode=read-only',
    '-c', 'approval_policy=never',
    '-',
    '--color', 'never',
    '--ephemeral', '--skip-git-repo-check',
  ]);
  assert.equal(input, 'what is 2+2?');
  assert.match(result.content[0].text, /\[codex · model=gpt-6-astra · effort=medium · source=startup\]/);
});

test('review_codex applies the same read-only overrides to the review subcommand', async () => {
  await withLog(codexFake, () => callTool(codex, 'review_codex', { prompt: 'focus on security' }));
  const { argv } = lastCall(codexFake);
  assert.deepEqual(argv, [
    '--no-daemon', 'review',
    '-c', 'model=gpt-6-astra',
    '-c', 'model_reasoning_effort=medium',
    '-c', 'sandbox_mode=read-only',
    '-c', 'approval_policy=never',
    '-',
  ]);
});

test('codex context paths go into the prompt, never into --add-dir (which grants writes)', async () => {
  await withLog(codexFake, () => callTool(codex, 'ask_codex', { prompt: 'read it', paths: [work] }));
  let call = lastCall(codexFake);
  assert.equal(call.argv.includes('--add-dir'), false, call.argv.join(' '));
  assert.ok(call.input.includes(`- ${work}`), call.input);

  await withLog(codexFake, () => callTool(codex, 'delegate_codex', { prompt: 'do it', cwd: work, paths: [tmpdir()] }));
  call = lastCall(codexFake);
  assert.equal(call.argv.includes('--add-dir'), false, call.argv.join(' '));
});

test('per-call model and effort overrides reach codex without changing the session', async () => {
  await withLog(codexFake, () => callTool(codex, 'plan_codex', { prompt: 'plan it', model: 'gpt-6-luna', effort: 'high' }));
  const { argv } = lastCall(codexFake);
  assert.ok(argv.includes('model=gpt-6-luna'), argv.join(' '));
  assert.ok(argv.includes('model_reasoning_effort=high'), argv.join(' '));

  await withLog(codexFake, () => callTool(codex, 'ask_codex', { prompt: 'again' }));
  assert.ok(lastCall(codexFake).argv.includes('model=gpt-6-astra'), 'session default changed by a per-call override');
});

test('delegate_codex writes inside cwd only and keeps automatic approvals', async () => {
  const result = await withLog(codexFake, () => callTool(codex, 'delegate_codex', { prompt: 'implement it', cwd: work }));
  assert.equal(result.isError, false, result.content[0].text);
  const { argv, cwd } = lastCall(codexFake);
  assert.ok(argv.includes('sandbox_mode=workspace-write'), argv.join(' '));
  assert.equal(argv.includes('approval_policy=never'), false);
  assert.ok(argv.includes('--approve-for-me'));
  assert.deepEqual(argv.slice(argv.indexOf('-C'), argv.indexOf('-C') + 2), ['-C', work]);
  assert.ok(samePath(cwd, work), `${cwd} vs ${work}`);
});

test('ask_antigravity passes the catalog variant id and does not auto-approve anything', async () => {
  const result = await withLog(agyFake, () => callTool(agy, 'ask_antigravity', { prompt: 'say hi' }));
  assert.equal(result.isError, false, result.content[0].text);
  const { argv } = lastCall(agyFake);
  assert.deepEqual(argv, [
    '-p', 'say hi',
    '--model', 'gemini-3.8-flash-high',
    '--print-timeout', '5m',
  ]);
});

test('read-only antigravity tools add context folders for reading and surface soft-denied actions', async () => {
  process.env.FAKE_AGENT_STDERR = 'Skipped write_file: not allowed. Add write_file(src/) to permissions.allow';
  let result;
  try {
    result = await withLog(agyFake, () => callTool(agy, 'review_antigravity', { prompt: 'review', paths: [work] }));
  } finally {
    delete process.env.FAKE_AGENT_STDERR;
  }
  assert.equal(result.isError, false, result.content[0].text);
  const { argv } = lastCall(agyFake);
  assert.equal(argv.includes('--dangerously-skip-permissions'), false, argv.join(' '));
  assert.deepEqual(argv.slice(argv.indexOf('--add-dir'), argv.indexOf('--add-dir') + 2), ['--add-dir', work]);
  assert.match(result.content[0].text, /fake agent answer\n\n⚠️ Antigravity notices \(stderr\):\nSkipped write_file/);
  assert.match(result.content[0].text, /\[antigravity · model=/);
});

test('only edit-capable tools are annotated as writing', async () => {
  for (const server of [codex, agy]) {
    let reply;
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk, ...rest) => {
      const text = chunk.toString();
      if (!text.startsWith('{"jsonrpc"')) return originalWrite.call(process.stdout, chunk, ...rest);
      reply = JSON.parse(text.trim());
      return true;
    };
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    } finally {
      process.stdout.write = originalWrite;
    }
    for (const tool of reply.result.tools) {
      const readOnly = /^(ask|review|brainstorm|plan)_/.test(tool.name);
      if (readOnly) assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
      if (tool.name.startsWith('delegate_')) assert.equal(tool.annotations?.destructiveHint, true, tool.name);
    }
  }
});

test('delegate_antigravity sends --effort for models without a variant and scopes to cwd', async () => {
  await withLog(agyFake, () =>
    callTool(agy, 'delegate_antigravity', { prompt: 'do it', cwd: work, model: 'custom-model', effort: 'xhigh', timeout_minutes: 'abc' })
  );
  const { argv, cwd } = lastCall(agyFake);
  assert.deepEqual(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2), ['--model', 'custom-model']);
  assert.deepEqual(argv.slice(argv.indexOf('--effort'), argv.indexOf('--effort') + 2), ['--effort', 'xhigh']);
  assert.deepEqual(argv.slice(argv.indexOf('--print-timeout'), argv.indexOf('--print-timeout') + 2), ['--print-timeout', '30m']);
  assert.ok(argv.includes('--dangerously-skip-permissions'), argv.join(' '));
  assert.deepEqual(argv.slice(argv.indexOf('--add-dir'), argv.indexOf('--add-dir') + 2), ['--add-dir', work]);
  assert.ok(samePath(cwd, work), `${cwd} vs ${work}`);
});

test('an invalid per-call model returns an actionable error instead of a generic execution error', async () => {
  const result = await callTool(codex, 'ask_codex', { prompt: 'x', model: 'bad model!' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /invalid characters/);
  assert.match(result.content[0].text, /configure_codex with action "list"/);
  assert.doesNotMatch(result.content[0].text, /Execution Error/);
});

test('configure_* rejects invalid values with a clear message and leaves the session unchanged', async () => {
  const result = await callTool(codex, 'configure_codex', { action: 'set', effort: 'insane' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Invalid reasoning effort 'insane'/);
  assert.match(result.content[0].text, /Nothing was changed/);
  const state = await callTool(codex, 'configure_codex', { action: 'get' });
  assert.match(state.content[0].text, /Effort: medium/);
});
