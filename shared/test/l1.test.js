import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBridgeServers, noBridgeArgs, codexConfigPath } from '../l1.js';

const CONFIG = `
model = "gpt-6-astra"

[mcp_servers.antigravity]
command = "npx"
args = ["-y", "@h0wzy/mcp-server-antigravity", "--host", "codex"]

[mcp_servers.antigravity.env]
AGY_MODEL = "gemini-3.8-flash"

[mcp_servers.claude]
command = "node"
args = ["C:/Users/me/mcp/servers/claude/bin/cli.js", "--host", "codex"]

[mcp_servers.postgres]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-postgres"]

[profiles.fast]
model = "gpt-6-luna"
`;

test('finds the H0wZy/mcp bridge servers in a Codex config and ignores the rest', () => {
  assert.deepEqual(findBridgeServers(CONFIG), ['antigravity', 'claude']);
  assert.deepEqual(findBridgeServers(''), []);
});

test('L1 flags per target', () => {
  assert.deepEqual(noBridgeArgs('claude'), ['--strict-mcp-config', '--disable-slash-commands']);
  assert.deepEqual(noBridgeArgs('antigravity'), ['--disable-slash-commands']);
  assert.deepEqual(noBridgeArgs('codex', { codexConfig: CONFIG }), [
    '-c', 'mcp_servers.antigravity.enabled=false',
    '-c', 'mcp_servers.claude.enabled=false',
  ]);
  assert.deepEqual(noBridgeArgs('somebody-else'), []);
});

test('the Codex config is read from CODEX_HOME, and a missing file means no flags', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmcp-codexhome-'));
  try {
    const env = { CODEX_HOME: dir };
    assert.equal(codexConfigPath(env), join(dir, 'config.toml'));
    assert.deepEqual(noBridgeArgs('codex', { env }), []);
    writeFileSync(join(dir, 'config.toml'), CONFIG);
    assert.equal(noBridgeArgs('codex', { env }).length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
