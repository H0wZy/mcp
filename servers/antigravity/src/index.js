// H0wZy/mcp — Antigravity MCP Server
// Minimal, DRY bridge exposing Google Antigravity (Gemini 3.1 Pro / Flash) to any MCP client.

import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createMcpServer, resolveBinary, executeProcess, formatResilientResponse } from '../../../shared/index.js';

const DEFAULT_MODEL = process.env.AGY_MODEL || 'Gemini 3.8 Flash (High)';
const TIMEOUT_MS = 300000; // 5 minutes

async function executeAgyPrompt({ prompt, prefix = '', paths = [], model, cwd, timeoutMinutes = 5 }) {
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

  const dirs = new Set(cwd ? [cwd] : []);
  for (const p of paths) {
    try {
      dirs.add(statSync(p).isDirectory() ? p : dirname(p));
    } catch {
      /* skip unreadable path */
    }
  }

  const formattedPrompt = prefix ? `${prefix}\n\n${prompt}` : prompt;
  const fullPrompt = paths.length
    ? `Context files/folders to read and consider in full:\n${paths.map((p) => `- ${p}`).join('\n')}\n\n${formattedPrompt}`
    : formattedPrompt;

  const args = [
    '-p',
    fullPrompt,
    '--model',
    model || DEFAULT_MODEL,
    '--print-timeout',
    `${timeoutMinutes}m`,
    '--dangerously-skip-permissions',
  ];
  for (const d of dirs) args.push('--add-dir', d);

  const res = await executeProcess(agyBin, args, {
    cwd,
    timeoutMs: cwd ? timeoutMinutes * 60000 + 30000 : TIMEOUT_MS,
    toolName: 'agy',
  });

  if (res.ok) {
    return {
      text: res.stdout || '(Antigravity completed with no output)',
      isError: false,
    };
  }

  return formatResilientResponse({
    provider: 'Google Antigravity',
    rawOutput: res.stderr || res.stdout,
    exitCode: res.exitCode,
  });
}

export const askAntigravityTool = {
  name: 'ask_antigravity',
  description:
    'Get an INDEPENDENT second opinion or answer from Google Antigravity ' +
    '(default model: Gemini 3.1 Pro High) — a different model family than Claude or OpenAI, ' +
    'ensuring an unbiased cross-check. Provide a `prompt`; optionally pass `paths` (file or folder ' +
    'paths) and Antigravity will read the entire context before answering.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The question, architectural proposal, or general inquiry.',
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
  handler: (args) => executeAgyPrompt(args),
};

export const reviewAntigravityTool = {
  name: 'review_antigravity',
  description:
    'Request a thorough, structured code review from Google Antigravity (Gemini 3.1 Pro High). ' +
    'Inspects code correctness, edge cases, race conditions, security vulnerabilities, performance, and architecture.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Specific code review instructions or focus areas (e.g., security, edge cases, memory leaks).',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files or folders to inspect and review.',
      },
      model: {
        type: 'string',
        description: 'Optional model override (e.g. "Gemini 3.1 Pro (High)", "Gemini 3.1 Flash").',
      },
    },
    required: ['prompt'],
  },
  handler: (args) =>
    executeAgyPrompt({
      ...args,
      prefix:
        'You are performing a comprehensive code review. Focus on bug detection, race conditions, ' +
        'security issues, performance bottlenecks, and architectural clarity. Provide specific recommendations or diffs where helpful.',
    }),
};

export const brainstormAntigravityTool = {
  name: 'brainstorm_antigravity',
  description:
    'Architectural brainstorming and exploration with Google Antigravity (Gemini 3.1 Pro High). ' +
    'Explores alternative design patterns, trade-offs, scalability considerations, and pros/cons.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The architectural challenge, feature design, or problem to brainstorm.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional relevant code or documentation files to consider.',
      },
      model: {
        type: 'string',
        description: 'Optional model override.',
      },
    },
    required: ['prompt'],
  },
  handler: (args) =>
    executeAgyPrompt({
      ...args,
      prefix:
        'You are a software architect exploring system design options. Analyze the given problem, ' +
        'brainstorm 2-3 viable architectural alternatives, outline trade-offs and pros/cons for each, and recommend the best path forward.',
    }),
};

export const planAntigravityTool = {
  name: 'plan_antigravity',
  description:
    'Generate a step-by-step implementation plan or execution checklist using Google Antigravity (Gemini 3.1 Pro High).',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The feature or refactor goal to break down into implementation steps.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional context files or existing specifications.',
      },
      model: {
        type: 'string',
        description: 'Optional model override.',
      },
    },
    required: ['prompt'],
  },
  handler: (args) =>
    executeAgyPrompt({
      ...args,
      prefix:
        'You are a lead technical planner. Break down the requested goal into structured, ' +
        'dependency-ordered, verifiable implementation tasks with concrete file paths and test steps.',
    }),
};

export const delegateAntigravityTool = {
  name: 'delegate_antigravity',
  description:
    'Hand a self-contained implementation task to Google Antigravity, which EDITS FILES inside `cwd` ' +
    '(permissions skipped). Use for well-specified tasks with clear file ownership; review the diff ' +
    'afterwards. Returns the final report from Antigravity.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'The task: goal, files it may touch, acceptance checks, what to report.' },
      cwd: { type: 'string', description: 'Absolute path of the repository or folder to work in.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Optional extra files/folders to read.' },
      model: { type: 'string', description: 'Optional model override (default Gemini 3.8 Flash (High)).' },
      timeout_minutes: { type: 'number', description: 'Max run time, 1-60 (default 30).' },
    },
    required: ['prompt', 'cwd'],
  },
  handler: ({ prompt, cwd, paths, model, timeout_minutes }) =>
    executeAgyPrompt({
      prompt,
      paths,
      model,
      cwd,
      timeoutMinutes: Math.min(Math.max(Math.round(timeout_minutes || 30), 1), 60),
    }),
};

export function createServer() {
  return createMcpServer({
    name: 'antigravity',
    version: '1.0.5',
    tools: [
      askAntigravityTool,
      reviewAntigravityTool,
      brainstormAntigravityTool,
      planAntigravityTool,
      delegateAntigravityTool,
    ],
  });
}
