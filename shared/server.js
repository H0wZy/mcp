// H0wZy/mcp — Generic JSON-RPC 2.0 stdio MCP Server
// Lazy, robust, zero-dependency server engine handling the complete MCP lifecycle.

import readline from 'node:readline';
import { formatResilientResponse } from './errors.js';
import { killAllChildren } from './executor.js';

// Newest first. A client asking for anything else gets the newest one we speak.
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/**
 * @typedef {Object} MCPTool
 * @property {string} name
 * @property {string} description
 * @property {Object} inputSchema
 * @property {Object} [annotations] MCP tool hints (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
 * @property {(args: any, context: { signal: AbortSignal }) => Promise<{ text: string, isError?: boolean } | string>} handler
 */

/**
 * Creates an MCP server instance over stdio.
 *
 * @param {Object} config
 * @param {string} config.name Server name (e.g. "antigravity", "codex")
 * @param {string} config.version Server semantic version
 * @param {MCPTool[]} config.tools Tools exposed by this server
 * @returns {{ start: () => void, handleMessage: (msg: any) => Promise<any> }}
 */
export function createMcpServer({ name, version, tools = [] }) {
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

        const controller = new AbortController();
        if (id !== undefined) inFlight.set(id, controller);

        try {
          const result = await tool.handler(args, { signal: controller.signal });
          // A cancelled request gets no response (MCP cancellation rules).
          if (controller.signal.aborted) return;
          if (typeof result === 'string') {
            return ok(id, {
              content: [{ type: 'text', text: result }],
              isError: false,
            });
          }

          return ok(id, {
            content: [{ type: 'text', text: result.text || '' }],
            isError: Boolean(result.isError),
          });
        } catch (err) {
          if (controller.signal.aborted) return;
          const formatted = formatResilientResponse({
            provider: name,
            rawOutput: err?.message || String(err),
          });
          return ok(id, {
            content: [{ type: 'text', text: formatted.text }],
            isError: true,
          });
        } finally {
          inFlight.delete(id);
        }
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
