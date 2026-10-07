// Asserts the exact command lines the servers hand to the agent CLIs, using fake
// binaries. This is what actually reaches `codex` and `agy`, so it is the contract
// that matters most for model / effort control and sandboxing.
import { codexHome, claudeConfigDir } from './helpers/guard-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeAgent } from './helpers/fake-agent.js';

const codexFake = createFakeAgent('codex');
const agyFake = createFakeAgent('agy');
const claudeFake = createFakeAgent('claude');
process.env.CODEX_CLI_PATH = codexFake.bin;
process.env.AGY_BIN = agyFake.bin;
process.env.CLAUDE_CLI_PATH = claudeFake.bin;
for (const key of Object.keys(process.env)) {
  if (key.startsWith('CLAUDE_BRIDGE_')) delete process.env[key];
}
delete process.env.CODEX_MODEL;
delete process.env.CODEX_EFFORT;
delete process.env.AGY_MODEL;
delete process.env.AGY_EFFORT;

const { createServer: createCodexServer } = await import('../servers/codex/src/index.js');
const { createServer: createAntigravityServer } = await import('../servers/antigravity/src/index.js');
const { createServer: createClaudeServer } = await import('../servers/claude/src/index.js');

const work = mkdtempSync(join(tmpdir(), 'hmcp-argv-'));
// tmpdir can be a symlink (macOS) or an 8.3 short path (Windows); compare real paths.
const samePath = (a, b) => realpathSync.native(a) === realpathSync.native(b);

test.after(() => {
  codexFake.cleanup();
  agyFake.cleanup();
  claudeFake.cleanup();
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
const claude = createClaudeServer();

// Sets env vars for the duration of fn, then restores them.
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

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
  // L3 chain notice first, then the prompt (spec 006).
  assert.match(input, /^\[H0wZy\/mcp chain\] You are codex, called by host \(chain host → codex, depth 1 of 2, bridge call 1 of 8\)/);
  assert.ok(input.endsWith('\n\nwhat is 2+2?'), input);
  assert.match(result.content[0].text, /\n\[chain host→codex · depth 1\/2 · calls 1\/8 · run [0-9a-f]{8}\]$/);
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
  assert.equal(argv.length, 8, argv.join(' '));
  assert.equal(argv[0], '-p');
  assert.match(argv[1], /^\[H0wZy\/mcp chain\] You are antigravity/);
  assert.match(argv[1], /\n\nRead-only request: do not create, edit or delete files/);
  assert.ok(argv[1].endsWith('\n\nsay hi'), argv[1]);
  assert.deepEqual(argv.slice(2, 6), ['--model', 'gemini-3.8-flash-high', '--print-timeout', '5m']);
  // A private log, removed after the call, explains a run that never started.
  assert.equal(argv[6], '--log-file');
  assert.match(argv[7], /h0wzy-agy-[^\\/]+[\\/]agy\.log$/);
  assert.equal(existsSync(argv[7]), false, 'the agy log is removed after the call');
});

test('an agy run stopped by its own --print-timeout is an error that names the MCP servers it waited for', async () => {
  const result = await withEnv(
    {
      FAKE_AGENT_STDOUT: ' ',
      FAKE_AGENT_STDERR: '[agy] print timeout after 5m0s with turn in progress; returning partial output',
      FAKE_AGENT_LOG_TEXT: [
        'I1007 17:29:02.794594 15 mcp_manager.go:875] MCP: 2 server(s) still connecting after 30s: google-flow-remote, slowpoke',
        'I1007 17:29:32.794594 15 mcp_manager.go:875] MCP: 1 server(s) still connecting after 1m0s: google-flow-remote',
      ].join('\n'),
    },
    () => withLog(agyFake, () => callTool(agy, 'ask_antigravity', { prompt: 'say hi' }))
  );
  assert.equal(result.isError, true, result.content[0].text);
  const text = result.content[0].text;
  assert.match(text, /^⏱️ Antigravity did not finish within 5 min and returned no answer\.\n/);
  // The last "still connecting" line is the current state.
  assert.match(text, /still waiting for MCP server\(s\) to connect: google-flow-remote\. /);
  assert.match(text, /`agy mcp remove google-flow-remote`/);
  assert.match(text, /\[antigravity · model=/);

  // A partial answer is kept and labeled.
  const partial = await withEnv(
    { FAKE_AGENT_STDOUT: 'half an answer', FAKE_AGENT_STDERR: '[agy] print timeout after 5m0s with turn in progress; returning partial output' },
    () => withLog(agyFake, () => callTool(agy, 'ask_antigravity', { prompt: 'say hi' }))
  );
  assert.equal(partial.isError, true);
  assert.match(partial.content[0].text, /^half an answer\n\n⏱️ Antigravity did not finish within 5 min; the answer above is partial\.\n\n\[antigravity/);
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
  assert.doesNotMatch(argv[1], /Read-only request/);
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


// ---------------------------------------------------------------------------
// Claude Code bridge (spec 006, contracts/claude-bridge.md)
// ---------------------------------------------------------------------------

test('ask_claude runs read-only with only Read/Grep/Glob, no session, prompt on stdin', async () => {
  const result = await withLog(claudeFake, () => callTool(claude, 'ask_claude', { prompt: 'explain the guard' }));
  assert.equal(result.isError, false, result.content[0].text);
  const { argv, input } = lastCall(claudeFake);
  assert.deepEqual(argv, [
    '-p', '--output-format', 'json',
    '--model', 'opus',
    '--effort', 'medium',
    '--permission-prompts', 'none',
    '--tools', 'Read,Grep,Glob',
    '--no-session-persistence',
    // FR-026: none of the user's MCP servers (no mesh bridge is registered here).
    '--strict-mcp-config',
  ]);
  assert.match(input, /^\[H0wZy\/mcp chain\] You are claude, called by host/);
  assert.ok(input.endsWith('\n\nexplain the guard'), input);
  // Non-JSON output is returned as text.
  assert.match(result.content[0].text, /^fake agent answer\n\n\[claude · model=opus · effort=medium · source=startup\]\n\[chain host→claude · depth 1\/2/);
});

test('ask_claude reads the JSON result and reports cost and turns', async () => {
  const stdout = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'the answer', total_cost_usd: 0.0123, num_turns: 2, session_id: 'x' });
  const result = await withEnv({ FAKE_AGENT_STDOUT: stdout }, () => withLog(claudeFake, () => callTool(claude, 'review_claude', { prompt: 'look', paths: [work] })));
  assert.equal(result.isError, false, result.content[0].text);
  assert.match(result.content[0].text, /^the answer\n\n\[claude · model=opus · effort=medium · source=startup · cost=\$0\.0123 · turns=2\]/);
  const { argv, input } = lastCall(claudeFake);
  // The context folder is readable; the prompt lists it and carries the review prefix.
  assert.deepEqual(argv.slice(argv.indexOf('--add-dir'), argv.indexOf('--add-dir') + 2), ['--add-dir', work]);
  assert.match(input, /Context files\/folders to read and consider in full:\n- /);
  assert.match(input, /You are performing a comprehensive code review/);
});

test('claude caps come from the environment and a reached cap is reported', async () => {
  const stdout = JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: '', num_turns: 3 });
  const result = await withEnv({ FAKE_AGENT_STDOUT: stdout, CLAUDE_BRIDGE_MAX_TURNS: '3', CLAUDE_BRIDGE_MAX_BUDGET_USD: '0.5' }, () =>
    withLog(claudeFake, () => callTool(claude, 'ask_claude', { prompt: 'think hard' }))
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^Stopped: the turn cap set by CLAUDE_BRIDGE_MAX_TURNS was reached\./);
  const { argv } = lastCall(claudeFake);
  assert.deepEqual(argv.slice(argv.indexOf('--max-turns'), argv.indexOf('--max-turns') + 2), ['--max-turns', '3']);
  assert.deepEqual(argv.slice(argv.indexOf('--max-budget-usd'), argv.indexOf('--max-budget-usd') + 2), ['--max-budget-usd', '0.5']);
});

test('delegate_claude edits inside cwd with acceptEdits and denied prompts', async () => {
  const extra = mkdtempSync(join(tmpdir(), 'hmcp-extra-'));
  try {
    const result = await withLog(claudeFake, () => callTool(claude, 'delegate_claude', { prompt: 'refactor', cwd: work, paths: [extra], timeout_minutes: 5 }));
    assert.equal(result.isError, false, result.content[0].text);
    const { argv, cwd } = lastCall(claudeFake);
    assert.deepEqual(argv, [
      '-p', '--output-format', 'json',
      '--model', 'opus',
      '--effort', 'medium',
      '--permission-prompts', 'none',
      '--permission-mode', 'acceptEdits',
      '--add-dir', extra,
      '--strict-mcp-config',
    ]);
    assert.ok(samePath(cwd, work), `${cwd} vs ${work}`);

    await withEnv({ CLAUDE_BRIDGE_DELEGATE_PERMISSION_MODE: 'auto' }, () => withLog(claudeFake, () => callTool(claude, 'delegate_claude', { prompt: 'x', cwd: work })));
    assert.ok(lastCall(claudeFake).argv.join(' ').includes('--permission-mode auto'));

    const bad = await withEnv({ CLAUDE_BRIDGE_DELEGATE_PERMISSION_MODE: 'bypassPermissions' }, () =>
      withLog(claudeFake, () => callTool(claude, 'delegate_claude', { prompt: 'x', cwd: work }))
    );
    assert.ok(lastCall(claudeFake).argv.join(' ').includes('--permission-mode acceptEdits'));
    assert.match(bad.content[0].text, /CLAUDE_BRIDGE_DELEGATE_PERMISSION_MODE='bypassPermissions' is not one of acceptEdits, auto, dontAsk/);
  } finally {
    rmSync(extra, { recursive: true, force: true });
  }
});

test('haiku gets no --effort flag and the footer says effort=n/a', async () => {
  const result = await withLog(claudeFake, () => callTool(claude, 'ask_claude', { prompt: 'quick', model: 'haiku', effort: 'high' }));
  const { argv } = lastCall(claudeFake);
  assert.equal(argv.includes('--effort'), false, argv.join(' '));
  assert.deepEqual(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2), ['--model', 'haiku']);
  assert.match(result.content[0].text, /\[claude · model=haiku · effort=n\/a · source=override\]/);
});

test('at the maximum depth every target starts without bridge tools (L1)', async () => {
  // This process plays an agent at depth 1 of chain tester>codex: the next hop is the last.
  const chainEnv = {
    H0WZY_MCP_RUN_ID: 'abcdef12',
    H0WZY_MCP_CHAIN: 'tester>codex',
    H0WZY_MCP_DEPTH: '1',
    H0WZY_MCP_DEADLINE: String(Date.now() + 600000),
  };
  await withEnv(chainEnv, async () => {
    await withLog(claudeFake, () => callTool(claude, 'ask_claude', { prompt: 'deep' }));
    const claudeArgv = lastCall(claudeFake).argv;
    assert.deepEqual(claudeArgv.slice(-2), ['--strict-mcp-config', '--disable-slash-commands']);
    assert.match(lastCall(claudeFake).input, /maximum depth/);

    await withLog(agyFake, () => callTool(agy, 'ask_antigravity', { prompt: 'deep' }));
    assert.ok(lastCall(agyFake).argv.includes('--disable-slash-commands'));

    // codex itself is in this chain: calling it again is a cycle, refused before spawning.
    const before = codexFake.calls().length;
    const refused = await withLog(codexFake, () => callTool(codex, 'ask_codex', { prompt: 'again' }));
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /Loop guard: cycle/);
    assert.equal(codexFake.calls().length, before, 'a refused call must not start the agent');
  });
});

// ---------------------------------------------------------------------------
// FR-026: the MCP servers a nested agent loads
// ---------------------------------------------------------------------------

const CODEX_CONFIG = `model = "gpt-6-astra"

[mcp_servers.antigravity]
command = "npx"
args = ["-y", "@h0wzy/mcp-server-antigravity", "--host", "codex"]

[mcp_servers.claude]
command = "node"
args = ["C:/Users/me/mcp/servers/claude/bin/cli.js", "--host", "codex"]

[mcp_servers.team]
command = "npx"
args = ["-y", "@h0wzy/mcp-server-team", "--host", "codex"]

[mcp_servers.blender]
command = "uvx"
args = ["mcp-for-blender"]

[mcp_servers.blender.env]
BLENDER_PORT = "9877"
`;

const USER_CODEX = { type: 'stdio', command: 'node', args: ['C:/repo/servers/codex/bin/cli.js', '--host', 'claude'] };
const LOCAL_CODEX = { type: 'stdio', command: 'node', args: ['D:/other/servers/codex/bin/cli.js'] };
const USER_AGY = { type: 'stdio', command: 'npx', args: ['-y', '@h0wzy/mcp-server-antigravity'], env: { AGY_MODEL: 'gemini-3.8-flash' } };

async function withAgentConfigs(fn) {
  const codexToml = join(codexHome, 'config.toml');
  const claudeJson = join(claudeConfigDir, '.claude.json');
  writeFileSync(codexToml, CODEX_CONFIG);
  writeFileSync(
    claudeJson,
    JSON.stringify({
      mcpServers: {
        codex: USER_CODEX,
        antigravity: USER_AGY,
        team: { type: 'stdio', command: 'npx', args: ['-y', '@h0wzy/mcp-server-team'] },
        blender: { type: 'stdio', command: 'uvx', args: ['mcp-for-blender'] },
        remote: { type: 'http', url: 'https://example.com/mcp' },
      },
      projects: {
        [work.replace(/\\/g, '/')]: { mcpServers: { codex: LOCAL_CODEX, postgres: { command: 'npx', args: ['pg'] } } },
      },
    })
  );
  try {
    return await fn();
  } finally {
    rmSync(codexToml, { force: true });
    rmSync(claudeJson, { force: true });
  }
}

const offFlags = (argv) => argv.filter((a) => /^mcp_servers\..+\.enabled=false$/.test(a));

test('a nested Codex starts the mesh bridges but none of the user\'s other MCP servers', async () => {
  await withAgentConfigs(async () => {
    await withLog(codexFake, () => callTool(codex, 'ask_codex', { prompt: 'x' }));
    assert.deepEqual(offFlags(lastCall(codexFake).argv), ['mcp_servers.team.enabled=false', 'mcp_servers.blender.enabled=false']);

    await withLog(codexFake, () => callTool(codex, 'delegate_codex', { prompt: 'x', cwd: work }));
    assert.deepEqual(offFlags(lastCall(codexFake).argv), ['mcp_servers.team.enabled=false', 'mcp_servers.blender.enabled=false']);
  });
});

test('a nested Claude Code gets only the mesh bridges through a temporary --mcp-config', async () => {
  await withAgentConfigs(async () => {
    await withLog(claudeFake, () => callTool(claude, 'ask_claude', { prompt: 'x' }));
    let call = lastCall(claudeFake);
    const at = call.argv.indexOf('--mcp-config');
    assert.deepEqual(call.argv.slice(at - 1, at + 1), ['--strict-mcp-config', '--mcp-config']);
    assert.deepEqual(call.mcpConfig, { mcpServers: { codex: USER_CODEX, antigravity: USER_AGY } });
    assert.equal(existsSync(call.argv[at + 1]), false, 'the --mcp-config file is removed after the call');

    // Local scope (the project's entry in ~/.claude.json) wins for its own folder.
    await withLog(claudeFake, () => callTool(claude, 'delegate_claude', { prompt: 'x', cwd: work }));
    call = lastCall(claudeFake);
    assert.deepEqual(call.mcpConfig, { mcpServers: { codex: LOCAL_CODEX, antigravity: USER_AGY } });
  });
});

test('H0WZY_MCP_USER_SERVERS=1 lets nested agents load the user\'s own MCP servers', async () => {
  await withAgentConfigs(() =>
    withEnv({ H0WZY_MCP_USER_SERVERS: '1' }, async () => {
      await withLog(codexFake, () => callTool(codex, 'ask_codex', { prompt: 'x' }));
      assert.deepEqual(offFlags(lastCall(codexFake).argv), ['mcp_servers.team.enabled=false']);

      await withLog(claudeFake, () => callTool(claude, 'ask_claude', { prompt: 'x' }));
      const { argv } = lastCall(claudeFake);
      assert.equal(argv.includes('--strict-mcp-config'), false, argv.join(' '));
      assert.equal(argv.includes('--mcp-config'), false, argv.join(' '));
    })
  );
});

test('at the maximum depth a nested Codex starts with every MCP server off, bridges included', async () => {
  const chainEnv = {
    H0WZY_MCP_RUN_ID: 'abcdef13',
    H0WZY_MCP_CHAIN: 'tester>claude',
    H0WZY_MCP_DEPTH: '1',
    H0WZY_MCP_DEADLINE: String(Date.now() + 600000),
  };
  await withAgentConfigs(() =>
    withEnv(chainEnv, async () => {
      await withLog(codexFake, () => callTool(codex, 'ask_codex', { prompt: 'deep' }));
      assert.deepEqual(offFlags(lastCall(codexFake).argv), [
        'mcp_servers.antigravity.enabled=false',
        'mcp_servers.claude.enabled=false',
        'mcp_servers.team.enabled=false',
        'mcp_servers.blender.enabled=false',
      ]);
    })
  );
});
