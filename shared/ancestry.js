// H0wZy/mcp — Process ancestry lookup, the loop guard's fallback when a host does not
// forward the chain environment (spec 006, FR-003).

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const MAX_LEVELS = 32;
// PowerShell + CIM can take several seconds on a busy Windows machine (seen in CI).
const QUERY_TIMEOUT_MS = process.platform === 'win32' ? 30000 : 8000;

function linuxParent(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The command name is in parentheses and may contain spaces; ppid is the 2nd field after it.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ppid = Number(fields[1]);
    return Number.isInteger(ppid) ? ppid : null;
  } catch {
    return null;
  }
}

function parentTableFrom(output) {
  const table = new Map();
  for (const line of output.split(/\r?\n/)) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(pid) && Number.isInteger(ppid)) table.set(pid, ppid);
  }
  return table.size > 0 ? table : null;
}

function posixParentTable() {
  const res = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: QUERY_TIMEOUT_MS });
  return res.status === 0 && res.stdout ? parentTableFrom(res.stdout) : null;
}

function windowsParentTable() {
  const script =
    'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ' +
    'ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }';
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: QUERY_TIMEOUT_MS,
    windowsHide: true,
  });
  return res.status === 0 && res.stdout ? parentTableFrom(res.stdout) : null;
}

function walk(startPid, parentOf) {
  const ancestors = [];
  const seen = new Set([startPid]);
  let pid = startPid;
  for (let i = 0; i < MAX_LEVELS; i++) {
    const ppid = parentOf(pid);
    if (ppid === null || ppid === undefined || ppid <= 0 || seen.has(ppid)) break;
    ancestors.push(ppid);
    seen.add(ppid);
    pid = ppid;
  }
  return ancestors;
}

/**
 * Lists the ancestors of `pid`, nearest first (parent, grandparent, …).
 *
 * @param {number} [pid=process.pid]
 * @param {NodeJS.Platform} [platform=process.platform]
 * @returns {number[] | null} null when the process table can't be read
 */
export function readAncestors(pid = process.pid, platform = process.platform) {
  if (platform === 'linux') {
    if (linuxParent(pid) === null) return null;
    return walk(pid, linuxParent);
  }
  const table = platform === 'win32' ? windowsParentTable() : posixParentTable();
  if (!table) return null;
  return walk(pid, (p) => table.get(p) ?? null);
}

let cached;

/**
 * Ancestors of the current process, computed once. A process's ancestors don't change
 * while it runs (a parent that exits is simply no longer alive), and the Windows query
 * is slow enough to be worth caching.
 *
 * @returns {number[] | null}
 */
export function currentAncestors() {
  if (cached === undefined) cached = readAncestors();
  return cached;
}
