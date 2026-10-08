// H0wZy/mcp — Claude Code MCP Server
// Lets Codex, Antigravity or any MCP client consult and delegate to Claude Code (spec 006).
// Contract: specs/006-bidirectional-agent-mesh/contracts/claude-bridge.md

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
  createConfigureTool,
  claudeMcpArgs,
  parseClaudeResult,
  claudeChildEnv,
  claudeCapArgs,
  validateCwd,
  normalizePaths,
  clampTimeoutMinutes,
} = shared;

const READ_ONLY_TIMEOUT_MINUTES = 10;
const READ_ONLY_TOOLS = 'Read,Grep,Glob';
const DELEGATE_PERMISSION_MODES = ['acceptEdits', 'auto', 'dontAsk'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: true };


export const agentConfig = createAgentConfig({ provider: 'claude' });

/**
 * Developer-set caps and options, read on every call so a changed environment applies.
 * @param {NodeJS.ProcessEnv} env
 */
function developerOptions(env = process.env) {
  const { args, warnings } = claudeCapArgs(env);
  let permissionMode = 'acceptEdits';
  const requested = String(env.CLAUDE_BRIDGE_DELEGATE_PERMISSION_MODE ?? '').trim();
  if (requested) {
    if (DELEGATE_PERMISSION_MODES.includes(requested)) permissionMode = requested;
    else warnings.push(`CLAUDE_BRIDGE_DELEGATE_PERMISSION_MODE='${requested}' is not one of ${DELEGATE_PERMISSION_MODES.join(', ')}; using acceptEdits`);
  }
  return { capArgs: args, permissionMode, warnings };
}

function capMessage(subtype) {
  if (subtype === 'error_max_turns') return 'Stopped: the turn cap set by CLAUDE_BRIDGE_MAX_TURNS was reached.';
  if (typeof subtype === 'string' && subtype.includes('budget')) return 'Stopped: the spending cap set by CLAUDE_BRIDGE_MAX_BUDGET_USD was reached.';
  return '';
}

async function executeClaude({ prompt, prefix = '', paths, model, effort, cwd, delegate = false, timeoutMinutes, signal, hop }) {
  if (!prompt) {
    return { text: 'Missing required argument: prompt', isError: true };
  }

  let workDir;
  let contextPaths;
  try {
    workDir = cwd !== undefined || delegate ? validateCwd(cwd) : undefined;
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
      text: `❌ ${err.message}\n💡 Call configure_claude with action "list" for valid models and efforts, or "reset" to restore the defaults.`,
    };
  }

  const claudeBin = resolveBinary('claude', 'CLAUDE_CLI_PATH');
  if (!claudeBin) {
    return {
      isError: true,
      text:
        '❌ Claude Code CLI (`claude`) not found on system.\n' +
        'Please ensure Claude Code is installed:\n' +
        '  - Native installer: https://code.claude.com/docs/en/setup\n' +
        '  - Or: npm install -g @anthropic-ai/claude-code\n' +
        'Or set CLAUDE_CLI_PATH to its absolute path.',
    };
  }

  const { capArgs, permissionMode, warnings } = developerOptions();

  // Folders Claude may read (read-only) or also edit (delegate): each context path's folder.
  const dirs = [];
  for (const p of contextPaths) {
    if (p.isDir === null) continue;
    const dir = p.isDir ? p.path : dirname(p.path);
    if (dir !== workDir && !dirs.includes(dir)) dirs.push(dir);
  }

  const formatted = prefix ? `${prefix}\n\n${prompt}` : prompt;
  const withContext = contextPaths.length
    ? `Context files/folders to read and consider in full:\n${contextPaths.map((p) => `- ${p.path}`).join('\n')}\n\n${formatted}`
    : formatted;
  // L3: tell Claude where it sits in the chain (spec 006).
  const fullPrompt = hop ? `${hop.notice}\n\n${withContext}` : withContext;

  const args = ['-p', '--output-format', 'json', '--model', snapshot.cliModel];
  if (snapshot.cliEffort) args.push('--effort', snapshot.cliEffort);
  // Nobody can answer a permission prompt: anything that would ask is denied.
  args.push('--permission-prompts', 'none');
  if (delegate) {
    args.push('--permission-mode', permissionMode);
  } else {
    // Only reading tools exist in a read-only session, and it is not kept as a resumable session.
    args.push('--tools', READ_ONLY_TOOLS, '--no-session-persistence');
  }
  for (const dir of dirs) args.push('--add-dir', dir);
  args.push(...capArgs);
  // FR-026: only the mesh bridges, not every MCP server the user configured; none at
  // the maximum depth (L1).
  // Without a cwd the child runs in this server's folder, so that is the local scope.
  const mcp = claudeMcpArgs({ atMaxDepth: hop?.atMaxDepth, cwd: workDir ?? process.cwd(), readOnly: !delegate });
  args.push(...mcp.args);

  const minutes = delegate ? timeoutMinutes : READ_ONLY_TIMEOUT_MINUTES;
  const timeoutMs = minutes * 60000;
  let res;
  try {
    res = await executeProcess(claudeBin, args, {
      cwd: workDir,
      timeoutMs: hop ? hop.capTimeoutMs(timeoutMs) : timeoutMs,
      signal,
      toolName: 'claude',
      input: fullPrompt,
      env: claudeChildEnv(hop?.childEnv),
      onSpawn: hop ? (child) => hop.registerAgent(child.pid) : undefined,
    });
  } finally {
    mcp.cleanup();
  }

  const parsed = parseClaudeResult(res.stdout);
  const footerSnapshot = warnings.length ? { ...snapshot, warnings: [...snapshot.warnings, ...warnings] } : snapshot;
  const footer = agentConfig.formatFooter(footerSnapshot, {
    cost: parsed.cost !== undefined ? `$${parsed.cost.toFixed(4)}` : undefined,
    turns: parsed.turns,
  });
  const cap = capMessage(parsed.subtype);

  if (res.ok && !parsed.isError) {
    return {
      text: (parsed.text || '(Claude Code completed with no output)') + footer,
      isError: false,
    };
  }

  const formattedError = formatResilientResponse({
    provider: 'Claude Code',
    rawOutput: [res.stderr, parsed.errors.join('\n'), parsed.json ? parsed.text : res.stdout].filter(Boolean).join('\n\n'),
    exitCode: res.exitCode,
  });
  return {
    text: (cap ? `${cap}\n` : '') + formattedError.text + footer,
    isError: true,
    outcome: res.timedOut ? 'timed-out' : 'failed',
  };
}

const PATHS_SCHEMA = {
  type: 'array',
  items: { type: 'string' },
  description: 'Optional files or folders to read as context (Claude gets read access to their folders).',
};
const MODEL_SCHEMA = {
  type: 'string',
  description: 'Optional model override: an alias ("opus", "sonnet", "haiku", "fable") or a full id (e.g. "claude-opus-5-5").',
};
const EFFORT_SCHEMA = {
  type: 'string',
  enum: EFFORTS,
  description: 'Optional reasoning effort override ("low"|"medium"|"high"|"xhigh"|"max"). Ignored for the pinned Haiku 4.5 id.',
};

function readOnlyTool({ name, description, promptDescription, prefix }) {
  return {
    name,
    spawnsAgent: true,
    description,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: promptDescription },
        paths: PATHS_SCHEMA,
        model: MODEL_SCHEMA,
        effort: EFFORT_SCHEMA,
      },
      required: ['prompt'],
    },
    handler: ({ prompt, paths, model, effort }, ctx) =>
      executeClaude({ prompt, prefix, paths, model, effort, signal: ctx?.signal, hop: ctx?.hop }),
  };
}

export const configureClaudeTool = createConfigureTool({
  name: 'configure_claude',
  label: 'Claude Code',
  agentConfig,
  description:
    'Inspect or change the Claude Code model and reasoning effort for the current session. ' +
    'Supports pre-configured tiers ("light" = sonnet low for quick checks, "balanced" = opus medium for routine work, "deep" = fable high for hard bugs, architecture and security), ' +
    'explicit models (aliases "opus", "sonnet", "haiku", "fable" or full ids like "claude-opus-5-5"), or custom efforts ("low"|"medium"|"high"|"xhigh"|"max"). ' +
    'Actions: "get" (view active settings), "set" (apply updates), "reset" (restore startup defaults), "list" (catalog & tiers).',
  tierDescription: 'Preset tier: "light" (sonnet low), "balanced" (opus medium), "deep" (fable high).',
  modelDescription: 'Model alias ("opus", "sonnet", "haiku", "fable") or full id (e.g. "claude-opus-5-5").',
  efforts: EFFORTS,
});

export const askClaudeTool = readOnlyTool({
  name: 'ask_claude',
  description:
    'Ask Claude Code (Anthropic) for an independent second opinion, explanation or reasoning check. ' +
    'Read-only: Claude can only read, search and list files (no edits, no shell). ' +
    'Default model: opus at medium effort (configure via configure_claude). ' +
    'Provide a `prompt`; optionally pass `paths`, `model`, or `effort`.',
  promptDescription: 'The question, proposal or verification request.',
});

export const reviewClaudeTool = readOnlyTool({
  name: 'review_claude',
  description:
    'Request a thorough, structured code review from Claude Code: correctness, edge cases, race conditions, security, performance and architecture. ' +
    'Read-only (no edits, no shell): pass the files to review in `paths`. Use tier "deep" via configure_claude for complex security or architecture reviews.',
  promptDescription: 'Review focus areas or instructions.',
  prefix:
    'You are performing a comprehensive code review. Focus on bug detection, race conditions, ' +
    'security issues, performance bottlenecks, and architectural clarity. Provide specific recommendations or diffs where helpful.',
});

export const brainstormClaudeTool = readOnlyTool({
  name: 'brainstorm_claude',
  description:
    'Architectural brainstorming with Claude Code: 2-3 viable alternatives, their trade-offs, and a recommendation. Read-only (no edits, no shell).',
  promptDescription: 'The architectural challenge, feature design or problem to explore.',
  prefix:
    'You are an enterprise software architect. Analyze the problem, brainstorm 2-3 viable architectural alternatives, ' +
    'outline trade-offs and pros/cons for each, and recommend the best path forward.',
});

export const planClaudeTool = readOnlyTool({
  name: 'plan_claude',
  description:
    'Have Claude Code write a dependency-ordered implementation plan with concrete file paths and test steps. Read-only (no edits, no shell).',
  promptDescription: 'The goal to plan.',
  prefix:
    'You are a lead technical planner. Break down the requested goal into structured, dependency-ordered, ' +
    'verifiable implementation tasks with concrete file paths and test steps.',
});

export const delegateClaudeTool = {
  name: 'delegate_claude',
  spawnsAgent: true,
  description:
    'Hand a self-contained implementation task to Claude Code, which EDITS FILES inside `cwd` (and folders passed in `paths`). ' +
    'File edits are auto-approved; anything else that would need approval (e.g. shell commands the user has not allowed) is denied, so the run never waits on a prompt. ' +
    'Review the diff afterwards. Returns Claude\'s final report. Configure model and effort via configure_claude.',
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'The task: goal, files it may touch, acceptance checks, what to report.' },
      cwd: { type: 'string', description: 'Absolute path of the repository or folder to work in.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Optional extra files/folders to read (their folders also become editable).' },
      model: MODEL_SCHEMA,
      effort: EFFORT_SCHEMA,
      timeout_minutes: { type: 'number', description: 'Max run time, 1-60 (default 30).' },
    },
    required: ['prompt', 'cwd'],
  },
  handler: ({ prompt, cwd, paths, model, effort, timeout_minutes }, ctx) =>
    executeClaude({
      prompt,
      paths,
      model,
      effort,
      cwd,
      delegate: true,
      timeoutMinutes: clampTimeoutMinutes(timeout_minutes),
      signal: ctx?.signal,
      hop: ctx?.hop,
    }),
};

export function createServer() {
  return createMcpServer({
    name: 'claude',
    version: '1.0.7',
    tools: [configureClaudeTool, askClaudeTool, reviewClaudeTool, brainstormClaudeTool, planClaudeTool, delegateClaudeTool],
  });
}
