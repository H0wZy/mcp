// H0wZy/mcp — Agent Configuration, Model Catalogs & Reasoning Effort Engine
// Pure ES module managing session state, tier resolution, ceiling enforcement, and execution metadata.

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export const TIER_NAMES = ['light', 'balanced', 'deep'];

const EFFORT_RANKS = Object.fromEntries(EFFORT_LEVELS.map((level, idx) => [level, idx]));
const TIER_RANKS = Object.fromEntries(TIER_NAMES.map((name, idx) => [name, idx]));

const SAFE_IDENTIFIER_REGEX = /^[A-Za-z0-9._-]{1,64}$/;

// ---------------------------------------------------------------------------
// Curated Catalogs (Offline / Fast Fallback)
// ---------------------------------------------------------------------------

export const CURATED_CATALOGS = {
  antigravity: [
    {
      id: 'gemini-3.8-flash',
      displayName: 'Gemini 3.8 Flash',
      efforts: ['low', 'medium', 'high'],
      defaultEffort: 'high',
      tierNote: 'deep',
      variants: {
        low: 'gemini-3.8-flash-low',
        medium: 'gemini-3.8-flash-medium',
        high: 'gemini-3.8-flash-high',
      },
    },
    {
      id: 'gemini-3.7-flash',
      displayName: 'Gemini 3.7 Flash',
      efforts: ['low', 'medium', 'high'],
      defaultEffort: 'medium',
      tierNote: 'light',
      variants: {
        low: 'gemini-3.7-flash-low',
        medium: 'gemini-3.7-flash-medium',
        high: 'gemini-3.7-flash-high',
      },
    },
    {
      id: 'gemini-3.6-flash',
      displayName: 'Gemini 3.6 Flash',
      efforts: ['low', 'medium', 'high'],
      defaultEffort: 'medium',
      tierNote: 'light',
      variants: {
        low: 'gemini-3.6-flash-low',
        medium: 'gemini-3.6-flash-medium',
        high: 'gemini-3.6-flash-high',
      },
    },
    {
      id: 'gemini-3.1-pro',
      displayName: 'Gemini 3.1 Pro',
      efforts: ['low', 'high'],
      defaultEffort: 'high',
      tierNote: 'balanced',
      variants: {
        low: 'gemini-3.1-pro-low',
        high: 'gemini-3.1-pro-high',
      },
    },
    {
      id: 'claude-opus-5-5',
      displayName: 'Claude Opus 5.5',
      efforts: ['low', 'medium', 'high'],
      defaultEffort: 'high',
      tierNote: 'deep',
      variants: {
        low: 'claude-opus-5-5-low',
        medium: 'claude-opus-5-5-medium',
        high: 'claude-opus-5-5-high',
      },
    },
    {
      id: 'claude-sonnet-5-5',
      displayName: 'Claude Sonnet 5.5',
      efforts: ['low', 'medium', 'high'],
      defaultEffort: 'medium',
      tierNote: 'balanced',
      variants: {
        low: 'claude-sonnet-5-5-low',
        medium: 'claude-sonnet-5-5-medium',
        high: 'claude-sonnet-5-5-high',
      },
    },
    {
      id: 'gpt-oss-120b',
      displayName: 'GPT-OSS 120B',
      efforts: ['medium'],
      defaultEffort: 'medium',
      tierNote: 'light',
      variants: {
        medium: 'gpt-oss-120b-medium',
      },
    },
  ],
  codex: [
    {
      id: 'gpt-6-astra',
      displayName: 'GPT-6-Astra',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      defaultEffort: 'low',
      tierNote: 'deep',
      description: 'Frontier intelligence for the most demanding work.',
    },
    {
      id: 'gpt-6-sol',
      displayName: 'GPT-6-Sol',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      defaultEffort: 'medium',
      tierNote: 'balanced',
      description: 'Previous generation workhorse model.',
    },
    {
      id: 'gpt-6-luna',
      displayName: 'GPT-6-Luna',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultEffort: 'medium',
      tierNote: 'light',
      description: 'Fast and affordable model for easier tasks.',
    },
    {
      id: 'gpt-5.6-sol',
      displayName: 'GPT-5.6-Sol',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      defaultEffort: 'low',
      tierNote: 'balanced',
      description: 'Older generation workhorse model.',
    },
    {
      id: 'gpt-5.6-terra',
      displayName: 'GPT-5.6-Terra',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      defaultEffort: 'medium',
      tierNote: 'balanced',
      description: 'Older balanced model for straightforward work.',
    },
    {
      id: 'gpt-5.6-luna',
      displayName: 'GPT-5.6-Luna',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultEffort: 'medium',
      tierNote: 'light',
      description: 'Older fast and efficient model.',
    },
    {
      id: 'gpt-5.5',
      displayName: 'GPT-5.5',
      efforts: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium',
      tierNote: 'balanced',
      description: 'Legacy coding model.',
    },
  ],
};


const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Claude Code model aliases follow new releases on their own; the full ids pin a
// version. Haiku 4.5 has no effort control, so `--effort` is never sent for it.
CURATED_CATALOGS.claude = [
  {
    id: 'fable',
    displayName: 'Claude Fable (alias, currently Fable 5.1)',
    efforts: CLAUDE_EFFORTS,
    defaultEffort: 'high',
    tierNote: 'deep',
    description: 'Most capable Claude model, for the hardest reasoning and long agentic work. Highest cost.',
  },
  {
    id: 'opus',
    displayName: 'Claude Opus (alias, currently Opus 5.5)',
    efforts: CLAUDE_EFFORTS,
    defaultEffort: 'medium',
    tierNote: 'balanced',
    description: 'Strong default for coding and agentic work.',
  },
  {
    id: 'sonnet',
    displayName: 'Claude Sonnet (alias, currently Sonnet 5.5)',
    efforts: CLAUDE_EFFORTS,
    defaultEffort: 'medium',
    tierNote: 'light',
    description: 'Fast, lower-cost everyday coding model.',
  },
  {
    id: 'haiku',
    displayName: 'Claude Haiku (alias, currently Haiku 4.5)',
    efforts: CLAUDE_EFFORTS,
    effortControl: false,
    defaultEffort: 'medium',
    tierNote: 'light',
    description: 'Fastest and cheapest. No effort control.',
  },
  { id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1', efforts: CLAUDE_EFFORTS, defaultEffort: 'high', tierNote: 'deep', description: 'Pinned Fable 5.1.' },
  { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', efforts: CLAUDE_EFFORTS, defaultEffort: 'medium', tierNote: 'balanced', description: 'Pinned Opus 5.5.' },
  { id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', efforts: CLAUDE_EFFORTS, defaultEffort: 'medium', tierNote: 'light', description: 'Pinned Sonnet 5.5.' },
  {
    id: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5',
    efforts: CLAUDE_EFFORTS,
    effortControl: false,
    defaultEffort: 'medium',
    tierNote: 'light',
    description: 'Pinned Haiku 4.5. No effort control.',
  },
];

export const BUILTIN_TIERS = {
  antigravity: {
    light: { model: 'gemini-3.8-flash', effort: 'low' },
    balanced: { model: 'gemini-3.8-flash', effort: 'medium' },
    deep: { model: 'gemini-3.8-flash', effort: 'high' },
  },
  codex: {
    light: { model: 'gpt-6-luna', effort: 'low' },
    balanced: { model: 'gpt-6-astra', effort: 'medium' },
    deep: { model: 'gpt-6-astra', effort: 'xhigh' },
  },
  claude: {
    light: { model: 'sonnet', effort: 'low' },
    balanced: { model: 'opus', effort: 'medium' },
    deep: { model: 'fable', effort: 'high' },
  },
};

// Env prefix and startup defaults per provider.
const PROVIDERS = {
  antigravity: { prefix: 'AGY_', model: 'gemini-3.8-flash', effort: 'high' },
  codex: { prefix: 'CODEX_', model: 'gpt-6-astra', effort: 'medium' },
  // Not CLAUDE_: Claude Code exports CLAUDE_EFFORT and other CLAUDE_* vars to its children.
  claude: { prefix: 'CLAUDE_BRIDGE_', model: 'opus', effort: 'medium' },
};


// ---------------------------------------------------------------------------
// Helpers: Effort & Tier Arithmetic
// ---------------------------------------------------------------------------

export function isValidEffort(effort) {
  return typeof effort === 'string' && EFFORT_RANKS[effort.toLowerCase()] !== undefined;
}

export function isValidTier(tier) {
  return typeof tier === 'string' && TIER_RANKS[tier.toLowerCase()] !== undefined;
}

export function isValidIdentifier(str) {
  return typeof str === 'string' && SAFE_IDENTIFIER_REGEX.test(str.trim());
}

/**
 * Maps a requested effort to the closest supported effort level.
 * Rule: Highest supported level <= requested. If none, lowest supported level.
 */
export function mapEffort(requested, supported = EFFORT_LEVELS) {
  const req = (requested || '').toLowerCase();
  if (supported.includes(req)) {
    return { effort: req };
  }

  const reqRank = EFFORT_RANKS[req] ?? EFFORT_RANKS.medium;
  const sorted = [...supported].sort((a, b) => EFFORT_RANKS[a] - EFFORT_RANKS[b]);

  const candidates = sorted.filter((s) => EFFORT_RANKS[s] <= reqRank);
  if (candidates.length > 0) {
    const chosen = candidates[candidates.length - 1];
    return { effort: chosen, mappedFrom: requested };
  }

  return { effort: sorted[0], mappedFrom: requested };
}

/**
 * Levenshtein distance for fuzzy model name suggestions.
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[m][n];
}

export function findClosestModels(input, catalog = [], maxSuggestions = 3) {
  const cleanInput = (input || '').toLowerCase().trim();
  const scored = catalog.map((entry) => {
    const distId = levenshtein(cleanInput, entry.id.toLowerCase());
    const distName = levenshtein(cleanInput, entry.displayName.toLowerCase());
    return { id: entry.id, displayName: entry.displayName, dist: Math.min(distId, distName) };
  });

  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, maxSuggestions).map((s) => s.id);
}

// ---------------------------------------------------------------------------
// Model Normalization & Lookup
// ---------------------------------------------------------------------------

export function findModelInCatalog(rawInput, catalog = []) {
  if (!rawInput || typeof rawInput !== 'string') return null;
  const trimmed = rawInput.trim();
  const lower = trimmed.toLowerCase();

  // 1. Direct match by ID
  for (const entry of catalog) {
    if (entry.id.toLowerCase() === lower) {
      return { entry };
    }
  }

  // 2. Match by Antigravity variant ID (e.g. gemini-3.8-flash-high)
  for (const entry of catalog) {
    if (entry.variants) {
      for (const [effort, variantId] of Object.entries(entry.variants)) {
        if (variantId.toLowerCase() === lower) {
          return { entry, impliedEffort: effort };
        }
      }
    }
  }

  // 3. Match by display name (with or without effort in parenthesis)
  for (const entry of catalog) {
    if (entry.displayName.toLowerCase() === lower) {
      return { entry };
    }

    // e.g. "Gemini 3.8 Flash (High)"
    const match = trimmed.match(/^(.+?)\s*\((low|medium|high|xhigh|max|ultra)\)$/i);
    if (match) {
      const baseName = match[1].trim().toLowerCase();
      const impliedEffort = match[2].toLowerCase();
      if (
        entry.displayName.toLowerCase() === baseName ||
        entry.id.toLowerCase() === baseName ||
        entry.id.toLowerCase().replace(/-/g, ' ') === baseName
      ) {
        return { entry, impliedEffort };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Agent Configuration Engine
// ---------------------------------------------------------------------------

/**
 * Creates an agent configuration manager for a specific provider.
 *
 * @param {Object} options
 * @param {'antigravity'|'codex'|'claude'} options.provider
 * @param {string} [options.defaultModel]
 * @param {string} [options.defaultEffort]
 * @param {() => Promise<Array<any>>} [options.catalogLoader] Async loader for external CLI catalog
 * @param {Object} [options.env] Environment variables map (defaults to process.env)
 */
export function createAgentConfig(options) {
  const { provider, catalogLoader, env = process.env } = options;

  if (!PROVIDERS[provider]) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const { prefix } = PROVIDERS[provider];

  // 1. Parse Developer Ceilings from Environment
  const rawMaxEffort = (env[`${prefix}MAX_EFFORT`] || '').trim().toLowerCase();
  const maxEffort = isValidEffort(rawMaxEffort) ? rawMaxEffort : null;

  const rawMaxTier = (env[`${prefix}MAX_TIER`] || '').trim().toLowerCase();
  const maxTier = isValidTier(rawMaxTier) ? rawMaxTier : null;

  // 2. Parse Custom Tiers from Environment
  const tiers = { ...BUILTIN_TIERS[provider] };
  for (const tierName of TIER_NAMES) {
    const envVal = (env[`${prefix}TIER_${tierName.toUpperCase()}`] || '').trim();
    if (envVal) {
      const parts = envVal.split(':');
      const customModel = parts[0].trim();
      const customEffort = parts[1] ? parts[1].trim().toLowerCase() : null;
      if (customModel) {
        tiers[tierName] = {
          model: customModel,
          effort: customEffort && isValidEffort(customEffort) ? customEffort : tiers[tierName].effort,
        };
      }
    }
  }

  // 3. Determine Startup Defaults
  const envModel = (env[`${prefix}MODEL`] || options.defaultModel || '').trim();
  const envEffort = (env[`${prefix}EFFORT`] || options.defaultEffort || '').trim().toLowerCase();

  let startupModel = envModel || PROVIDERS[provider].model;
  let startupEffort = isValidEffort(envEffort) ? envEffort : PROVIDERS[provider].effort;

  // Extract implied effort if startup model was formatted as "Gemini 3.8 Flash (High)"
  const startupMatch = startupModel.match(/^(.+?)\s*\((low|medium|high|xhigh|max|ultra)\)$/i);
  if (startupMatch) {
    startupModel = startupMatch[1].trim();
    if (!env[`${prefix}EFFORT`]) {
      startupEffort = startupMatch[2].toLowerCase();
    }
  }

  // 4. Catalog Cache State
  // Loading never blocks callers (they get the curated list meanwhile), so a slow CLI
  // can take longer than the 5 s discovery budget; a failed load is retried later.
  const catalogTimeoutMs = options.catalogTimeoutMs ?? 5000;
  const catalogRetryMs = options.catalogRetryMs ?? 10 * 60 * 1000;
  let catalog = [...CURATED_CATALOGS[provider]];
  let catalogSource = 'curated';
  let catalogStatus = 'ready'; // 'ready', 'loading', 'failed'
  let catalogLoadedPromise = null;
  let catalogFailedAt = 0;

  function ensureCatalogLoading() {
    if (!catalogLoader || catalogLoadedPromise || catalogSource === 'live') return;
    if (catalogFailedAt && Date.now() - catalogFailedAt < catalogRetryMs) return;
    catalogStatus = 'loading';
    catalogLoadedPromise = (async () => {
      let timer;
      try {
        const loaded = await Promise.race([
          catalogLoader(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), catalogTimeoutMs);
            timer.unref?.();
          }),
        ]);
        if (Array.isArray(loaded) && loaded.length > 0) {
          catalog = loaded;
          catalogSource = 'live';
          catalogStatus = 'ready';
          return;
        }
        catalogStatus = 'failed';
      } catch {
        catalogStatus = 'failed';
      } finally {
        clearTimeout(timer);
      }
      catalogFailedAt = Date.now();
      catalogLoadedPromise = null;
    })();
  }

  // 5. Active Session State
  let activeState = {
    model: startupModel,
    effort: startupEffort,
    tier: null,
    source: 'startup',
    warnings: [],
  };

  function effortsFor(modelId) {
    return findModelInCatalog(modelId, catalog)?.entry.efforts || EFFORT_LEVELS;
  }

  /**
   * Applies developer ceiling clamping to a proposed model and effort, then re-maps the
   * effort to what the final model supports.
   */
  function applyCeilings(modelId, effortLevel, modelTierNote = 'balanced') {
    const warnings = [];
    let eff = effortLevel;
    let mod = modelId;

    if (maxEffort && EFFORT_RANKS[eff] > EFFORT_RANKS[maxEffort]) {
      warnings.push(`Effort '${eff}' clamped to ceiling '${maxEffort}' by ${prefix}MAX_EFFORT`);
      eff = maxEffort;
    }

    if (maxTier && TIER_RANKS[modelTierNote] > TIER_RANKS[maxTier]) {
      const ceilingTier = tiers[maxTier];
      warnings.push(`Model '${mod}' (tier: ${modelTierNote}) clamped to ceiling '${maxTier}' (${ceilingTier.model}) by ${prefix}MAX_TIER`);
      mod = ceilingTier.model;
      // A tier is a model and an effort: running the tier's model above the tier's
      // effort would still exceed the ceiling (codex 'balanced' uses the same model as 'deep').
      if (EFFORT_RANKS[eff] > EFFORT_RANKS[ceilingTier.effort]) {
        warnings.push(`Effort '${eff}' clamped to '${ceilingTier.effort}' by the '${maxTier}' tier ceiling`);
        eff = ceilingTier.effort;
      }
    }

    const remapped = mapEffort(eff, effortsFor(mod));
    if (remapped.mappedFrom) {
      warnings.push(`Effort '${eff}' not supported by ${mod}; mapped to '${remapped.effort}'`);
      eff = remapped.effort;
    }

    return { model: mod, effort: eff, warnings };
  }

  /**
   * Internal resolution of a model & effort request against catalog and ceilings.
   */
  function resolveSettings({ tier, model, effort, isExplicit = false }) {
    const warnings = [];
    let targetModel = model;
    let targetEffort = effort;
    let activeTier = null;

    if (tier) {
      if (!isValidTier(tier)) {
        throw new Error(`Invalid tier '${tier}'. Supported tiers: ${TIER_NAMES.join(', ')}`);
      }
      activeTier = tier.toLowerCase();
      const tierDef = tiers[activeTier];
      if (!targetModel) targetModel = tierDef.model;
      if (!targetEffort) targetEffort = tierDef.effort;
    }

    if (!targetModel && !targetEffort) {
      return { ...activeState };
    }

    if (!targetModel) targetModel = activeState.model;
    if (!targetEffort) targetEffort = activeState.effort;

    if (!isValidEffort(targetEffort)) {
      throw new Error(`Invalid reasoning effort '${targetEffort}'. Supported levels: ${EFFORT_LEVELS.join(', ')}`);
    }

    // Lookup in catalog
    const found = findModelInCatalog(targetModel, catalog);
    let canonicalModel = targetModel;
    let modelTier = 'balanced';
    let supportedEfforts = EFFORT_LEVELS;
    let variants = null;

    if (found) {
      canonicalModel = found.entry.id;
      modelTier = found.entry.tierNote || 'balanced';
      supportedEfforts = found.entry.efforts || EFFORT_LEVELS;
      variants = found.entry.variants || null;
      if (!effort && found.impliedEffort) {
        targetEffort = found.impliedEffort;
      }
    } else {
      if (catalogSource === 'live') {
        const suggestions = findClosestModels(targetModel, catalog);
        const altText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
        throw new Error(`Model '${targetModel}' not recognized for ${provider}.${altText}`);
      } else {
        // In curated/fallback mode, accept safe identifiers with a warning
        if (!isValidIdentifier(targetModel)) {
          throw new Error(`Model name '${targetModel}' contains invalid characters. Must match ${SAFE_IDENTIFIER_REGEX}`);
        }
        warnings.push(`Model '${targetModel}' could not be verified against live catalog (using unverified model)`);
        // Its strength is unknown, so it must not slip under a tier ceiling.
        if (maxTier) modelTier = 'deep';
      }
    }

    // Map effort to model's supported levels
    const mapped = mapEffort(targetEffort, supportedEfforts);
    if (mapped.mappedFrom) {
      warnings.push(`Effort '${mapped.mappedFrom}' not supported by ${canonicalModel}; mapped to '${mapped.effort}'`);
    }

    // Apply ceilings
    const clamped = applyCeilings(canonicalModel, mapped.effort, modelTier);
    warnings.push(...clamped.warnings);
    if (clamped.effort === 'ultra') {
      warnings.push("Effort 'ultra' makes Codex delegate sub-tasks on its own; expect much higher cost and latency");
    }

    return {
      model: clamped.model,
      effort: clamped.effort,
      tier: activeTier,
      source: activeTier ? `tier:${activeTier}` : isExplicit ? 'explicit' : activeState.source,
      warnings,
      variants,
    };
  }

  // -------------------------------------------------------------------------
  // Public Interface
  // -------------------------------------------------------------------------

  function get() {
    ensureCatalogLoading();
    return {
      provider,
      status: 'ok',
      active: {
        model: activeState.model,
        effort: activeState.effort,
        tier: activeState.tier,
        source: activeState.source,
      },
      startup: {
        model: startupModel,
        effort: startupEffort,
      },
      ceiling: {
        maxEffort,
        maxTier,
      },
      tiers,
      warnings: activeState.warnings,
    };
  }

  function set(args = {}) {
    ensureCatalogLoading();
    const previous = { ...activeState };

    const resolved = resolveSettings({
      tier: args.tier,
      model: args.model,
      effort: args.effort,
      isExplicit: true,
    });

    activeState = {
      model: resolved.model,
      effort: resolved.effort,
      tier: resolved.tier,
      source: resolved.source,
      warnings: resolved.warnings,
    };

    return {
      provider,
      status: 'ok',
      active: { ...activeState },
      previous: {
        model: previous.model,
        effort: previous.effort,
        tier: previous.tier,
        source: previous.source,
      },
      ceiling: {
        maxEffort,
        maxTier,
      },
      warnings: activeState.warnings,
    };
  }

  function reset() {
    ensureCatalogLoading();
    const previous = { ...activeState };

    // Resolve startup defaults with ceilings applied
    const resolved = resolveSettings({
      model: startupModel,
      effort: startupEffort,
      isExplicit: false,
    });

    activeState = {
      model: resolved.model,
      effort: resolved.effort,
      tier: null,
      source: 'startup',
      warnings: resolved.warnings,
    };

    return {
      provider,
      status: 'ok',
      active: { ...activeState },
      previous: {
        model: previous.model,
        effort: previous.effort,
        tier: previous.tier,
        source: previous.source,
      },
      warnings: activeState.warnings,
    };
  }

  function list() {
    ensureCatalogLoading();
    return {
      provider,
      catalogSource,
      catalogStatus,
      models: catalog.filter((m) => !m.hidden).map((m) => ({
        id: m.id,
        displayName: m.displayName,
        tierNote: m.tierNote,
        efforts: m.efforts,
        defaultEffort: m.defaultEffort,
        description: m.description,
      })),
      supportedEfforts: EFFORT_LEVELS,
      tiers,
    };
  }

  /**
   * Freezes execution settings for an individual tool call.
   */
  function resolveCall(overrides = {}) {
    ensureCatalogLoading();
    const hasOverride = Boolean(overrides.model || overrides.effort);
    const notices = [];

    // A session model accepted unverified while the catalog was still loading can be
    // rejected once the live catalog arrives. Fall back to the startup defaults instead
    // of failing every later call until someone runs `reset`.
    if (!overrides.model && catalogSource === 'live' && !findModelInCatalog(activeState.model, catalog)) {
      const stale = activeState.model;
      reset();
      notices.push(`Session model '${stale}' is not in the live catalog; reverted to the startup default '${activeState.model}'`);
    }

    const resolved = resolveSettings({
      model: overrides.model || activeState.model,
      effort: overrides.effort || activeState.effort,
      isExplicit: hasOverride,
    });
    resolved.warnings = [...notices, ...resolved.warnings];

    // Compute CLI-specific argument representations
    let cliModel = resolved.model;
    let cliEffort = resolved.effort;

    let effortApplied = true;
    const found = findModelInCatalog(resolved.model, catalog);
    if (provider === 'antigravity') {
      // Find variant ID if available
      if (found && found.entry.variants && found.entry.variants[resolved.effort]) {
        cliModel = found.entry.variants[resolved.effort];
        cliEffort = null; // Passed via variant model ID directly
      }
    } else if (found?.entry.effortControl === false) {
      cliEffort = null; // The model takes no effort setting at all
      effortApplied = false;
    }

    return Object.freeze({
      provider,
      model: resolved.model,
      effort: resolved.effort,
      effortApplied,
      cliModel,
      cliEffort,
      source: hasOverride ? 'override' : resolved.source,
      warnings: resolved.warnings,
    });
  }

  /**
   * Formats the standardized execution footer.
   */
  function formatFooter(snapshot, extras = {}) {
    const effort = snapshot.effortApplied === false ? 'n/a' : snapshot.effort;
    const more = Object.entries(extras)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => ` · ${k}=${v}`)
      .join('');
    const base = `[${snapshot.provider} · model=${snapshot.model} · effort=${effort} · source=${snapshot.source}${more}]`;
    if (snapshot.warnings && snapshot.warnings.length > 0) {
      return `\n\n${base}\n⚠️ ${snapshot.warnings.join('\n⚠️ ')}`;
    }
    return `\n\n${base}`;
  }

  // Normalize the startup state once (canonical id, supported effort, ceilings) so `get`
  // reports what a call would actually run with.
  try {
    const initial = resolveSettings({ model: startupModel, effort: startupEffort });
    activeState = { model: initial.model, effort: initial.effort, tier: null, source: 'startup', warnings: initial.warnings };
  } catch (err) {
    activeState.warnings = [err.message];
  }

  return {
    get,
    set,
    reset,
    list,
    resolveCall,
    formatFooter,
    ensureCatalogLoading,
    catalogReady: () => catalogLoadedPromise || Promise.resolve(),
  };
}
