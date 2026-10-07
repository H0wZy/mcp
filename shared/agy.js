// H0wZy/mcp — Antigravity CLI (agy) helpers shared by the Antigravity bridge and the team
// server.
//
// agy has no switch to skip MCP servers, and its print-mode turn starts only after every
// server in ~/.gemini/config/mcp_config.json has connected. One unreachable server makes
// each run wait until --print-timeout, then exit 0 with an empty answer (verified with
// agy 1.3.1, spec 006 research §7). These helpers turn that into an actionable error.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PRINT_TIMEOUT = /print timeout after [^\n]* with turn in progress/i;
const STILL_CONNECTING = /MCP: \d+ server\(s\) still connecting after [^:\r\n]+: ([^\r\n]+)/g;
const LOG_TAIL_BYTES = 512 * 1024;

/**
 * True when agy stopped at its own --print-timeout ("[agy] print timeout after 2m0s
 * with turn in progress; returning partial output" on stderr).
 * @param {string} stderr
 */
export function hitPrintTimeout(stderr) {
  return PRINT_TIMEOUT.test(String(stderr ?? ''));
}

/**
 * MCP servers agy was still waiting for, from the last "still connecting" log line.
 * @param {string} logText
 * @returns {string[]}
 */
export function stuckMcpServers(logText) {
  let names = [];
  for (const match of String(logText ?? '').matchAll(STILL_CONNECTING)) {
    names = match[1].split(/[,\s]+/).filter(Boolean);
  }
  return names;
}

/**
 * What to tell the caller about servers that kept a turn from starting.
 * @param {string[]} names
 */
export function stuckServersHint(names) {
  if (!names.length) return '';
  const list = names.join(', ');
  return (
    `Antigravity was still waiting for MCP server(s) to connect: ${list}. ` +
    'Its turn only starts once every server in ~/.gemini/config/mcp_config.json is up. ' +
    `Bring ${names.length > 1 ? 'them' : 'it'} back online or remove ${names.length > 1 ? 'them' : 'it'} ` +
    `(\`agy mcp remove ${names[0]}\`); \`agy mcp disable\` did not stop the wait in agy 1.3.1.`
  );
}

/**
 * A private --log-file for one agy run, so a stuck run can be explained.
 * @returns {{ file: string, read: () => string, cleanup: () => void }}
 */
export function createAgyLog() {
  const dir = mkdtempSync(join(tmpdir(), 'h0wzy-agy-'));
  const file = join(dir, 'agy.log');
  return {
    file,
    read: () => readLogTail(file),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * The end of an agy log file ('' when there is none).
 * @param {string} file
 */
export function readLogTail(file) {
  try {
    const text = readFileSync(file, 'utf8');
    return text.length > LOG_TAIL_BYTES ? text.slice(-LOG_TAIL_BYTES) : text;
  } catch {
    return '';
  }
}

/**
 * Reads the `--output-format json` envelope ({ conversation_id, status, response,
 * usage, error? }). Returns null when stdout holds something else.
 * @param {string} stdout
 */
export function parseAgyEnvelope(stdout) {
  const text = String(stdout ?? '').trim();
  const candidates = [text, text.slice(text.lastIndexOf('\n{') + 1)];
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue;
    try {
      const data = JSON.parse(candidate);
      if (data && typeof data === 'object' && ('response' in data || 'conversation_id' in data || 'error' in data)) return data;
    } catch {
      /* not the envelope */
    }
  }
  return null;
}
