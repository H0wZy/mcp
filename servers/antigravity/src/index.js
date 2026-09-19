// H0wZy/mcp — Antigravity MCP Server
// Minimal, DRY bridge exposing Google Antigravity (Gemini 3.1 Pro / Flash) to any MCP client.

import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createMcpServer, resolveBinary, executeProcess, formatResilientResponse } from '../../../shared/index.js';

const DEFAULT_MODEL = process.env.AGY_MODEL || 'Gemini 3.1 Pro (High)';
const TIMEOUT_MS = 300000; // 5 minutes

export const askAntigravityTool = {
  name: 'ask_antigravity',
  description:
    'Get an INDEPENDENT second opinion or code review from Google Antigravity ' +
    '(default model: Gemini 3.1 Pro High) — a different model family than Claude or OpenAI, ' +
    'ensuring an unbiased cross-check. Provide a `prompt`; optionally pass `paths` (file or folder ' +
    'paths) and Antigravity will read the entire context before answering.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The question, architectural proposal, or code review request.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional file or directory paths to include as full context.',
      },
      model: {
        type: 'string',
        description: 'Optional model override (e.g. "Gemini 3.1 Pro (High)", "Gemini 3.1 Flash").',
      },
    },
    required: ['prompt'],
  },
  handler: async ({ prompt, paths = [], model }) => {
    if (!prompt) {
      return { text: 'Missing required argument: prompt', isError: true };
    }

    const agyBin = resolveBinary('agy', 'AGY_BIN');
    if (!agyBin) {
      return {
        isError: true,
        text:
          '❌ Google Antigravity CLI (`agy`) not found on system.\n' +
          'Please ensure Antigravity is installed:\n' +
          '  - Windows: Check %LOCALAPPDATA%\\agy\\bin\\agy.exe or run installer\n' +
          '  - macOS/Linux: curl -fsSL https://antigravity.google/cli/install.sh | bash\n' +
          'Or set AGY_BIN to its absolute path.',
      };
    }

    const dirs = new Set();
    for (const p of paths) {
      try {
        dirs.add(statSync(p).isDirectory() ? p : dirname(p));
      } catch {
        /* skip unreadable path */
      }
    }

    const fullPrompt = paths.length
      ? `Context files/folders to read and consider in full:\n${paths.map((p) => `- ${p}`).join('\n')}\n\n${prompt}`
      : prompt;

    const args = [
      '-p',
      fullPrompt,
      '--model',
      model || DEFAULT_MODEL,
      '--print-timeout',
      '5m',
      '--dangerously-skip-permissions',
    ];
    for (const d of dirs) args.push('--add-dir', d);

    const res = await executeProcess(agyBin, args, { timeoutMs: TIMEOUT_MS, toolName: 'agy' });

    if (res.ok) {
      return {
        text: res.stdout || '(Antigravity completed with no output)',
        isError: false,
      };
    }

    const formatted = formatResilientResponse({
      provider: 'Google Antigravity',
      rawOutput: res.stderr || res.stdout,
      exitCode: res.exitCode,
    });
    return formatted;
  },
};

export function createServer() {
  return createMcpServer({
    name: 'antigravity',
    version: '1.0.0',
    tools: [askAntigravityTool],
  });
}
