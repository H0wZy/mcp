// H0wZy/mcp — One teammate turn per vendor CLI (spec 007, research D2).
// buildTurn() makes the command line, parseTurn() reads the answer back.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolveBinary } from '../resolver.js';
import { noBridgeArgs } from '../l1.js';
import { claudeMcpArgs, codexMcpArgs } from '../mcp-scope.js';
import { claudeCapArgs, claudeChildEnv, parseClaudeResult } from '../claude.js';
import { hitPrintTimeout, invalidSchemaHint, parseAgyEnvelope, readLogTail, stuckMcpServers, stuckServersHint } from '../agy.js';

export const TEAM_AGENTS = ['claude', 'codex', 'antigravity'];

const BINARIES = {
  claude: ['claude', 'CLAUDE_CLI_PATH'],
  codex: ['codex', 'CODEX_CLI_PATH'],
  antigravity: ['agy', 'AGY_BIN'],
};

export const MAX_ARGV_PROMPT = process.platform === 'win32' ? 24000 : 100000;

/** Keeps the head (role, task) and tail (report format) of a prompt that is too long. */
export function fitArgv(prompt, max = MAX_ARGV_PROMPT) {
  if (prompt.length <= max) return prompt;
  const marker = `\n\n[… ${prompt.length - max} characters cut to fit the command line …]\n\n`;
  const keep = max - marker.length;
  const head = Math.ceil(keep * 0.6);
  return prompt.slice(0, head) + marker + prompt.slice(prompt.length - (keep - head));
}

const INSTALL_HINTS = {
  claude: 'Install Claude Code (https://code.claude.com/docs/en/setup) or set CLAUDE_CLI_PATH.',
  codex: 'Install the Codex CLI (npm install -g @openai/codex) or set CODEX_CLI_PATH.',
  antigravity: 'Install the Antigravity CLI (https://antigravity.google/cli) or set AGY_BIN.',
};

/**
 * Builds one turn's command line.
 *
 * @param {Object} options
 * @param {{ agent: string, cliModel: string, cliEffort: string|null, canEdit: boolean, workDir: string, sessionId: string|null }} options.member
 * @param {string} options.prompt
 * @param {{ atMaxDepth: boolean, childEnv: object } | null} [options.hop]
 * @param {string} [options.outputFile] Codex writes its last message here
 * @param {string} [options.logFile] agy writes its log here (explains a stuck turn)
 * @param {number} [options.minutes] Turn limit, for agy's --print-timeout
 * @param {string} [options.projectDir] The team's project folder, for Claude Code's local-scope MCP servers
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{ ok: true, command: string, args: string[], input?: string, cwd: string, env: object, sessionId: string|null, warnings: string[], cleanup: () => void } | { ok: false, error: string }}
 */
export function buildTurn({ member, prompt, hop = null, outputFile, logFile, minutes = 20, env = process.env, projectDir }) {
  const [bin, override] = BINARIES[member.agent] || [];
  if (!bin) return { ok: false, error: `Unknown agent '${member.agent}'. Use one of: ${TEAM_AGENTS.join(', ')}.` };
  const command = resolveBinary(bin, override);
  if (!command) return { ok: false, error: `\`${bin}\` not found. ${INSTALL_HINTS[member.agent]}` };

  const atMaxDepth = Boolean(hop?.atMaxDepth);
  const chainEnv = hop?.childEnv || {};
  const noCleanup = () => {};

  if (member.agent === 'claude') {
    const { args: caps, warnings } = claudeCapArgs(env);
    const args = ['-p', '--output-format', 'json', '--model', member.cliModel];
    if (member.cliEffort) args.push('--effort', member.cliEffort);
    args.push('--permission-prompts', 'none');
    if (member.canEdit) args.push('--permission-mode', 'acceptEdits');
    else args.push('--tools', 'Read,Grep,Glob');
    let sessionId = member.sessionId;
    if (sessionId) {
      args.push('--resume', sessionId);
    } else {
      sessionId = randomUUID();
      args.push('--session-id', sessionId);
    }
    // FR-026 (spec 006): only the mesh bridges; none at the maximum depth.
    // Local scope belongs to the project, not to the teammate's worktree under ~/.h0wzy-mcp.
    const mcp = claudeMcpArgs({ atMaxDepth, cwd: projectDir || member.workDir, env, readOnly: !member.canEdit });
    args.push(...caps, ...mcp.args);
    return { ok: true, command, args, input: prompt, cwd: member.workDir, env: claudeChildEnv(chainEnv), sessionId, warnings, cleanup: mcp.cleanup };
  }

  if (member.agent === 'codex') {
    const access = member.canEdit
      ? ['-c', 'sandbox_mode=workspace-write']
      : ['-c', 'sandbox_mode=read-only', '-c', 'approval_policy=never'];
    const args = [
      '--no-daemon',
      'exec',
      '-c',
      `model=${member.cliModel}`,
      '-c',
      `model_reasoning_effort=${member.cliEffort}`,
      ...access,
      ...codexMcpArgs({ atMaxDepth, env, readOnly: !member.canEdit }),
      '-',
      '--color',
      'never',
      '--skip-git-repo-check',
      ...(member.canEdit ? ['--approve-for-me'] : ['--ephemeral']),
    ];
    if (outputFile) args.push('-o', outputFile);
    args.push('-C', member.workDir);
    // Codex has no verified resume path here: earlier turns travel in the prompt.
    return { ok: true, command, args, input: prompt, cwd: member.workDir, env: chainEnv, sessionId: null, warnings: [], cleanup: noCleanup };
  }

  // antigravity: agy reads the prompt from -p (no text stdin mode), and a command line
  // is limited (32,767 chars on Windows), so the middle of a huge prompt is cut.
  const args = ['-p', fitArgv(prompt), '--model', member.cliModel];
  if (member.cliEffort) args.push('--effort', member.cliEffort);
  args.push('--print-timeout', `${Math.max(1, Math.floor(minutes))}m`, '--output-format', 'json');
  if (member.canEdit) args.push('--dangerously-skip-permissions');
  if (member.sessionId) args.push('--conversation', member.sessionId);
  if (logFile) args.push('--log-file', logFile);
  // L1: agy has no per-call MCP switch; at least stop prompt-driven skill expansion.
  if (atMaxDepth) args.push(...noBridgeArgs('antigravity'));
  return { ok: true, command, args, cwd: member.workDir, env: chainEnv, sessionId: member.sessionId, warnings: [], cleanup: noCleanup };
}

/**
 * Reads a finished turn.
 *
 * @param {string} agent
 * @param {{ ok: boolean, stdout: string, stderr: string, exitCode: number, timedOut: boolean }} res executeProcess result
 * @param {{ outputFile?: string, logFile?: string, sessionId?: string|null }} [options]
 * @returns {{ ok: boolean, text: string, sessionId: string|null, usage: { costUsd?: number, inputTokens?: number, outputTokens?: number }, error: string|null }}
 */
export function parseTurn(agent, res, { outputFile, logFile, sessionId = null } = {}) {
  const fail = (error, text = '') => ({ ok: false, text, sessionId, usage: {}, error });
  if (res.timedOut) return fail(withStuckServers('the turn timed out', agent, logFile), res.stdout);

  if (agent === 'claude') {
    const parsed = parseClaudeResult(res.stdout);
    const usage = parsed.cost !== undefined ? { costUsd: parsed.cost } : {};
    const sid = parsed.sessionId || sessionId;
    if (!res.ok || parsed.isError) {
      const reason = res.stderr || parsed.errors.join('; ') || parsed.subtype || parsed.text || `exit code ${res.exitCode}`;
      return { ok: false, text: parsed.text, sessionId: sid, usage, error: reason.slice(0, 2000) };
    }
    return { ok: true, text: parsed.text, sessionId: sid, usage, error: null };
  }

  if (agent === 'codex') {
    let text = '';
    if (outputFile) {
      try {
        text = readFileSync(outputFile, 'utf8').trim();
      } catch {
        /* fall back to stdout */
      }
    }
    if (!text) text = res.stdout;
    if (!res.ok) return fail((res.stderr || `exit code ${res.exitCode}`).slice(0, 2000), text);
    return { ok: true, text, sessionId: null, usage: {}, error: null };
  }

  const data = parseAgyEnvelope(res.stdout);
  const text = data ? String(data.response ?? '') : res.stdout;
  const sid = (data && typeof data.conversation_id === 'string' && data.conversation_id) || sessionId;
  const usage = data?.usage
    ? { inputTokens: Number(data.usage.input_tokens) || 0, outputTokens: Number(data.usage.output_tokens) || 0 }
    : {};
  // agy exits 0 at its own --print-timeout and still reports status "SUCCESS".
  if (hitPrintTimeout(res.stderr)) {
    return { ok: false, text, sessionId: sid, usage, error: withStuckServers("the turn hit agy's --print-timeout", agent, logFile) };
  }
  const error = data?.error ? (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)) : null;
  if (!res.ok || error) {
    const reason = error || res.stderr || `exit code ${res.exitCode}`;
    // The hint goes first: the lead sees the first line of a failure.
    const hint = invalidSchemaHint(reason);
    return { ok: false, text, sessionId: sid, usage, error: (hint ? `${hint}\n${reason}` : reason).slice(0, 2000) };
  }
  return { ok: true, text, sessionId: sid, usage, error: null };
}

/** Adds the MCP servers a stuck agy turn was waiting for, when its log names them. */
function withStuckServers(error, agent, logFile) {
  if (agent !== 'antigravity' || !logFile) return error;
  const hint = stuckServersHint(stuckMcpServers(readLogTail(logFile)));
  return hint ? `${error}. ${hint}` : error;
}
