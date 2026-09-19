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
 * Sanitizes potentially sensitive tokens, keys, and credentials from error outputs
 * to prevent accidental token leakage to MCP clients or chat histories.
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeOutput(text) {
  if (!text) return '';
  return text
    // OpenAI API keys: sk-...
    .replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_OPENAI_KEY]')
    // Google / Gemini API keys: AIza...
    .replace(/AIza[0-9A-Za-z_-]{30,}/g, '[REDACTED_GOOGLE_KEY]')
    // GitHub tokens: ghp_..., gho_..., ghu_..., ghs_..., ghr_...
    .replace(/gh[pousr]_[a-zA-Z0-9]{36}/g, '[REDACTED_GITHUB_TOKEN]')
    // NPM tokens: npm_...
    .replace(/npm_[a-zA-Z0-9]{36}/g, '[REDACTED_NPM_TOKEN]')
    // Bearer tokens & JWTs in headers or text
    .replace(/(Bearer\s+)[a-zA-Z0-9_.-]{20,}/gi, '$1[REDACTED_BEARER_TOKEN]')
    // Query params or env vars with secrets: password=..., token=..., key=...
    .replace(/((?:password|secret|token|api_?key|auth)\s*[=:]\s*)[^\s&,;]+/gi, '$1[REDACTED]');
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
  const sanitized = sanitizeOutput((rawOutput || '').trim());

  if (isRateLimitError(sanitized)) {
    return {
      isError: true,
      text:
        `⚠️ [${provider} Rate Limit / Quota Exhausted]\n` +
        `The external provider returned a 429 / Resource Exhausted error:\n\n` +
        `${sanitized}\n\n` +
        `💡 Fallback guidance for Host Agent: Do not retry immediately. Fall back to your internal reasoning to fulfill the user request, or inform the user that their ${provider} quota has been reached.`,
    };
  }

  if (isAuthError(sanitized)) {
    return {
      isError: true,
      text:
        `🔑 [${provider} Authentication Required]\n` +
        `The CLI is not authenticated or the login session has expired:\n\n` +
        `${sanitized}\n\n` +
        `💡 Guidance: Please sign in or check your local credentials for ${provider}.`,
    };
  }

  return {
    isError: true,
    text:
      `❌ [${provider} Execution Error (exit code ${exitCode ?? 'unknown'})]\n\n` +
      `${sanitized || '(No output produced)'}`,
  };
}
