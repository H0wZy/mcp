// H0wZy/mcp — Which MCP servers an agent started by a bridge loads (spec 006, FR-026).
// A nested agent needs the H0wZy/mcp mesh, not every server its user configured.
// Measured on a real setup (research §7): loading them all cost ~380k tokens on each
// `claude -p` call (claude.ai connectors) and doubled Codex start-up time. Developers
// who want their own servers in nested agents set H0WZY_MCP_USER_SERVERS=1.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bridgeKind, listCodexServers, noBridgeArgs, readCodexConfig } from './l1.js';

/** Bridges a nested agent keeps below the maximum depth. Nested teams are refused anyway. */
export const MESH_KINDS = ['codex', 'antigravity', 'claude'];

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
const noop = () => {};

/**
 * True when the developer lets nested agents load their own MCP servers.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 */
export function userServersAllowed(env = process.env) {
  return String(env.H0WZY_MCP_USER_SERVERS ?? '').trim() === '1';
}

/**
 * `-c` overrides that switch off the Codex MCP servers a nested Codex must not start.
 * Below the maximum depth the mesh bridges stay, and so do the user's own servers when
 * H0WZY_MCP_USER_SERVERS=1. At the maximum depth every bridge goes (L1, FR-010).
 *
 * @param {{ atMaxDepth?: boolean, env?: NodeJS.ProcessEnv, codexConfig?: string }} [options]
 * @returns {string[]}
 */
export function codexMcpArgs({ atMaxDepth = false, env = process.env, codexConfig } = {}) {
  const text = codexConfig ?? readCodexConfig(env);
  if (text === undefined) return [];
  const keepUser = userServersAllowed(env);
  // Only tables that exist: a new mcp_servers table without a command could make
  // Codex reject its config.
  return listCodexServers(text)
    .filter(({ kind }) => (kind ? atMaxDepth || !MESH_KINDS.includes(kind) : !keepUser))
    .flatMap(({ name }) => ['-c', `mcp_servers.${name}.enabled=false`]);
}

/**
 * Claude Code's user config file (`~/.claude.json`, or inside CLAUDE_CONFIG_DIR).
 * @param {NodeJS.ProcessEnv} [env=process.env]
 */
export function claudeConfigPath(env = process.env) {
  const dir = String(env.CLAUDE_CONFIG_DIR ?? '').trim();
  return join(dir || homedir(), '.claude.json');
}

function projectKey(path) {
  const key = resolve(path).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? key.toLowerCase() : key;
}

/**
 * The mesh bridges the user registered in Claude Code: user scope, plus local scope for
 * `cwd`. A project's .mcp.json is never read: Claude Code asks before it starts a
 * project server, and --mcp-config would skip that approval for whatever a cloned
 * repository chose to call "codex".
 *
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, claudeConfig?: object }} [options]
 * @returns {Record<string, object>} server name → entry, ready for --mcp-config
 */
export function claudeMeshServers({ cwd, env = process.env, claudeConfig } = {}) {
  let data = claudeConfig;
  if (data === undefined) {
    try {
      data = JSON.parse(readFileSync(claudeConfigPath(env), 'utf8'));
    } catch {
      return {};
    }
  }
  const servers = {};
  const add = (entries) => {
    if (!entries || typeof entries !== 'object') return;
    for (const [name, entry] of Object.entries(entries)) {
      if (!SERVER_NAME.test(name) || !entry || typeof entry !== 'object') continue;
      const commandLine = [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])].join(' ');
      if (MESH_KINDS.includes(bridgeKind(commandLine))) servers[name] = entry;
    }
  };
  add(data?.mcpServers);
  // Local scope wins over user scope for the same name, as in Claude Code.
  if (cwd && data?.projects && typeof data.projects === 'object') {
    const wanted = projectKey(cwd);
    for (const [path, project] of Object.entries(data.projects)) {
      if (projectKey(path) === wanted) add(project?.mcpServers);
    }
  }
  return servers;
}

/**
 * MCP flags for a nested `claude -p`, and a cleanup for the temporary --mcp-config file
 * it may write. The file keeps server definitions (and any env they carry) off the
 * command line, where other processes could read them.
 *
 * @param {{ atMaxDepth?: boolean, cwd?: string, env?: NodeJS.ProcessEnv, claudeConfig?: object }} [options]
 * @returns {{ args: string[], cleanup: () => void }}
 */
export function claudeMcpArgs({ atMaxDepth = false, cwd, env = process.env, claudeConfig } = {}) {
  // L1: no MCP server and no skill at the maximum depth (FR-010).
  if (atMaxDepth) return { args: noBridgeArgs('claude'), cleanup: noop };
  if (userServersAllowed(env)) return { args: [], cleanup: noop };
  const servers = claudeMeshServers({ cwd, env, claudeConfig });
  if (!Object.keys(servers).length) return { args: ['--strict-mcp-config'], cleanup: noop };
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'h0wzy-mcp-'));
    const file = join(dir, 'mcp.json');
    writeFileSync(file, JSON.stringify({ mcpServers: servers }), { mode: 0o600 });
    return {
      args: ['--strict-mcp-config', '--mcp-config', file],
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch {
    // No room for the file: run without the mesh rather than fail the call.
    if (dir) rmSync(dir, { recursive: true, force: true });
    return { args: ['--strict-mcp-config'], cleanup: noop };
  }
}
