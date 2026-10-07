import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MESH_KINDS,
  claudeConfigPath,
  claudeMcpArgs,
  claudeMeshServers,
  codexMcpArgs,
  userServersAllowed,
} from '../mcp-scope.js';
import { bridgeKind, listCodexServers } from '../l1.js';
import { stuckMcpServers } from '../agy.js';
import { symlinkSync } from 'node:fs';

const CODEX = `
[mcp_servers.antigravity]
command = "npx"
args = ["-y", "@h0wzy/mcp-server-antigravity", "--host", "codex"]

[mcp_servers.claude]
command = "node"
args = ['C:\\Users\\me\\mcp\\servers\\claude\\bin\\cli.js']

[mcp_servers.team]
command = "npx"
args = ["-y", "@h0wzy/mcp-server-team"]

[mcp_servers.postgres]
command = "npx"
# args = ["-y", "@h0wzy/mcp-server-codex"]   (commented out: not a bridge)
args = ["-y", "@modelcontextprotocol/server-postgres"]

[mcp_servers.postgres.env]
NOTE = "@h0wzy/mcp-server-codex in an env table does not make it a bridge"
`;

const off = (names) => names.flatMap((n) => ['-c', `mcp_servers.${n}.enabled=false`]);

test('the mesh is the three agent bridges, not the team server', () => {
  assert.deepEqual(MESH_KINDS, ['codex', 'antigravity', 'claude']);
});

test('codexMcpArgs keeps the mesh below the maximum depth and switches everything else off', () => {
  assert.deepEqual(codexMcpArgs({ codexConfig: CODEX, env: {} }), off(['team', 'postgres']));
  assert.deepEqual(codexMcpArgs({ codexConfig: CODEX, env: {}, atMaxDepth: true }), off(['antigravity', 'claude', 'team', 'postgres']));
});

test('codexMcpArgs with H0WZY_MCP_USER_SERVERS=1 only switches off bridges the depth rules out', () => {
  const env = { H0WZY_MCP_USER_SERVERS: '1' };
  assert.deepEqual(codexMcpArgs({ codexConfig: CODEX, env }), off(['team']));
  assert.deepEqual(codexMcpArgs({ codexConfig: CODEX, env, atMaxDepth: true }), off(['antigravity', 'claude', 'team']));
  assert.equal(userServersAllowed({ H0WZY_MCP_USER_SERVERS: ' 1 ' }), true);
  assert.equal(userServersAllowed({ H0WZY_MCP_USER_SERVERS: 'yes' }), false);
});

test('codexMcpArgs reads CODEX_HOME and adds nothing without a config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmcp-scope-codex-'));
  try {
    assert.deepEqual(codexMcpArgs({ env: { CODEX_HOME: dir } }), []);
    writeFileSync(join(dir, 'config.toml'), CODEX);
    assert.deepEqual(codexMcpArgs({ env: { CODEX_HOME: dir } }), off(['team', 'postgres']));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const CODEX_ENTRY = { type: 'stdio', command: 'npx', args: ['-y', '@h0wzy/mcp-server-codex', '--host', 'claude'] };
const AGY_ENTRY = { command: 'node', args: ['C:/src/mcp/servers/antigravity/bin/cli.js'] };
const LOCAL_CODEX = { command: 'node', args: ['/work/mcp/servers/codex/bin/cli.js'] };

function claudeConfig(projectPath) {
  return {
    mcpServers: {
      codex: CODEX_ENTRY,
      antigravity: AGY_ENTRY,
      team: { command: 'npx', args: ['-y', '@h0wzy/mcp-server-team'] },
      notes: { command: 'notes-mcp' },
      remote: { type: 'http', url: 'https://example.com/mcp' },
      'bad name': CODEX_ENTRY,
      broken: null,
    },
    projects: {
      [projectPath]: { mcpServers: { codex: LOCAL_CODEX, db: { command: 'db-mcp' } } },
      '/somewhere/else': { mcpServers: { claude: { command: 'npx', args: ['@h0wzy/mcp-server-claude'] } } },
    },
  };
}

test('claudeMeshServers keeps user-scope bridges and lets local scope win for its folder', () => {
  const project = mkdtempSync(join(tmpdir(), 'hmcp-scope-project-'));
  try {
    const config = claudeConfig(project.replace(/\\/g, '/'));
    assert.deepEqual(claudeMeshServers({ claudeConfig: config }), { codex: CODEX_ENTRY, antigravity: AGY_ENTRY });
    assert.deepEqual(claudeMeshServers({ claudeConfig: config, cwd: project }), { codex: LOCAL_CODEX, antigravity: AGY_ENTRY });
    // A trailing separator and (on Windows) letter case don't hide the project.
    const variant = process.platform === 'win32' ? `${project.toUpperCase()}\\` : `${project}/`;
    assert.deepEqual(claudeMeshServers({ claudeConfig: config, cwd: variant }).codex, LOCAL_CODEX);
    assert.deepEqual(claudeMeshServers({ claudeConfig: {} }), {});
    assert.deepEqual(claudeMeshServers({ claudeConfig: null }), {});
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('claudeMeshServers never reads a project .mcp.json', () => {
  const project = mkdtempSync(join(tmpdir(), 'hmcp-scope-mcpjson-'));
  try {
    writeFileSync(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { codex: { command: 'evil', args: ['@h0wzy/mcp-server-codex'] } } }));
    assert.deepEqual(claudeMeshServers({ claudeConfig: {}, cwd: project }), {});
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('claudeConfigPath honours CLAUDE_CONFIG_DIR', () => {
  assert.equal(claudeConfigPath({ CLAUDE_CONFIG_DIR: join('x', 'cfg') }), join('x', 'cfg', '.claude.json'));
  assert.match(claudeConfigPath({}), /\.claude\.json$/);
});

test('claudeMcpArgs: mesh file below the maximum depth, L1 at it, nothing extra on opt-out', () => {
  const config = claudeConfig('/nowhere');
  const below = claudeMcpArgs({ claudeConfig: config, env: {} });
  // The read-only bridge tools are allowed up front: nobody answers a prompt in -p.
  assert.deepEqual(below.args.slice(0, 4), [
    '--allowedTools',
    'mcp__codex__ask_*,mcp__codex__review_*,mcp__codex__brainstorm_*,mcp__codex__plan_*,' +
      'mcp__antigravity__ask_*,mcp__antigravity__review_*,mcp__antigravity__brainstorm_*,mcp__antigravity__plan_*',
    '--strict-mcp-config',
    '--mcp-config',
  ]);
  assert.equal(below.args.length, 5);
  const file = below.args[4];
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { mcpServers: { codex: CODEX_ENTRY, antigravity: AGY_ENTRY } });
  below.cleanup();
  assert.equal(existsSync(file), false);

  assert.deepEqual(claudeMcpArgs({ claudeConfig: config, env: {}, atMaxDepth: true }).args, ['--strict-mcp-config', '--disable-slash-commands']);
  assert.deepEqual(claudeMcpArgs({ claudeConfig: config, env: { H0WZY_MCP_USER_SERVERS: '1' } }).args, []);
  // The depth rule wins over the opt-out.
  assert.deepEqual(claudeMcpArgs({ claudeConfig: config, env: { H0WZY_MCP_USER_SERVERS: '1' }, atMaxDepth: true }).args, [
    '--strict-mcp-config',
    '--disable-slash-commands',
  ]);
  assert.deepEqual(claudeMcpArgs({ claudeConfig: {}, env: {} }).args, ['--strict-mcp-config']);
});

test('claudeMcpArgs reads the user config from CLAUDE_CONFIG_DIR', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmcp-scope-claude-'));
  try {
    assert.deepEqual(claudeMcpArgs({ env: { CLAUDE_CONFIG_DIR: dir } }).args, ['--strict-mcp-config']);
    writeFileSync(join(dir, '.claude.json'), '{ not json');
    assert.deepEqual(claudeMcpArgs({ env: { CLAUDE_CONFIG_DIR: dir } }).args, ['--strict-mcp-config']);
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { codex: CODEX_ENTRY } }));
    const res = claudeMcpArgs({ env: { CLAUDE_CONFIG_DIR: dir } });
    assert.equal(res.args.at(-2), '--mcp-config');
    res.cleanup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bridgeKind: Windows backslash installs count, longer package names do not', () => {
  assert.equal(bridgeKind('node C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@h0wzy\\mcp-server-codex\\bin\\cli.js'), 'codex');
  assert.equal(bridgeKind('npx -y @h0wzy/mcp-server-claude@1.0.6'), 'claude');
  assert.equal(bridgeKind('npx -y @h0wzy/mcp-server-claude-extras'), null);
});

test('listCodexServers reads quoted table names and inline tables under [mcp_servers]', () => {
  const text = [
    '[mcp_servers."quoted"]',
    'command = "npx"',
    "[mcp_servers.'lit']",
    'args = ["@h0wzy/mcp-server-codex"]',
    '[mcp_servers]',
    'gh = { command = "npx", args = ["gh-mcp"] }',
    '"my.server" = { command = "x" }',
    'cx = { command = "npx", args = ["@h0wzy/mcp-server-codex"] }',
    '[other]',
    'nope = { command = "x" }',
  ].join('\r\n');
  assert.deepEqual(listCodexServers(text), [
    { name: 'quoted', kind: null },
    { name: 'lit', kind: 'codex' },
    { name: 'gh', kind: null },
    { name: 'my.server', kind: null },
    { name: 'cx', kind: 'codex' },
  ]);
  // A name with a dot can't be addressed by `-c`; every other non-mesh server goes off.
  assert.deepEqual(codexMcpArgs({ codexConfig: text, env: {} }), off(['quoted', 'gh']));
});

test('claudeMeshServers: local scope shadows a user bridge, disabled servers stay off, symlinked cwd matches', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, () => {
  const project = mkdtempSync(join(tmpdir(), 'hmcp-scope-real-'));
  const link = `${project}-link`;
  try {
    symlinkSync(project, link);
    const user = { codex: CODEX_ENTRY, antigravity: AGY_ENTRY };
    // The child runs in the resolved folder, which is the key Claude Code writes.
    const config = (local) => ({ mcpServers: user, projects: { [project]: local } });
    assert.deepEqual(claudeMeshServers({ claudeConfig: config({ mcpServers: { codex: { command: 'my-own-codex' } } }), cwd: link }), { antigravity: AGY_ENTRY });
    assert.deepEqual(claudeMeshServers({ claudeConfig: config({ disabledMcpServers: ['antigravity'] }), cwd: link }), { codex: CODEX_ENTRY });
  } finally {
    rmSync(link, { force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('stuckMcpServers keeps only server-name tokens from the agy log', () => {
  const log = 'MCP: 2 server(s) still connecting after 30s: google-flow-remote, a@b.com /etc/passwd\n';
  assert.deepEqual(stuckMcpServers(log), ['google-flow-remote']);
});
