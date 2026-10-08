// Import first in any test that calls bridge tools. It keeps the loop guard hermetic:
// no chain inherited from an agent that happens to run the tests (a delegated Codex
// running `npm test` carries H0WZY_MCP_* vars), and no writes to the real ~/.h0wzy-mcp.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeAgent } from './fake-agent.js';

for (const key of Object.keys(process.env)) {
  if (key.startsWith('H0WZY_MCP_')) delete process.env[key];
}
process.env.H0WZY_MCP_STATE_DIR = mkdtempSync(join(tmpdir(), 'hmcp-state-'));
// Bridges read the Codex and Claude Code configs to pick the MCP servers a nested agent
// loads (spec 006 FR-026); tests start from empty ones, never the developer's own.
process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'hmcp-codex-home-'));
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'hmcp-claude-config-'));

// Nothing reaches a real agent CLI either: `configure_*` lists models through `codex` /
// `agy`, and agy has no config-dir variable, so a real run would read ~/.gemini. Tests
// that need a recording fake set these variables to their own.
for (const [variable, name] of [['CODEX_CLI_PATH', 'codex'], ['AGY_BIN', 'agy'], ['CLAUDE_CLI_PATH', 'claude']]) {
  if (!process.env[variable]) process.env[variable] = createFakeAgent(name).bin;
}

export const stateDir = process.env.H0WZY_MCP_STATE_DIR;
export const codexHome = process.env.CODEX_HOME;
export const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
