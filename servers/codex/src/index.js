// H0wZy/mcp — OpenAI Codex MCP Server
// Minimal, DRY bridge exposing OpenAI Codex CLI (GPT-6 family) to any MCP client.

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
  noBridgeArgs,
  validateCwd,
  normalizePaths,
  clampTimeoutMinutes,
} = shared;

const TIMEOUT_MS = 300000; // 5 minutes

// Sandbox per tool kind, set through config overrides so `exec` and `review` both honor it.
// Read-only + never-ask is Codex's documented non-interactive read-only combination.
const ACCESS_OVERRIDES = {
  'read-only': ['-c', 'sandbox_mode=read-only', '-c', 'approval_policy=never'],
  'workspace-write': ['-c', 'sandbox_mode=workspace-write'],
};
const READ_ONLY_EXEC_ARGS = ['--ephemeral', '--skip-git-repo-check'];
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: true };

async function loadCodexCatalog() {
  const codexBin = resolveBinary('codex', 'CODEX_CLI_PATH');
  if (!codexBin) return null;
  const res = await executeProcess(codexBin, ['debug', 'models'], { timeoutMs: 5000, toolName: 'codex' });
  if (!res.ok || !res.stdout) return null;

  try {
    const parsed = JSON.parse(res.stdout);
    const models = Array.isArray(parsed.models) ? parsed.models : Array.isArray(parsed) ? parsed : [];
    return models.map((m) => {
      let tierNote = 'balanced';
      const desc = (m.description || '').toLowerCase();
      if (desc.includes('frontier') || desc.includes('demanding')) {
        tierNote = 'deep';
      } else if (desc.includes('fast') || desc.includes('affordable') || desc.includes('efficient')) {
        tierNote = 'light';
      }

      const efforts = Array.isArray(m.supported_reasoning_levels)
        ? m.supported_reasoning_levels.map((lvl) => (lvl && lvl.effort ? lvl.effort : String(lvl)))
        : ['low', 'medium', 'high', 'xhigh', 'max'];

      return {
        id: m.slug,
        displayName: m.display_name || m.slug,
        efforts,
        defaultEffort: m.default_reasoning_level || 'medium',
        tierNote,
        description: m.description,
        hidden: m.visibility === 'hide',
      };
    });
  } catch {
    return null;
  }
}

export const agentConfig = createAgentConfig({
  provider: 'codex',
  catalogLoader: loadCodexCatalog,
});

async function executeCodexCommand(
  subcommand,
  prompt,
  paths,
  model,
  effort,
  extraArgs = [],
  { cwd, requireCwd = false, access = 'read-only', timeoutMs = TIMEOUT_MS, signal, hop } = {}
) {
  if (!prompt) {
    return { text: 'Missing required argument: prompt', isError: true };
  }

  let workDir;
  let contextPaths;
  try {
    workDir = cwd !== undefined || requireCwd ? validateCwd(cwd) : undefined;
    contextPaths = normalizePaths(paths, workDir);
  } catch (err) {
    return { text: `❌ ${err.message}`, isError: true };
  }

  let snapshot;
  try {
    snapshot = agentConfig.resolveCall({ model, effort });
  } catch (err) {
    return {
      isError: true,
      text: `❌ ${err.message}\n💡 Call configure_codex with action "list" for valid models and efforts, or "reset" to restore the defaults.`,
    };
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

  const withContext = contextPaths.length
    ? `Context files/directories to inspect in full:\n${contextPaths.map((p) => `- ${p.path}`).join('\n')}\n\n${prompt}`
    : prompt;
  // L3: tell the agent where it sits in the chain (spec 006).
  const fullPrompt = hop ? `${hop.notice}\n\n${withContext}` : withContext;

  // For all subcommands, override model and reasoning effort via -c key=value
  const args = [
    '--no-daemon',
    subcommand,
    '-c',
    `model=${snapshot.cliModel}`,
    '-c',
    `model_reasoning_effort=${snapshot.cliEffort}`,
    ...ACCESS_OVERRIDES[access],
    // L1: at the maximum depth, start Codex with its bridge servers switched off.
    ...(hop?.atMaxDepth ? noBridgeArgs('codex') : []),
    '-',
  ];

  if (subcommand === 'exec') {
    // No --add-dir for context paths: it makes a folder *writable* (codex exec --help),
    // and both sandboxes can already read the whole disk.
    args.push('--color', 'never', ...extraArgs);
    if (workDir) args.push('-C', workDir);
  }

  const res = await executeProcess(codexBin, args, {
    cwd: workDir,
    timeoutMs: hop ? hop.capTimeoutMs(timeoutMs) : timeoutMs,
    signal,
    toolName: 'codex',
    input: fullPrompt,
    env: hop?.childEnv,
    onSpawn: hop ? (child) => hop.registerAgent(child.pid) : undefined,
  });
  const footer = agentConfig.formatFooter(snapshot);

  if (res.ok) {
    return {
      text: (res.stdout || '(Codex completed with no output)') + footer,
      isError: false,
    };
  }

  const formatted = formatResilientResponse({
    provider: 'OpenAI Codex',
    rawOutput: res.stderr || res.stdout,
    exitCode: res.exitCode,
  });

  return {
    text: formatted.text + footer,
    isError: true,
    outcome: res.timedOut ? 'timed-out' : 'failed',
  };
}

export const configureCodexTool = {
  name: 'configure_codex',
  description:
    'Inspect or change OpenAI Codex model and reasoning effort for the current session. ' +
    'Supports pre-configured tiers ("light" for quick lookups, "balanced" for routine work, "deep" for complex refactoring/architecture/security), ' +
    'explicit models (e.g. "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-terra"), or custom efforts ("low"|"medium"|"high"|"xhigh"|"max"|"ultra"). ' +
    'Actions: "get" (view active settings), "set" (apply updates), "reset" (restore startup defaults), "list" (catalog & tiers). ' +
    'Claude Code may switch tiers autonomously based on task difficulty.',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
        description: 'Preset tier: "light" (gpt-6-luna low), "balanced" (gpt-6-astra medium), "deep" (gpt-6-astra xhigh).',
      },
      model: {
        type: 'string',
        description: 'Model slug (e.g. "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-terra").',
      },
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        description: 'Reasoning effort level. Automatically mapped to supported levels.',
      },
    },
  },
  handler: (args = {}) => {
    const action = (args.action || 'get').toLowerCase();

    if (action === 'get') {
      const state = agentConfig.get();
      return (
        `⚙️ [OpenAI Codex Active Configuration]\n` +
        `Model:  ${state.active.model}\n` +
        `Effort: ${state.active.effort}` +
        (state.active.tier ? ` (Tier: ${state.active.tier})` : '') +
        `\nSource: ${state.active.source}\n\n` +
        JSON.stringify(state, null, 2)
      );
    }

    if (action === 'set') {
      let updated;
      try {
        updated = agentConfig.set(args);
      } catch (err) {
        return { isError: true, text: `❌ ${err.message}\nNothing was changed. Use action "list" to see valid models, efforts and tiers.` };
      }
      let summary =
        `⚙️ [OpenAI Codex Configuration Updated]\n` +
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
        `🔄 [OpenAI Codex Configuration Reset to Startup Defaults]\n` +
        `Active: ${resetState.active.model} (effort: ${resetState.active.effort}, source: startup)\n\n` +
        JSON.stringify(resetState, null, 2)
      );
    }

    if (action === 'list') {
      const catalog = agentConfig.list();
      return (
        `📋 [OpenAI Codex Model Catalog & Tiers]\n` +
        `Catalog Source: ${catalog.catalogSource} (status: ${catalog.catalogStatus})\n\n` +
        JSON.stringify(catalog, null, 2)
      );
    }

    throw new Error(`Unsupported action '${action}'. Valid actions: get, set, reset, list`);
  },
};

export const askCodexTool = {
  name: 'ask_codex',
  spawnsAgent: true,
  description:
    'Ask OpenAI Codex CLI for an independent second opinion, reasoning check, or advice (read-only sandbox). ' +
    'Uses session-configured model & effort by default (configure via configure_codex). ' +
    'Provide a `prompt`; optionally pass `paths`, `model`, or `effort`.',
  annotations: READ_ONLY_ANNOTATIONS,
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
        description: 'Optional model override (e.g. "gpt-6-astra", "gpt-6-sol", "gpt-6-luna").',
      },
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        description: 'Optional reasoning effort override ("low"|"medium"|"high"|"xhigh"|"max"|"ultra").',
      },
    },
    required: ['prompt'],
  },
  handler: ({ prompt, paths, model, effort }, ctx) =>
    executeCodexCommand(
      'exec',
      prompt,
      paths,
      model,
      effort,
      READ_ONLY_EXEC_ARGS,
      { signal: ctx?.signal, hop: ctx?.hop }
    ),
};

export const reviewCodexTool = {
  name: 'review_codex',
  spawnsAgent: true,
  description:
    'Run a structured code review using OpenAI Codex CLI against the current repository or specified files (read-only sandbox). ' +
    'Uses session-configured model & effort by default (configure via configure_codex).',
  annotations: READ_ONLY_ANNOTATIONS,
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
        description: 'Optional model override (e.g. "gpt-6-astra", "gpt-6-sol").',
      },
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        description: 'Optional reasoning effort override.',
      },
    },
    required: ['prompt'],
  },
  handler: ({ prompt, paths, model, effort }, ctx) =>
    executeCodexCommand('review', prompt, paths, model, effort, [], { signal: ctx?.signal, hop: ctx?.hop }),
};

export const brainstormCodexTool = {
  name: 'brainstorm_codex',
  spawnsAgent: true,
  description:
    'Architectural brainstorming and ideation using OpenAI Codex. ' +
    'Explores alternative patterns, system trade-offs, and design approaches. ' +
    'Configure model and effort via configure_codex.',
  annotations: READ_ONLY_ANNOTATIONS,
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
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        description: 'Optional reasoning effort override.',
      },
    },
    required: ['prompt'],
  },
  handler: ({ prompt, paths, model, effort }, ctx) =>
    executeCodexCommand(
      'exec',
      `You are an enterprise software architect. Analyze the problem, brainstorm 2-3 viable architectural alternatives, outline trade-offs and pros/cons for each, and recommend the best path forward.\n\nProblem: ${prompt}`,
      paths,
      model,
      effort,
      READ_ONLY_EXEC_ARGS,
      { signal: ctx?.signal, hop: ctx?.hop }
    ),
};

export const planCodexTool = {
  name: 'plan_codex',
  spawnsAgent: true,
  description:
    'Generate a structured, step-by-step implementation plan or execution checklist using OpenAI Codex. ' +
    'Configure model and effort via configure_codex.',
  annotations: READ_ONLY_ANNOTATIONS,
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
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        description: 'Optional reasoning effort override.',
      },
    },
    required: ['prompt'],
  },
  handler: ({ prompt, paths, model, effort }, ctx) =>
    executeCodexCommand(
      'exec',
      `You are a lead technical planner. Break down the requested goal into structured, dependency-ordered, verifiable implementation tasks with concrete file paths and test steps.\n\nGoal: ${prompt}`,
      paths,
      model,
      effort,
      READ_ONLY_EXEC_ARGS,
      { signal: ctx?.signal, hop: ctx?.hop }
    ),
};

export const delegateCodexTool = {
  name: 'delegate_codex',
  spawnsAgent: true,
  description:
    'Hand a self-contained implementation task to OpenAI Codex, which EDITS FILES inside `cwd` ' +
    '(workspace-write sandbox, approvals routed to automatic review). Review the diff afterwards. Returns the final report from Codex. ' +
    'Configure model and effort via configure_codex.',
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'The task: goal, files it may touch, acceptance checks, what to report.' },
      cwd: { type: 'string', description: 'Absolute path of the repository or folder to work in.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Optional extra files/folders to read.' },
      model: { type: 'string', description: 'Optional model override.' },
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        description: 'Optional reasoning effort override.',
      },
      timeout_minutes: { type: 'number', description: 'Max run time, 1-60 (default 30).' },
    },
    required: ['prompt', 'cwd'],
  },
  handler: ({ prompt, cwd, paths, model, effort, timeout_minutes }, ctx) =>
    executeCodexCommand('exec', prompt, paths, model, effort, ['--ephemeral', '--skip-git-repo-check', '--approve-for-me'], {
      cwd,
      requireCwd: true,
      access: 'workspace-write',
      timeoutMs: clampTimeoutMinutes(timeout_minutes) * 60000,
      signal: ctx?.signal,
      hop: ctx?.hop,
    }),
};

export function createServer() {
  return createMcpServer({
    name: 'codex',
    version: '1.0.6',
    tools: [
      configureCodexTool,
      askCodexTool,
      reviewCodexTool,
      brainstormCodexTool,
      planCodexTool,
      delegateCodexTool,
    ],
  });
}
