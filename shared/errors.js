/**
 * Detects if an error string represents a rate limit or quota exhaustion.
 * @param {string} text
 * @returns {boolean}
 */
export function isRateLimitError(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('429') ||
    lower.includes('resourceexhausted') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('ratelimit') ||
    lower.includes('too many requests') ||
    lower.includes('tokens per minute') ||
    lower.includes('requests per minute') ||
    lower.includes('usage limit') ||
    lower.includes('limit exceeded') ||
    lower.includes('exceeded your')
  );
}

/**
 * Detects if an error string represents an authentication or session expiry issue.
 * @param {string} text
 * @returns {boolean}
 */
export function isAuthError(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('unauthorized') ||
    lower.includes('401') ||
    lower.includes('not authenticated') ||
    lower.includes('not logged in') ||
    lower.includes('sign in') ||
    lower.includes('login required') ||
    lower.includes('auth token') ||
    lower.includes('session expired')
  );
}

/**
 * Formats a provider error into a resilient MCP tool response that allows
 * the calling host agent (e.g. Claude Code) to smoothly degrade or inform the user
 * without aborting the session.
 *
 * @param {Object} options
 * @param {string} options.provider e.g. "Google Antigravity (Gemini)" or "OpenAI Codex"
 * @param {string} options.rawOutput
 * @param {number} [options.exitCode]
 * @returns {{ text: string, isError: boolean }}
 */
export function formatResilientResponse({ provider, rawOutput, exitCode }) {
  const text = (rawOutput || '').trim();

  if (isRateLimitError(text)) {
    return {
      isError: true,
      text:
        `⚠️ [${provider} Rate Limit / Quota Exhausted]\n` +
        `The external provider returned a 429 / Resource Exhausted error:\n\n` +
        `${text}\n\n` +
        `💡 Fallback guidance for Host Agent: Do not retry immediately. Fall back to your internal reasoning to fulfill the user request, or inform the user that their ${provider} quota has been reached.`,
    };
  }

  if (isAuthError(text)) {
    return {
      isError: true,
      text:
        `🔑 [${provider} Authentication Required]\n` +
        `The CLI is not authenticated or the login session has expired:\n\n` +
        `${text}\n\n` +
        `💡 Guidance: Please sign in or check your local credentials for ${provider}.`,
    };
  }

  return {
    isError: true,
    text:
      `❌ [${provider} Execution Error (exit code ${exitCode ?? 'unknown'})]\n\n` +
      `${text || '(No output produced)'}`,
  };
}
