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
  assert.deepEqual(below.args.slice(0, 2), ['--strict-mcp-config', '--mcp-config']);
  const file = below.args[2];
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
    assert.equal(res.args[1], '--mcp-config');
    res.cleanup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
