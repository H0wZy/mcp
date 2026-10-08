// H0wZy/mcp — End-of-turn team-report blocks (spec 007, contracts/teammate-protocol.md).

const REPORT_STATUSES = ['done', 'failed', 'blocked', 'continue'];
const FENCE = /```team-report[^\n]*\n([\s\S]*?)```/g;
const JSON_FENCE = /```json[^\n]*\n([\s\S]*?)```/g;
const MAX_SUMMARY = 500;
const MAX_MESSAGES = 10;
const MAX_MESSAGE_TEXT = 4000;

function lastMatch(re, text) {
  let last = null;
  for (const m of text.matchAll(re)) last = m;
  return last;
}

/**
 * Splits a teammate's answer into the visible text and its report.
 *
 * @param {string} output The teammate's final answer
 * @returns {{ answer: string, report: object | null, error: string | null }}
 */
export function parseReport(output) {
  const text = String(output ?? '');
  let match = lastMatch(FENCE, text);
  if (!match) {
    const candidate = lastMatch(JSON_FENCE, text);
    if (candidate) {
      try {
        if (JSON.parse(candidate[1]).status !== undefined) match = candidate;
      } catch {
        /* not a report */
      }
    }
  }
  if (!match) return { answer: text.trim(), report: null, error: 'no team-report block' };

  const answer = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (err) {
    return { answer, report: null, error: `team-report is not valid JSON (${err.message})` };
  }
  if (!data || typeof data !== 'object' || !REPORT_STATUSES.includes(data.status)) {
    return { answer, report: null, error: `team-report status must be one of ${REPORT_STATUSES.join(', ')}` };
  }
  const messages = Array.isArray(data.messages)
    ? data.messages
        .filter((m) => m && typeof m.to === 'string' && typeof m.text === 'string' && m.text.trim())
        .slice(0, MAX_MESSAGES)
        .map((m) => ({ to: m.to.trim().toLowerCase(), text: m.text.trim().slice(0, MAX_MESSAGE_TEXT) }))
    : [];
  return {
    answer,
    error: null,
    report: {
      status: data.status,
      task: typeof data.task === 'string' && data.task ? data.task : null,
      summary: String(data.summary ?? '').trim().slice(0, MAX_SUMMARY),
      messages,
      claimNext: data.claim_next !== false,
    },
  };
}

/**
 * Cuts text to `cap` characters, saying how much was left out.
 */
export function compact(text, cap, ref) {
  const value = String(text ?? '');
  if (value.length <= cap) return value;
  const tail = `\n… [${value.length - cap} more characters${ref ? ` — read them with team_result("${ref}")` : ''}]`;
  return value.slice(0, Math.max(0, cap)) + tail;
}
