import { statSync, accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, sep } from 'node:path';
import { homedir } from 'node:os';

const isWindows = process.platform === 'win32';

/**
 * Returns candidate names for a binary, accounting for Windows PATHEXT.
 * @param {string} name
 * @returns {string[]}
 */
export function candidateNames(name) {
  if (!isWindows) return [name];
  const pathext = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean);
  if (pathext.some((ext) => name.toLowerCase().endsWith(ext.toLowerCase()))) {
    return [name];
  }
  // On Windows, test valid executable extensions first before extensionless
  const withExts = pathext.map((ext) =>
    ext.startsWith('.') ? `${name}${ext.toLowerCase()}` : `${name}.${ext.toLowerCase()}`
  );
  return [...withExts, name];
}

/**
 * Checks whether a file exists and is executable.
 * @param {string} path
 * @returns {boolean}
 */
export function isExecutable(path) {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return false;
  } catch {
    return false;
  }

  if (isWindows) {
    // On Windows, file must match PATHEXT to be executable via spawn/CreateProcess
    const pathext = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
      .toLowerCase()
      .split(';')
      .filter(Boolean);
    const lower = path.toLowerCase();
    return pathext.some((ext) => lower.endsWith(ext.startsWith('.') ? ext : `.${ext}`));
  }

  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Known default locations per tool across Windows, macOS, and Linux.
 * @param {string} toolName
 * @returns {string[]}
 */
export function getKnownToolDirs(toolName) {
  const home = homedir();
  const dirs = [dirname(process.execPath)];

  if (isWindows) {
    const appData = process.env.APPDATA;
    const localAppData = process.env.LOCALAPPDATA || (home ? join(home, 'AppData', 'Local') : '');

    if (toolName === 'agy') {
      if (localAppData) dirs.push(join(localAppData, 'agy', 'bin'));
      dirs.push(join(home, '.local', 'bin'));
      dirs.push(join(home, 'AppData', 'Local', 'Programs', 'agy'));
    } else if (toolName === 'codex') {
      if (appData) dirs.push(join(appData, 'npm'));
      if (localAppData) dirs.push(join(localAppData, 'Programs', 'codex'));
      dirs.push(join(home, '.local', 'bin'));
    } else if (toolName === 'claude') {
      dirs.push(join(home, '.local', 'bin'));
      if (appData) dirs.push(join(appData, 'npm'));
    }
  } else {
    dirs.push(
      join(home, '.local', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      join(home, '.npm-global', 'bin'),
      join(home, '.bun', 'bin'),
      join(home, '.volta', 'bin')
    );
  }

  return dirs;
}

/**
 * Resolves a binary path searching explicit overrides, known directories, and PATH.
 * @param {string} name Base executable name (e.g. 'agy', 'codex', 'claude')
 * @param {string} [overrideEnvVar] Optional environment variable name (e.g. 'AGY_BIN')
 * @returns {string|null} Absolute path to executable or null if not found
 */
export function resolveBinary(name, overrideEnvVar) {
  if (overrideEnvVar && process.env[overrideEnvVar]) {
    const override = process.env[overrideEnvVar].trim();
    if (isExecutable(override)) return override;
  }

  if (isAbsolute(name) || name.includes(sep) || name.includes('/')) {
    if (isExecutable(name)) return name;
  }

  const searchDirs = [];
  const seen = new Set();

  const addDir = (d) => {
    if (d && !seen.has(d)) {
      seen.add(d);
      searchDirs.push(d);
    }
  };

  // 1. Tool-specific known locations
  for (const d of getKnownToolDirs(name)) addDir(d);

  // 2. PATH directories using platform delimiter (; on Windows, : on POSIX)
  const pathDirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const d of pathDirs) addDir(d);

  // 3. Search for candidates
  const candidates = candidateNames(name);
  for (const dir of searchDirs) {
    for (const cand of candidates) {
      const fullPath = join(dir, cand);
      if (isExecutable(fullPath)) {
        try {
          const real = realpathSync(fullPath);
          // Filter out macOS Electron app bundle wrappers that aren't the CLI
          if (real.includes('Antigravity.app')) continue;
        } catch {
          // Keep candidate if realpath resolution fails
        }
        return fullPath;
      }
    }
  }

  return null;
}

/**
 * Returns a child process environment with PATH augmented by known tool directories.
 * @param {string} [toolName]
 * @returns {NodeJS.ProcessEnv}
 */
export function childEnvWithAugmentedPath(toolName) {
  const current = (process.env.PATH || '').split(delimiter).filter(Boolean);
  const merged = [];
  const seen = new Set();

  const add = (d) => {
    if (d && !seen.has(d)) {
      seen.add(d);
      merged.push(d);
    }
  };

  for (const d of current) add(d);
  if (toolName) {
    for (const d of getKnownToolDirs(toolName)) add(d);
  }

  return { ...process.env, PATH: merged.join(delimiter) };
}
