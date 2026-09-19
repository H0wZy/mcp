// H0wZy/mcp — OpenAI Codex MCP Server
// Minimal, DRY bridge exposing OpenAI Codex CLI (GPT-5.6 / GPT-6 Astra) to any MCP client.

import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createMcpServer, resolveBinary, executeProcess, formatResilientResponse } from '../../../shared/index.js';

const DEFAULT_MODEL = process.env.CODEX_MODEL || 'gpt-5.6-terra';
const TIMEOUT_MS = 300000; // 5 minutes

export const askCodexTool = {
  name: 'ask_codex',
  description:
    'Ask OpenAI Codex CLI (default model: GPT-5.6 Terra / GPT-6 Astra) for an independent second opinion, ' +
    'reasoning check, or implementation advice. Codex has deep understanding of complex codebases and architectures.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The instruction, question, or verification request.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional file or folder paths to attach as context.',
      },
      model: {
        type: 'string',
        description: 'Optional model override (e.g. "gpt-6-astra", "gpt-5.6-terra", "gpt-5.5").',
      },
    },
    required: ['prompt'],
  },
  handler: async ({ prompt, paths = [], model }) => {
    if (!prompt) {
      return { text: 'Missing required argument: prompt', isError: true };
    }

    const codexBin = resolveBinary('codex', 'CODEX_CLI_PATH');
    if (!codexBin) {
      return {
        isError: true,
        text:
          '❌ OpenAI Codex CLI (`codex`) not found on system.\n' +
          'Please ensure Codex CLI is installed:\n' +
          '  npm install -g @openai/codex\n' +
          'Or set CODEX_CLI_PATH to its absolute path.',
      };
    }

    const fullPrompt = paths.length
      ? `Context files/directories to inspect in full:\n${paths.map((p) => `- ${p}`).join('\n')}\n\n${prompt}`
      : prompt;

    const args = [
      'exec',
      fullPrompt,
      '-m',
      model || DEFAULT_MODEL,
      '--ephemeral',
      '--skip-git-repo-check',
      '--approve-for-me',
      '--color',
      'never',
    ];

    for (const p of paths) {
      try {
        const isDir = statSync(p).isDirectory();
        args.push('--add-dir', isDir ? p : dirname(p));
      } catch {
        /* skip invalid path */
      }
    }

    const res = await executeProcess(codexBin, args, { timeoutMs: TIMEOUT_MS, toolName: 'codex' });

    if (res.ok) {
      return {
        text: res.stdout || '(Codex completed with no output)',
        isError: false,
      };
    }

    return formatResilientResponse({
      provider: 'OpenAI Codex',
      rawOutput: res.stderr || res.stdout,
      exitCode: res.exitCode,
    });
  },
};

export const reviewCodexTool = {
  name: 'review_codex',
  description:
    'Run a structured code review using OpenAI Codex CLI against the current repository or specified files.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Specific review instructions or focus areas (e.g. security, performance, edge cases).',
      },
      model: {
        type: 'string',
        description: 'Optional model override (e.g. "gpt-6-astra", "gpt-5.6-terra").',
      },
    },
    required: ['prompt'],
  },
  handler: async ({ prompt, model }) => {
    const codexBin = resolveBinary('codex', 'CODEX_CLI_PATH');
    if (!codexBin) {
      return {
        isError: true,
        text: '❌ OpenAI Codex CLI (`codex`) not found on system.',
      };
    }

    const args = [
      'review',
      prompt,
      '-m',
      model || DEFAULT_MODEL,
      '--color',
      'never',
    ];

    const res = await executeProcess(codexBin, args, { timeoutMs: TIMEOUT_MS, toolName: 'codex' });

    if (res.ok) {
      return {
        text: res.stdout || '(Codex review completed with no output)',
        isError: false,
      };
    }

    return formatResilientResponse({
      provider: 'OpenAI Codex',
      rawOutput: res.stderr || res.stdout,
      exitCode: res.exitCode,
    });
  },
};

export function createServer() {
  return createMcpServer({
    name: 'codex',
    version: '1.0.0',
    tools: [askCodexTool, reviewCodexTool],
  });
}
