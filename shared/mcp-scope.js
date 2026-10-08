// H0wZy/mcp — Which MCP servers an agent started by a bridge loads (spec 006, FR-026).
// A nested agent needs the H0wZy/mcp mesh, not every server its user configured.
// Measured on a real setup (research §7): loading them all cost ~380k tokens on each
// `claude -p` call (claude.ai connectors) and doubled Codex start-up time. Developers
// who want their own servers in nested agents set H0WZY_MCP_USER_SERVERS=1.

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { bridgeKind, codexDisableArgs, listCodexServers, noBridgeArgs, readCodexConfig } from './l1.js';

/** Bridges a nested agent keeps below the maximum depth. Nested teams are refused anyway. */
export const MESH_KINDS = ['codex', 'antigravity', 'claude'];

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
/** Bridge tools that never edit files: a nested Claude may call them without a prompt. */
const READ_ONLY_BRIDGE_TOOLS = ['ask', 'review', 'brainstorm', 'plan'];
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
  return codexDisableArgs(
    listCodexServers(text)
      .filter(({ kind }) => (kind ? atMaxDepth || !MESH_KINDS.includes(kind) : !keepUser))
      .map(({ name }) => name),
  );
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

/** The path as given and as the OS resolves it (symlinks, /private/var, 8.3 names). */
function projectKeys(path) {
  const keys = new Set([projectKey(path)]);
  try {
    keys.add(projectKey(realpathSync.native(path)));
  } catch {
    /* gone or unreadable: the literal key still counts */
  }
  return keys;
}

/**
 * The folder Claude Code keys local scope by: the git root above `cwd`, or `cwd` itself
 * outside a repository (`claude mcp add -s local` run in `<repo>/sub` writes `<repo>`).
 */
export function claudeProjectDir(cwd) {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}

/** The local-scope entry of ~/.claude.json for `cwd`, if any. */
function localProject(projects, cwd) {
  if (!cwd || !projects || typeof projects !== 'object') return undefined;
  const wanted = projectKeys(claudeProjectDir(cwd));
  const entries = Object.entries(projects);
  const hit = entries.find(([path]) => wanted.has(projectKey(path))) || entries.find(([path]) => [...projectKeys(path)].some((k) => wanted.has(k)));
  return hit?.[1];
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
  // Local scope wins over user scope for the same name, as in Claude Code, even when the
  // local server is not a bridge; servers disabled for the project stay off.
  const project = localProject(data?.projects, cwd);
  const merged = { ...asObject(data?.mcpServers), ...asObject(project?.mcpServers) };
  const disabled = new Set(Array.isArray(project?.disabledMcpServers) ? project.disabledMcpServers : []);
  const servers = {};
  for (const [name, entry] of Object.entries(merged)) {
    if (!SERVER_NAME.test(name) || disabled.has(name) || !entry || typeof entry !== 'object') continue;
    const commandLine = [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])].join(' ');
    if (MESH_KINDS.includes(bridgeKind(commandLine))) servers[name] = entry;
  }
  return servers;
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

/**
 * Removes a temporary folder without ever throwing: on Windows a process that is still
 * shutting down (or an antivirus scan) can hold a file for a moment.
 * @param {string} dir
 */
export function removeTempDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* best effort; the OS temp cleanup gets the rest */
  }
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
    // Nobody can answer a permission prompt in a nested run (--permission-prompts none),
    // so the read-only bridge tools are allowed up front; delegate_* and configure_*
    // still need the user's own allow rules.
    const allowed = Object.keys(servers).flatMap((name) => READ_ONLY_BRIDGE_TOOLS.map((tool) => `mcp__${name}__${tool}_*`));
    return {
      // --mcp-config takes several values: it stays last so nothing after it is swallowed.
      args: ['--allowedTools', allowed.join(','), '--strict-mcp-config', '--mcp-config', file],
      cleanup: () => removeTempDir(dir),
    };
  } catch {
    // No room for the file: run without the mesh rather than fail the call.
    if (dir) removeTempDir(dir);
    return { args: ['--strict-mcp-config'], cleanup: noop };
  }
}
