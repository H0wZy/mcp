// Import first in any test that calls bridge tools. It keeps the loop guard hermetic:
// no chain inherited from an agent that happens to run the tests (a delegated Codex
// running `npm test` carries H0WZY_MCP_* vars), and no writes to the real ~/.h0wzy-mcp.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const key of Object.keys(process.env)) {
  if (key.startsWith('H0WZY_MCP_')) delete process.env[key];
}
process.env.H0WZY_MCP_STATE_DIR = mkdtempSync(join(tmpdir(), 'hmcp-state-'));

export const stateDir = process.env.H0WZY_MCP_STATE_DIR;
