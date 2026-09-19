// H0wZy/mcp — Child Process Executor
// Lazy, minimal, robust process runner with timeout and augmented PATH.

import { spawn } from 'node:child_process';
import { childEnvWithAugmentedPath } from './resolver.js';

/**
 * Spawns a process with timeout, path augmentation, and output capture.
 *
 * @param {string} command Path or name of the executable
 * @param {string[]} [args=[]] Command line arguments
 * @param {Object} [options={}]
 * @param {string} [options.cwd] Current working directory
 * @param {NodeJS.ProcessEnv} [options.env] Extra environment variables
 * @param {number} [options.timeoutMs=180000] Timeout in ms (default: 3 minutes)
 * @param {string} [options.toolName] Tool name to augment PATH for
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string, ok: boolean, timedOut: boolean }>}
 */
export function executeProcess(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const {
      cwd = process.cwd(),
      env = {},
      timeoutMs = 180000,
      toolName,
    } = options;

    const childEnv = {
      ...childEnvWithAugmentedPath(toolName),
      ...env,
    };

    const isWindows = process.platform === 'win32';
    // On Windows, running .cmd or .bat without a shell will fail in spawn
    const needsShell = isWindows && (command.toLowerCase().endsWith('.cmd') || command.toLowerCase().endsWith('.bat'));

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: needsShell,
    });

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore kill failure if already exited */
          }
        }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr || err.message,
        ok: false,
        timedOut,
      });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        ok: code === 0 && !timedOut,
        timedOut,
      });
    });
  });
}
