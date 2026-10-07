// H0wZy/mcp — Generic JSON-RPC 2.0 stdio MCP Server
// Lazy, robust, zero-dependency server engine handling the complete MCP lifecycle.

import readline from 'node:readline';
import { formatResilientResponse } from './errors.js';
import { killAllChildren } from './executor.js';
import { agentName, beginHop, logRefusal } from './chain-guard.js';

// Newest first. A client asking for anything else gets the newest one we speak.
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/**
 * @typedef {Object} MCPTool
 * @property {string} name
 * @property {string} description
 * @property {Object} inputSchema
 * @property {Object} [annotations] MCP tool hints (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
 * @property {boolean} [spawnsAgent] Starts an agent: the loop guard decides first and the handler gets `context.hop`
 * @property {string} [agent] Agent the tool starts (defaults to the server name)
 * @property {(args: any, context: { signal: AbortSignal, hop?: object }) => Promise<{ text: string, isError?: boolean, outcome?: string } | string>} handler
 */

/**
 * Name of the agent hosting this bridge: `--host <name>` / `--host=<name>` in the launch
 * arguments (written by `hmcp install`), else H0WZY_MCP_HOST, else "host".
 *
 * @param {string[]} [argv=process.argv]
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {string}
 */
export function resolveHost(argv = process.argv, env = process.env) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--host' && argv[i + 1]) return agentName(argv[i + 1]);
    if (argv[i].startsWith('--host=')) return agentName(argv[i].slice('--host='.length));
  }
  return env.H0WZY_MCP_HOST ? agentName(env.H0WZY_MCP_HOST) : 'host';
}

/**
 * Creates an MCP server instance over stdio.
 *
 * @param {Object} config
 * @param {string} config.name Server name (e.g. "antigravity", "codex")
 * @param {string} config.version Server semantic version
 * @param {MCPTool[]} config.tools Tools exposed by this server
 * @param {string} [config.host] Agent hosting this bridge (default: resolveHost())
 * @returns {{ start: () => void, handleMessage: (msg: any) => Promise<any> }}
 */
export function createMcpServer({ name, version, tools = [], host }) {
  const hostName = host ? agentName(host) : resolveHost();
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  // Requests still running, so notifications/cancelled and shutdown can stop them.
  const inFlight = new Map();

  function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
  }

  function ok(id, result) {
    send({ jsonrpc: '2.0', id, result });
  }

  function fail(id, code, message) {
    send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  async function handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    const { id, method, params } = msg;

    // Notifications carry no id and expect no response
    if (method === 'notifications/initialized' || method === 'initialized') return;

    if (method === 'notifications/cancelled') {
      inFlight.get(params?.requestId)?.abort();
      return;
    }

    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        return ok(id, {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name, version: version || '1.0.0' },
        });
      }

      case 'ping':
        return ok(id, {});

      case 'tools/list':
        return ok(id, {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            ...(t.annotations ? { annotations: t.annotations } : {}),
          })),
        });

      case 'tools/call': {
        const toolName = params?.name;
        const args = params?.arguments || {};
        const tool = toolMap.get(toolName);

        if (!tool) {
          return fail(id, -32602, `Unknown tool: ${toolName}`);
        }

        // Loop guard (spec 006): decide before anything is started.
        let hop;
        if (tool.spawnsAgent) {
          const target = tool.agent || name;
          const decision = beginHop({ target, tool: tool.name, host: hostName });
          if (!decision.ok) {
            logRefusal({ refusal: decision.refusal, target, tool: tool.name });
            return ok(id, { content: [{ type: 'text', text: decision.refusal.text }], isError: true });
          }
          hop = decision.hop;
        }
        const withTrace = (text) => {
          if (!hop) return text;
          const warnings = hop.warnings.length ? `\n⚠️ ${hop.warnings.join('\n⚠️ ')}` : '';
          return `${text}\n${hop.trace()}${warnings}`;
        };

        const controller = new AbortController();
        if (id !== undefined) inFlight.set(id, controller);
        let outcome = 'failed';
        let reply = null;

        try {
          const result = await tool.handler(args, { signal: controller.signal, hop });
          if (controller.signal.aborted) {
            outcome = 'cancelled';
          } else {
            const text = typeof result === 'string' ? result : result.text || '';
            const isError = typeof result === 'string' ? false : Boolean(result.isError);
            outcome = (typeof result === 'object' && result.outcome) || (isError ? 'failed' : 'ran');
            reply = { content: [{ type: 'text', text: withTrace(text) }], isError };
          }
        } catch (err) {
          if (controller.signal.aborted) {
            outcome = 'cancelled';
          } else {
            const formatted = formatResilientResponse({
              provider: name,
              rawOutput: err?.message || String(err),
            });
            reply = { content: [{ type: 'text', text: withTrace(formatted.text) }], isError: true };
          }
        } finally {
          inFlight.delete(id);
          // Before replying: the caller may act on the reply (and look at the agent
          // registry) as soon as it arrives.
          hop?.finish(outcome);
        }
        // A cancelled request gets no response (MCP cancellation rules).
        if (reply) return ok(id, reply);
        return;
      }

      default:
        if (id !== undefined) {
          fail(id, -32601, `Method not found: ${method}`);
        }
    }
  }

  let shuttingDown = false;

  // Stops every running request and the agent processes they started, lets the
  // aborted requests settle and stdout drain, then exits.
  async function shutdown(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const controller of inFlight.values()) controller.abort();
    killAllChildren();
    const deadline = Date.now() + 3000;
    while (inFlight.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    process.stdout.write('', () => process.exit(exitCode));
  }

  function start() {
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });
    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        await handleMessage(msg);
      } catch {
        // Ignore unparseable lines silently per JSON-RPC over stdio
      }
    });
    // The client closing stdin is the MCP stdio shutdown signal: don't leave agents
    // running (and editing files) after the host is gone.
    rl.on('close', () => shutdown(0));
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.on(sig, () => shutdown(0));
    }
  }

  return { start, handleMessage };
}
