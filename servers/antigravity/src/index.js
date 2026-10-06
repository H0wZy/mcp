// H0wZy/mcp — Antigravity MCP Server
// Minimal, DRY bridge exposing Google Antigravity (Gemini 3.8 Flash / Pro) to any MCP client.

import { statSync } from 'node:fs';
import { dirname } from 'node:path';

// Installed from npm, @h0wzy/mcp-shared is a real dependency. Run straight from a
// clone without `npm install`, fall back to the workspace copy of shared/.
const shared = await import('@h0wzy/mcp-shared').catch((err) => {
  if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
  return import('../../../shared/index.js');
});
const {
  createMcpServer,
  resolveBinary,
  executeProcess,
  formatResilientResponse,
  createAgentConfig,
} = shared;

const TIMEOUT_MS = 300000; // 5 minutes

async function loadAgyCatalog() {
  const agyBin = resolveBinary('agy', 'AGY_BIN');
  if (!agyBin) return null;
  const res = await executeProcess(agyBin, ['models'], { timeoutMs: 4500, toolName: 'agy' });
  if (!res.ok || !res.stdout) return null;

  const families = new Map();
  const lines = res.stdout.split('\n');
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const variantId = parts[0].trim();
    const displayName = parts[1].trim();

    const match = variantId.match(/^(.+)-(low|medium|high|xhigh|max|ultra)$/);
    if (match) {
      const familyId = match[1];
      const effort = match[2];
      if (!families.has(familyId)) {
        const baseDisplay = displayName.replace(/\s*\((Low|Medium|High|XHigh|Max|Ultra)\)$/i, '').trim();
        let tierNote = 'balanced';
        if (familyId.includes('3.8') || familyId.includes('opus')) {
          tierNote = 'deep';
        } else if (familyId.includes('3.6') || familyId.includes('3.7') || familyId.includes('oss')) {
          tierNote = 'light';
        }

        families.set(familyId, {
          id: familyId,
          displayName: baseDisplay,
          efforts: [],
          defaultEffort: 'high',
          tierNote,
          variants: {},
        });
      }
      const fam = families.get(familyId);
      if (!fam.efforts.includes(effort)) fam.efforts.push(effort);
      fam.variants[effort] = variantId;
    }
  }

  return families.size > 0 ? Array.from(families.values()) : null;
}

export const agentConfig = createAgentConfig({
  provider: 'antigravity',
  catalogLoader: loadAgyCatalog,
});

async function executeAgyPrompt({ prompt, prefix = '', paths = [], model, effort, cwd, timeoutMinutes = 5 }) {
  if (!prompt) {
    return { text: 'Missing required argument: prompt', isError: true };
  }

  const snapshot = agentConfig.resolveCall({ model, effort });

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
    snapshot.cliModel,
    '--print-timeout',
    `${timeoutMinutes}m`,
    '--dangerously-skip-permissions',
  ];

  if (snapshot.cliEffort) {
    args.push('--effort', snapshot.cliEffort);
  }

  for (const d of dirs) args.push('--add-dir', d);

  const res = await executeProcess(agyBin, args, {
    cwd,
    timeoutMs: cwd ? timeoutMinutes * 60000 + 30000 : TIMEOUT_MS,
    toolName: 'agy',
  });

  const footer = agentConfig.formatFooter(snapshot);

  if (res.ok) {
    return {
      text: (res.stdout || '(Antigravity completed with no output)') + footer,
      isError: false,
    };
  }

  const formatted = formatResilientResponse({
    provider: 'Google Antigravity',
    rawOutput: res.stderr || res.stdout,
    exitCode: res.exitCode,
  });

  return {
    text: formatted.text + footer,
    isError: true,
  };
}

export const configureAntigravityTool = {
  name: 'configure_antigravity',
  description:
    'Inspect or change Google Antigravity model and reasoning effort for the current session. ' +
    'Supports pre-configured tiers ("light" for trivial tasks, "balanced" for routine work, "deep" for hard bugs/complex architecture/security), ' +
    'explicit models (e.g. "gemini-3.8-flash", "gemini-3.1-pro"), or custom efforts ("low"|"medium"|"high"|"xhigh"|"max"). ' +
    'Actions: "get" (view active settings), "set" (apply updates), "reset" (restore startup defaults), "list" (catalog & tiers). ' +
    'Claude Code may switch tiers autonomously based on task difficulty.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['get', 'set', 'reset', 'list'],
        default: 'get',
        description: 'Action to perform. Default is "get" (read current state without modifying).',
      },
      tier: {
        type: 'string',
        enum: ['light', 'balanced', 'deep'],
        description: 'Preset tier: "light" (Flash Low), "balanced" (Flash Medium), "deep" (Flash High).',
      },
      model: {
        type: 'string',
        description: 'Model family or variant identifier (e.g. "gemini-3.8-flash", "gemini-3.1-pro").',
      },
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh', 'max'],
        description: 'Reasoning effort level. Automatically mapped to supported levels.',
      },
    },
  },
  handler: (args = {}) => {
    const action = (args.action || 'get').toLowerCase();

    if (action === 'get') {
      const state = agentConfig.get();
      return (
        `⚙️ [Google Antigravity Active Configuration]\n` +
        `Model:  ${state.active.model}\n` +
        `Effort: ${state.active.effort}` +
        (state.active.tier ? ` (Tier: ${state.active.tier})` : '') +
        `\nSource: ${state.active.source}\n\n` +
        JSON.stringify(state, null, 2)
      );
    }

    if (action === 'set') {
      const updated = agentConfig.set(args);
      let summary =
        `⚙️ [Google Antigravity Configuration Updated]\n` +
        `Previous: ${updated.previous.model} (effort: ${updated.previous.effort}, source: ${updated.previous.source})\n` +
        `Active:   ${updated.active.model} (effort: ${updated.active.effort}, source: ${updated.active.source})\n`;

      if (updated.warnings && updated.warnings.length > 0) {
        summary += `⚠️ Warnings:\n  - ${updated.warnings.join('\n  - ')}\n`;
      }
      return summary + '\n' + JSON.stringify(updated, null, 2);
    }

    if (action === 'reset') {
      const resetState = agentConfig.reset();
      return (
        `🔄 [Google Antigravity Configuration Reset to Startup Defaults]\n` +
        `Active: ${resetState.active.model} (effort: ${resetState.active.effort}, source: startup)\n\n` +
        JSON.stringify(resetState, null, 2)
      );
    }

    if (action === 'list') {
      const catalog = agentConfig.list();
      return (
        `📋 [Google Antigravity Model Catalog & Tiers]\n` +
        `Catalog Source: ${catalog.catalogSource} (status: ${catalog.catalogStatus})\n\n` +
        JSON.stringify(catalog, null, 2)
      );
    }

    throw new Error(`Unsupported action '${action}'. Valid actions: get, set, reset, list`);
  },
};

export const askAntigravityTool = {
  name: 'ask_antigravity',
  description:
    'Get an INDEPENDENT second opinion or answer from Google Antigravity ' +
    '(default model: Gemini 3.8 Flash High; configure via configure_antigravity). ' +
    'A different model family than Claude or OpenAI, ensuring an unbiased cross-check. ' +
    'Provide a `prompt`; optionally pass `paths`, `model`, or `effort`.',
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
        description: 'Optional model override (e.g. "gemini-3.8-flash", "gemini-3.1-pro").',
      },
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh', 'max'],
        description: 'Optional reasoning effort override ("low"|"medium"|"high"|"xhigh"|"max").',
      },
    },
    required: ['prompt'],
  },
  handler: (args) => executeAgyPrompt(args),
};

export const reviewAntigravityTool = {
  name: 'review_antigravity',
  description:
    'Request a thorough, structured code review from Google Antigravity (default model: Gemini 3.8 Flash High). ' +
    'Inspects code correctness, edge cases, race conditions, security vulnerabilities, performance, and architecture. ' +
    'Use tier "deep" via configure_antigravity for complex security/architecture reviews.',
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
        description: 'Optional model override.',
      },
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh', 'max'],
        description: 'Optional reasoning effort override.',
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
    'Architectural brainstorming and exploration with Google Antigravity. ' +
    'Explores alternative design patterns, trade-offs, scalability considerations, and pros/cons. ' +
    'Configure model and effort via configure_antigravity.',
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
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh', 'max'],
        description: 'Optional reasoning effort override.',
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
    'Generate a step-by-step implementation plan or execution checklist using Google Antigravity. ' +
    'Configure model and effort via configure_antigravity.',
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
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh', 'max'],
        description: 'Optional reasoning effort override.',
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
    '(permissions skipped). Review the diff afterwards. Returns the final report from Antigravity. ' +
    'Configure model and effort via configure_antigravity.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'The task: goal, files it may touch, acceptance checks, what to report.' },
      cwd: { type: 'string', description: 'Absolute path of the repository or folder to work in.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Optional extra files/folders to read.' },
      model: { type: 'string', description: 'Optional model override.' },
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh', 'max'],
        description: 'Optional reasoning effort override.',
      },
      timeout_minutes: { type: 'number', description: 'Max run time, 1-60 (default 30).' },
    },
    required: ['prompt', 'cwd'],
  },
  handler: ({ prompt, cwd, paths, model, effort, timeout_minutes }) =>
    executeAgyPrompt({
      prompt,
      paths,
      model,
      effort,
      cwd,
      timeoutMinutes: Math.min(Math.max(Math.round(timeout_minutes || 30), 1), 60),
    }),
};

export function createServer() {
  return createMcpServer({
    name: 'antigravity',
    version: '1.0.6',
    tools: [
      configureAntigravityTool,
      askAntigravityTool,
      reviewAntigravityTool,
      brainstormAntigravityTool,
      planAntigravityTool,
      delegateAntigravityTool,
    ],
  });
}
