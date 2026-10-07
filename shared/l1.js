// H0wZy/mcp — Layer 1 of the loop guard: start an agent at the maximum depth without
// bridge tools, where its CLI offers a switch (spec 006, FR-010, research D4).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BRIDGE_KIND = /@h0wzy\/mcp-server-(codex|antigravity|claude|team)\b|servers[\\/]+(codex|antigravity|claude|team)[\\/]+bin[\\/]+cli\.js/i;
const SECTION = /^\s*\[\s*mcp_servers\.([A-Za-z0-9_-]+)\s*\]\s*(?:#.*)?$/;
const ANY_HEADER = /^\s*\[/;
const COMMENT = /^\s*#/;

/**
 * Which H0wZy/mcp server a command line launches, if any.
 * @param {string} text Command and arguments of an MCP server entry
 * @returns {'codex' | 'antigravity' | 'claude' | 'team' | null}
 */
export function bridgeKind(text) {
  const match = String(text ?? '').match(BRIDGE_KIND);
  return match ? /** @type {any} */ ((match[1] || match[2]).toLowerCase()) : null;
}

/**
 * Path of Codex's user config.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 */
export function codexConfigPath(env = process.env) {
  const home = String(env.CODEX_HOME ?? '').trim() || join(homedir(), '.codex');
  return join(home, 'config.toml');
}

/**
 * Every `[mcp_servers.<name>]` table of a Codex config.toml, with the H0wZy/mcp server
 * it launches (null for the user's other servers). Sub-tables such as
 * `[mcp_servers.<name>.env]` and commented-out lines don't count.
 *
 * @param {string} text TOML content
 * @returns {{ name: string, kind: ReturnType<typeof bridgeKind> }[]}
 */
export function listCodexServers(text) {
  const servers = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (ANY_HEADER.test(line)) {
      const match = line.match(SECTION);
      current = match ? servers.find((s) => s.name === match[1]) : null;
      if (match && !current) {
        current = { name: match[1], kind: null };
        servers.push(current);
      }
      continue;
    }
    if (current && !current.kind && !COMMENT.test(line)) current.kind = bridgeKind(line);
  }
  return servers;
}

/**
 * Names of the MCP servers in a Codex config.toml that launch an H0wZy/mcp bridge.
 *
 * @param {string} text TOML content
 * @returns {string[]}
 */
export function findBridgeServers(text) {
  return listCodexServers(text)
    .filter((s) => s.kind)
    .map((s) => s.name);
}

/**
 * Codex's config.toml, or undefined when it can't be read.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 */
export function readCodexConfig(env = process.env) {
  try {
    return readFileSync(codexConfigPath(env), 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Extra arguments that start `target` without bridge tools. Only switches each CLI
 * documents are used; where there is none, the runtime guard (L2) still applies.
 *
 * @param {'claude' | 'codex' | 'antigravity' | string} target
 * @param {{ codexConfig?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {string[]}
 */
export function noBridgeArgs(target, { codexConfig, env = process.env } = {}) {
  if (target === 'claude') {
    // No --mcp-config next to --strict-mcp-config: no MCP servers at all.
    return ['--strict-mcp-config', '--disable-slash-commands'];
  }
  if (target === 'codex') {
    const text = codexConfig ?? readCodexConfig(env);
    if (text === undefined) return [];
    // Only names that already exist: a new mcp_servers table without a command could
    // make Codex reject its config.
    return findBridgeServers(text).flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]);
  }
  if (target === 'antigravity') {
    return ['--disable-slash-commands'];
  }
  return [];
}
