// H0wZy/mcp — Antigravity MCP Server
// Minimal, DRY bridge exposing Google Antigravity (Gemini 3.8 Flash / Pro) to any MCP client.

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
  sanitizeOutput,
  createAgentConfig,
  createConfigureTool,
  noBridgeArgs,
  validateCwd,
  normalizePaths,
  clampTimeoutMinutes,
  createAgyLog,
  hitPrintTimeout,
  stuckMcpServers,
  stuckServersHint,
} = shared;

// Print mode soft-denies edits in read-only calls; telling the model up front saves the
// turns it would spend trying.
const READ_ONLY_NOTICE =
  'Read-only request: do not create, edit or delete files and do not run commands that change anything. ' +
  'Those actions are blocked here and only waste time. If a change is needed, describe it in your answer.';
const STDERR_NOTICE_CHARS = 1500;
// agy needs ~25 s around --print-timeout to start (CLI, sign-in, MCP servers) and to
// return its partial output; the process limit leaves room for that.
const PRINT_TIMEOUT_GRACE_MS = 60000;
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: true };

async function loadAgyCatalog() {
  const agyBin = resolveBinary('agy', 'AGY_BIN');
  if (!agyBin) return null;
  // `agy models` takes ~20 s (spec 005 research R3). Loading runs in the background,
  // so a realistic timeout costs callers nothing; they use the curated list meanwhile.
  const res = await executeProcess(agyBin, ['models'], { timeoutMs: 40000, toolName: 'agy' });
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
  catalogTimeoutMs: 45000,
});

// Without --dangerously-skip-permissions, print mode soft-denies every action that
// needs approval (file edits, and shell commands or MCP tools the user hasn't allowed):
// the run goes on, exits 0 and names the skipped tool on stderr
// (https://antigravity.google/docs/cli/headless/). Only delegate_* auto-approves.
async function executeAgyPrompt({
  prompt,
  prefix = '',
  paths,
  model,
  effort,
  cwd,
  requireCwd = false,
  autoApprove = false,
  timeoutMinutes = 5,
  signal,
  hop,
}) {
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
      text: `❌ ${err.message}\n💡 Call configure_antigravity with action "list" for valid models and efforts, or "reset" to restore the defaults.`,
    };
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

  const dirs = new Set(workDir ? [workDir] : []);
  for (const p of contextPaths) {
    if (p.isDir !== null) dirs.add(p.isDir ? p.path : dirname(p.path));
  }

  const formattedPrompt = prefix ? `${prefix}\n\n${prompt}` : prompt;
  const withContext = contextPaths.length
    ? `Context files/folders to read and consider in full:\n${contextPaths.map((p) => `- ${p.path}`).join('\n')}\n\n${formattedPrompt}`
    : formattedPrompt;
  const guarded = autoApprove ? withContext : `${READ_ONLY_NOTICE}\n\n${withContext}`;
  // L3: tell the agent where it sits in the chain (spec 006).
  const fullPrompt = hop ? `${hop.notice}\n\n${guarded}` : guarded;
  // A child never outlives its chain: cap the run, rounded down to whole minutes.
  const minutes = hop ? Math.max(1, Math.min(timeoutMinutes, Math.floor(hop.remainingMs() / 60000))) : timeoutMinutes;

  const args = [
    '-p',
    fullPrompt,
    '--model',
    snapshot.cliModel,
    '--print-timeout',
    `${minutes}m`,
  ];

  // L1: agy has no per-call MCP switch; at least stop prompt-driven skill expansion.
  if (hop?.atMaxDepth) args.push(...noBridgeArgs('antigravity'));

  if (autoApprove) args.push('--dangerously-skip-permissions');

  if (snapshot.cliEffort) {
    args.push('--effort', snapshot.cliEffort);
  }

  for (const d of dirs) args.push('--add-dir', d);

  // A private log explains a run that never started (an MCP server that can't connect).
  const log = createAgyLog();
  args.push('--log-file', log.file);

  let res;
  let hint = '';
  try {
    // Outlive --print-timeout so agy can return its partial output itself, but never
    // the chain's deadline.
    const limitMs = minutes * 60000 + PRINT_TIMEOUT_GRACE_MS;
    res = await executeProcess(agyBin, args, {
      cwd: workDir,
      timeoutMs: hop ? hop.capTimeoutMs(limitMs) : limitMs,
      signal,
      toolName: 'agy',
      env: hop?.childEnv,
      onSpawn: hop ? (child) => hop.registerAgent(child.pid) : undefined,
    });
    if (res.timedOut || hitPrintTimeout(res.stderr)) hint = stuckServersHint(stuckMcpServers(log.read()));
  } finally {
    log.cleanup();
  }

  const footer = agentConfig.formatFooter(snapshot);

  // agy exits 0 after its own --print-timeout, with whatever it had (often nothing).
  if (!res.cancelled && (res.timedOut || hitPrintTimeout(res.stderr))) {
    const partial = sanitizeOutput(res.stdout || '').trim();
    return {
      text:
        (partial ? `${partial}\n\n⏱️ Antigravity did not finish within ${minutes} min; the answer above is partial.` : `⏱️ Antigravity did not finish within ${minutes} min and returned no answer.`) +
        (hint ? `\n${hint}` : '') +
        footer,
      isError: true,
      outcome: 'timed-out',
    };
  }

  if (res.ok) {
    // Read-only runs report soft-denied actions on stderr; pass that on so the caller
    // knows the answer may be incomplete and how the user can allow the action.
    const notices = !autoApprove && res.stderr ? sanitizeOutput(res.stderr).slice(-STDERR_NOTICE_CHARS) : '';
    return {
      text:
        (res.stdout || '(Antigravity completed with no output)') +
        (notices ? `\n\n⚠️ Antigravity notices (stderr):\n${notices}` : '') +
        footer,
      isError: false,
    };
  }

  const formatted = formatResilientResponse({
    provider: 'Google Antigravity',
    // Keep any partial answer next to the error.
    rawOutput: [res.stderr, res.stdout].filter(Boolean).join('\n\n'),
    exitCode: res.exitCode,
  });

  return {
    text: formatted.text + footer,
    isError: true,
    outcome: res.timedOut ? 'timed-out' : 'failed',
  };
}

export const configureAntigravityTool = createConfigureTool({
  name: 'configure_antigravity',
  label: 'Google Antigravity',
  agentConfig,
  description:
    'Inspect or change Google Antigravity model and reasoning effort for the current session. ' +
    'Supports pre-configured tiers ("light" for trivial tasks, "balanced" for routine work, "deep" for hard bugs/complex architecture/security), ' +
    'explicit models (e.g. "gemini-3.8-flash", "gemini-3.1-pro"), or custom efforts ("low"|"medium"|"high"|"xhigh"|"max"). ' +
    'Actions: "get" (view active settings), "set" (apply updates), "reset" (restore startup defaults), "list" (catalog & tiers). ' +
    'Claude Code may switch tiers autonomously based on task difficulty.',
  tierDescription: 'Preset tier: "light" (Flash Low), "balanced" (Flash Medium), "deep" (Flash High).',
  modelDescription: 'Model family or variant identifier (e.g. "gemini-3.8-flash", "gemini-3.1-pro").',
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
});

export const askAntigravityTool = {
  name: 'ask_antigravity',
  spawnsAgent: true,
  description:
    'Get an INDEPENDENT second opinion or answer from Google Antigravity ' +
    '(default model: Gemini 3.8 Flash High; configure via configure_antigravity). ' +
    'A different model family than Claude or OpenAI, ensuring an unbiased cross-check. ' +
    'Provide a `prompt`; optionally pass `paths`, `model`, or `effort`.',
  annotations: READ_ONLY_ANNOTATIONS,
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
  handler: ({ prompt, paths, model, effort }, ctx) =>
    executeAgyPrompt({ prompt, paths, model, effort, signal: ctx?.signal, hop: ctx?.hop }),
};

export const reviewAntigravityTool = {
  name: 'review_antigravity',
  spawnsAgent: true,
  description:
    'Request a thorough, structured code review from Google Antigravity (default model: Gemini 3.8 Flash High). ' +
    'Inspects code correctness, edge cases, race conditions, security vulnerabilities, performance, and architecture. ' +
    'Use tier "deep" via configure_antigravity for complex security/architecture reviews. ' +
    'Read-only: it cannot edit files, and shell commands the user has not allowed are skipped, so pass the files to review in `paths`.',
  annotations: READ_ONLY_ANNOTATIONS,
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
  handler: ({ prompt, paths, model, effort }, ctx) =>
    executeAgyPrompt({
      prompt,
      paths,
      model,
      effort,
      signal: ctx?.signal,
      hop: ctx?.hop,
      prefix:
        'You are performing a comprehensive code review. Focus on bug detection, race conditions, ' +
        'security issues, performance bottlenecks, and architectural clarity. Provide specific recommendations or diffs where helpful.',
    }),
};

export const brainstormAntigravityTool = {
  name: 'brainstorm_antigravity',
  spawnsAgent: true,
  description:
    'Architectural brainstorming and exploration with Google Antigravity. ' +
    'Explores alternative design patterns, trade-offs, scalability considerations, and pros/cons. ' +
    'Configure model and effort via configure_antigravity.',
  annotations: READ_ONLY_ANNOTATIONS,
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
  handler: ({ prompt, paths, model, effort }, ctx) =>
    executeAgyPrompt({
      prompt,
      paths,
      model,
      effort,
      signal: ctx?.signal,
      hop: ctx?.hop,
      prefix:
        'You are a software architect exploring system design options. Analyze the given problem, ' +
        'brainstorm 2-3 viable architectural alternatives, outline trade-offs and pros/cons for each, and recommend the best path forward.',
    }),
};

export const planAntigravityTool = {
  name: 'plan_antigravity',
  spawnsAgent: true,
  description:
    'Generate a step-by-step implementation plan or execution checklist using Google Antigravity. ' +
    'Configure model and effort via configure_antigravity.',
  annotations: READ_ONLY_ANNOTATIONS,
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
  handler: ({ prompt, paths, model, effort }, ctx) =>
    executeAgyPrompt({
      prompt,
      paths,
      model,
      effort,
      signal: ctx?.signal,
      hop: ctx?.hop,
      prefix:
        'You are a lead technical planner. Break down the requested goal into structured, ' +
        'dependency-ordered, verifiable implementation tasks with concrete file paths and test steps.',
    }),
};

export const delegateAntigravityTool = {
  name: 'delegate_antigravity',
  spawnsAgent: true,
  description:
    'Hand a self-contained implementation task to Google Antigravity, which EDITS FILES inside `cwd` ' +
    '(permissions skipped). Review the diff afterwards. Returns the final report from Antigravity. ' +
    'Configure model and effort via configure_antigravity.',
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
        enum: ['low', 'medium', 'high', 'xhigh', 'max'],
        description: 'Optional reasoning effort override.',
      },
      timeout_minutes: { type: 'number', description: 'Max run time, 1-60 (default 30).' },
    },
    required: ['prompt', 'cwd'],
  },
  handler: ({ prompt, cwd, paths, model, effort, timeout_minutes }, ctx) =>
    executeAgyPrompt({
      prompt,
      paths,
      model,
      effort,
      cwd,
      requireCwd: true,
      autoApprove: true,
      timeoutMinutes: clampTimeoutMinutes(timeout_minutes),
      signal: ctx?.signal,
      hop: ctx?.hop,
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
