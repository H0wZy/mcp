// H0wZy/mcp — Layer 1 of the loop guard: start an agent at the maximum depth without
// bridge tools, where its CLI offers a switch (spec 006, FR-010, research D4).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BRIDGE_MARKER = /@h0wzy\/mcp-server-[a-z]+|servers[\\/]+(?:codex|antigravity|claude|team)[\\/]+bin[\\/]+cli\.js/i;
const SECTION = /^\s*\[\s*mcp_servers\.([A-Za-z0-9_-]+)\s*\]\s*(?:#.*)?$/;
const ANY_HEADER = /^\s*\[/;

/**
 * Path of Codex's user config.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 */
export function codexConfigPath(env = process.env) {
  const home = String(env.CODEX_HOME ?? '').trim() || join(homedir(), '.codex');
  return join(home, 'config.toml');
}

/**
 * Names of the MCP servers in a Codex config.toml that launch an H0wZy/mcp bridge.
 *
 * @param {string} text TOML content
 * @returns {string[]}
 */
export function findBridgeServers(text) {
  const names = [];
  let current = null;
  let isBridge = false;
  const flush = () => {
    if (current && isBridge && !names.includes(current)) names.push(current);
  };
  for (const line of String(text).split(/\r?\n/)) {
    if (ANY_HEADER.test(line)) {
      flush();
      const match = line.match(SECTION);
      current = match ? match[1] : null;
      isBridge = false;
      continue;
    }
    if (current && BRIDGE_MARKER.test(line)) isBridge = true;
  }
  flush();
  return names;
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
    let text = codexConfig;
    if (text === undefined) {
      try {
        text = readFileSync(codexConfigPath(env), 'utf8');
      } catch {
        return [];
      }
    }
    // Only names that already exist: a new mcp_servers table without a command could
    // make Codex reject its config.
    return findBridgeServers(text).flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]);
  }
  if (target === 'antigravity') {
    return ['--disable-slash-commands'];
  }
  return [];
}
