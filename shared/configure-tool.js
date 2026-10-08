// H0wZy/mcp — The configure_<agent> tool (spec 005), shared by every bridge.

/**
 * Builds the configure tool for one agent bridge.
 *
 * @param {Object} options
 * @param {string} options.name Tool name, e.g. "configure_codex"
 * @param {string} options.label Display name, e.g. "OpenAI Codex"
 * @param {ReturnType<import('./agent-config.js').createAgentConfig>} options.agentConfig
 * @param {string} options.description Tool description for the calling model
 * @param {string} options.tierDescription Description of the `tier` parameter
 * @param {string} options.modelDescription Description of the `model` parameter
 * @param {string[]} options.efforts Effort levels accepted by the `effort` parameter
 */
export function createConfigureTool({ name, label, agentConfig, description, tierDescription, modelDescription, efforts }) {
  return {
    name,
    description,
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
          description: tierDescription,
        },
        model: {
          type: 'string',
          description: modelDescription,
        },
        effort: {
          type: 'string',
          enum: efforts,
          description: 'Reasoning effort level. Automatically mapped to supported levels.',
        },
      },
    },
    handler: (args = {}) => {
      const action = (args.action || 'get').toLowerCase();

      if (action === 'get') {
        const state = agentConfig.get();
        return (
          `⚙️ [${label} Active Configuration]\n` +
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
          `⚙️ [${label} Configuration Updated]\n` +
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
          `🔄 [${label} Configuration Reset to Startup Defaults]\n` +
          `Active: ${resetState.active.model} (effort: ${resetState.active.effort}, source: startup)\n\n` +
          JSON.stringify(resetState, null, 2)
        );
      }

      if (action === 'list') {
        const catalog = agentConfig.list();
        return (
          `📋 [${label} Model Catalog & Tiers]\n` +
          `Catalog Source: ${catalog.catalogSource} (status: ${catalog.catalogStatus})\n\n` +
          JSON.stringify(catalog, null, 2)
        );
      }

      throw new Error(`Unsupported action '${action}'. Valid actions: get, set, reset, list`);
    },
  };
}
