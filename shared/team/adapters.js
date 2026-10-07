// H0wZy/mcp — One teammate turn per vendor CLI (spec 007, research D2).
// buildTurn() makes the command line, parseTurn() reads the answer back.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolveBinary } from '../resolver.js';
import { noBridgeArgs } from '../l1.js';
import { claudeCapArgs, claudeChildEnv, parseClaudeResult } from '../claude.js';

export const TEAM_AGENTS = ['claude', 'codex', 'antigravity'];

const BINARIES = {
  claude: ['claude', 'CLAUDE_CLI_PATH'],
  codex: ['codex', 'CODEX_CLI_PATH'],
  antigravity: ['agy', 'AGY_BIN'],
};

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
 * @param {number} [options.minutes] Turn limit, for agy's --print-timeout
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{ ok: true, command: string, args: string[], input?: string, cwd: string, env: object, sessionId: string|null, warnings: string[] } | { ok: false, error: string }}
 */
export function buildTurn({ member, prompt, hop = null, outputFile, minutes = 20, env = process.env }) {
  const [bin, override] = BINARIES[member.agent] || [];
  if (!bin) return { ok: false, error: `Unknown agent '${member.agent}'. Use one of: ${TEAM_AGENTS.join(', ')}.` };
  const command = resolveBinary(bin, override);
  if (!command) return { ok: false, error: `\`${bin}\` not found. ${INSTALL_HINTS[member.agent]}` };

  const l1 = hop?.atMaxDepth ? noBridgeArgs(member.agent) : [];
  const chainEnv = hop?.childEnv || {};

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
    args.push(...caps, ...l1);
    return { ok: true, command, args, input: prompt, cwd: member.workDir, env: claudeChildEnv(chainEnv), sessionId, warnings };
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
      ...l1,
      '-',
      '--color',
      'never',
      '--skip-git-repo-check',
      ...(member.canEdit ? ['--approve-for-me'] : ['--ephemeral']),
    ];
    if (outputFile) args.push('-o', outputFile);
    args.push('-C', member.workDir);
    // Codex has no verified resume path here: earlier turns travel in the prompt.
    return { ok: true, command, args, input: prompt, cwd: member.workDir, env: chainEnv, sessionId: null, warnings: [] };
  }

  // antigravity: agy reads the prompt from -p (no text stdin mode).
  const args = ['-p', prompt, '--model', member.cliModel];
  if (member.cliEffort) args.push('--effort', member.cliEffort);
  args.push('--print-timeout', `${Math.max(1, Math.floor(minutes))}m`, '--output-format', 'json');
  if (member.canEdit) args.push('--dangerously-skip-permissions');
  if (member.sessionId) args.push('--conversation', member.sessionId);
  args.push(...l1);
  return { ok: true, command, args, cwd: member.workDir, env: chainEnv, sessionId: member.sessionId, warnings: [] };
}

function parseAgyEnvelope(stdout) {
  const text = String(stdout ?? '').trim();
  const candidates = [text, text.slice(text.lastIndexOf('\n{') + 1)];
  for (const c of candidates) {
    if (!c.startsWith('{')) continue;
    try {
      const data = JSON.parse(c);
      if (data && typeof data === 'object' && ('response' in data || 'conversation_id' in data || 'error' in data)) return data;
    } catch {
      /* not the envelope */
    }
  }
  return null;
}

/**
 * Reads a finished turn.
 *
 * @param {string} agent
 * @param {{ ok: boolean, stdout: string, stderr: string, exitCode: number, timedOut: boolean }} res executeProcess result
 * @param {{ outputFile?: string, sessionId?: string|null }} [options]
 * @returns {{ ok: boolean, text: string, sessionId: string|null, usage: { costUsd?: number, inputTokens?: number, outputTokens?: number }, error: string|null }}
 */
export function parseTurn(agent, res, { outputFile, sessionId = null } = {}) {
  const fail = (error, text = '') => ({ ok: false, text, sessionId, usage: {}, error });
  if (res.timedOut) return fail('the turn timed out', res.stdout);

  if (agent === 'claude') {
    const parsed = parseClaudeResult(res.stdout);
    const usage = parsed.cost !== undefined ? { costUsd: parsed.cost } : {};
    const sid = parsed.sessionId || sessionId;
    if (!res.ok || parsed.isError) {
      return { ok: false, text: parsed.text, sessionId: sid, usage, error: (res.stderr || parsed.subtype || parsed.text || `exit code ${res.exitCode}`).slice(0, 2000) };
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
  const error = data?.error ? (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)) : null;
  if (!res.ok || error) return { ok: false, text, sessionId: sid, usage, error: (error || res.stderr || `exit code ${res.exitCode}`).slice(0, 2000) };
  return { ok: true, text, sessionId: sid, usage, error: null };
}
