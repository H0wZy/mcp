// H0wZy/mcp — OpenAI Codex MCP Server
// Minimal, DRY bridge exposing OpenAI Codex CLI (GPT-5.6 / GPT-6 Astra) to any MCP client.

import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createMcpServer, resolveBinary, executeProcess, formatResilientResponse } from '../../../shared/index.js';

const DEFAULT_MODEL = process.env.CODEX_MODEL || 'gpt-5.6-terra';
const TIMEOUT_MS = 300000; // 5 minutes

async function executeCodexCommand(subcommand, prompt, paths = [], model, extraArgs = []) {
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
    subcommand,
    fullPrompt,
    '-m',
    model || DEFAULT_MODEL,
    '--color',
    'never',
    ...extraArgs,
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
}

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
  handler: ({ prompt, paths, model }) =>
    executeCodexCommand('exec', prompt, paths, model, [
      '--ephemeral',
      '--skip-git-repo-check',
      '--approve-for-me',
    ]),
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
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional files or directories to review.',
      },
      model: {
        type: 'string',
        description: 'Optional model override (e.g. "gpt-6-astra", "gpt-5.6-terra").',
      },
    },
    required: ['prompt'],
  },
  handler: ({ prompt, paths, model }) =>
    executeCodexCommand('review', prompt, paths, model),
};

export const brainstormCodexTool = {
  name: 'brainstorm_codex',
  description:
    'Architectural brainstorming and ideation using OpenAI Codex (GPT-5.6 / GPT-6 Astra). ' +
    'Explores alternative patterns, system trade-offs, and design approaches.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The architectural or system design problem to explore.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional context files or documentation.',
      },
      model: {
        type: 'string',
        description: 'Optional model override.',
      },
    },
    required: ['prompt'],
  },
  handler: ({ prompt, paths, model }) =>
    executeCodexCommand(
      'exec',
      `You are an enterprise software architect. Analyze the problem, brainstorm 2-3 viable architectural alternatives, outline trade-offs and pros/cons for each, and recommend the best path forward.\n\nProblem: ${prompt}`,
      paths,
      model,
      ['--ephemeral', '--skip-git-repo-check', '--approve-for-me']
    ),
};

export const planCodexTool = {
  name: 'plan_codex',
  description:
    'Generate a structured, step-by-step implementation plan or execution checklist using OpenAI Codex.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The feature or refactoring goal to break down.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional context files or requirements.',
      },
      model: {
        type: 'string',
        description: 'Optional model override.',
      },
    },
    required: ['prompt'],
  },
  handler: ({ prompt, paths, model }) =>
    executeCodexCommand(
      'exec',
      `You are a lead technical planner. Break down the requested goal into structured, dependency-ordered, verifiable implementation tasks with concrete file paths and test steps.\n\nGoal: ${prompt}`,
      paths,
      model,
      ['--ephemeral', '--skip-git-repo-check', '--approve-for-me']
    ),
};

export function createServer() {
  return createMcpServer({
    name: 'codex',
    version: '1.0.2',
    tools: [askCodexTool, reviewCodexTool, brainstormCodexTool, planCodexTool],
  });
}
