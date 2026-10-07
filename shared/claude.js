// H0wZy/mcp — Claude Code CLI helpers shared by the Claude bridge and the team server.

// Session variables a Claude Code ancestor exports to its children. A nested `claude -p`
// must not inherit them: they would tie it to the outer session (or trip the nested
// session check) and CLAUDE_EFFORT would compete with --effort.
export const INHERITED_CLAUDE_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_EFFORT',
  'CLAUDE_PID',
];

/**
 * Environment for a `claude` child: drops inherited Claude Code session variables
 * (undefined removes a variable in spawn) and adds the chain context.
 *
 * @param {Record<string, string>} [extra]
 */
export function claudeChildEnv(extra = {}) {
  return { ...Object.fromEntries(INHERITED_CLAUDE_SESSION_VARS.map((k) => [k, undefined])), ...extra };
}

/**
 * Reads `claude -p --output-format json` output. Falls back to the raw text when the
 * CLI printed something else (older versions, crashes).
 */
export function parseClaudeResult(stdout) {
  const text = (stdout || '').trim();
  const start = text.lastIndexOf('\n{');
  for (const candidate of [text, start >= 0 ? text.slice(start + 1) : null]) {
    if (!candidate || !candidate.startsWith('{')) continue;
    try {
      const data = JSON.parse(candidate);
      if (data && typeof data === 'object' && ('result' in data || 'is_error' in data || 'subtype' in data)) {
        return {
          json: true,
          text: typeof data.result === 'string' ? data.result : '',
          isError: Boolean(data.is_error) || (typeof data.subtype === 'string' && data.subtype.startsWith('error')),
          subtype: data.subtype,
          cost: Number.isFinite(data.total_cost_usd) ? data.total_cost_usd : undefined,
          turns: Number.isInteger(data.num_turns) ? data.num_turns : undefined,
          sessionId: typeof data.session_id === 'string' ? data.session_id : undefined,
        };
      }
    } catch {
      /* not JSON */
    }
  }
  return { json: false, text, isError: false };
}

/**
 * Per-call caps the developer set for Claude Code runs (FR-017 of spec 006).
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{ args: string[], warnings: string[] }}
 */
export function claudeCapArgs(env = process.env) {
  const args = [];
  const warnings = [];
  if (env.CLAUDE_BRIDGE_MAX_TURNS) {
    const turns = Number(env.CLAUDE_BRIDGE_MAX_TURNS);
    if (Number.isInteger(turns) && turns > 0) args.push('--max-turns', String(turns));
    else warnings.push(`CLAUDE_BRIDGE_MAX_TURNS='${env.CLAUDE_BRIDGE_MAX_TURNS}' is not a positive integer; ignored`);
  }
  if (env.CLAUDE_BRIDGE_MAX_BUDGET_USD) {
    const budget = Number(env.CLAUDE_BRIDGE_MAX_BUDGET_USD);
    if (Number.isFinite(budget) && budget > 0) args.push('--max-budget-usd', String(budget));
    else warnings.push(`CLAUDE_BRIDGE_MAX_BUDGET_USD='${env.CLAUDE_BRIDGE_MAX_BUDGET_USD}' is not a positive number; ignored`);
  }
  return { args, warnings };
}
