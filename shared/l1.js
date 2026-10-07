// H0wZy/mcp — Layer 1 of the loop guard: start an agent at the maximum depth without
// bridge tools, where its CLI offers a switch (spec 006, FR-010, research D4).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// `@h0wzy\mcp-server-codex` too: a global npm install on Windows, written by hand.
const BRIDGE_KIND = /@h0wzy[\\/]+mcp-server-(codex|antigravity|claude|team)(?![\w-])|servers[\\/]+(codex|antigravity|claude|team)[\\/]+bin[\\/]+cli\.js/i;
// A TOML key: bare, "basic" or 'literal'.
const KEY = String.raw`(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))`;
const SECTION = new RegExp(String.raw`^\s*\[\s*mcp_servers\s*\.\s*${KEY}\s*\]\s*(?:#.*)?$`);
const PARENT_SECTION = /^\s*\[\s*mcp_servers\s*\]\s*(?:#.*)?$/;
// `name = { command = "…", args = [ … ] }` inside [mcp_servers] (inline tables are one line).
const INLINE_SERVER = new RegExp(String.raw`^\s*${KEY}\s*=\s*\{(.*)$`);
/** Server names Codex accepts in a `-c mcp_servers.<name>.enabled=false` override. */
export const CODEX_OVERRIDE_NAME = /^[A-Za-z0-9_-]+$/;
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
  const server = (name) => {
    let found = servers.find((s) => s.name === name);
    if (!found) {
      found = { name, kind: null };
      servers.push(found);
    }
    return found;
  };
  let current = null;
  let inParent = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (ANY_HEADER.test(line)) {
      const match = line.match(SECTION);
      current = match ? server(match[1] ?? match[2] ?? match[3]) : null;
      inParent = PARENT_SECTION.test(line);
      continue;
    }
    if (COMMENT.test(line)) continue;
    if (inParent) {
      const inline = line.match(INLINE_SERVER);
      if (inline) {
        const entry = server(inline[1] ?? inline[2] ?? inline[3]);
        entry.kind ||= bridgeKind(inline[4]);
      }
      continue;
    }
    if (current && !current.kind) current.kind = bridgeKind(line);
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
 * `-c` overrides that switch off the named Codex MCP servers. Codex splits `-c` keys on
 * dots, so a name outside [A-Za-z0-9_-] can't be addressed and stays on (the runtime
 * guard, L2, still applies to bridges).
 * @param {string[]} names
 */
export function codexDisableArgs(names) {
  return names.filter((name) => CODEX_OVERRIDE_NAME.test(name)).flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]);
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
    return codexDisableArgs(findBridgeServers(text));
  }
  if (target === 'antigravity') {
    return ['--disable-slash-commands'];
  }
  return [];
}
