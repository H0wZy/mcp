// H0wZy/mcp — Generic JSON-RPC 2.0 stdio MCP Server
// Lazy, robust, zero-dependency server engine handling the complete MCP lifecycle.

import readline from 'node:readline';
import { formatResilientResponse } from './errors.js';

/**
 * @typedef {Object} MCPTool
 * @property {string} name
 * @property {string} description
 * @property {Object} inputSchema
 * @property {(args: any) => Promise<{ text: string, isError?: boolean } | string>} handler
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

    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name, version: version || '1.0.0' },
        });

      case 'ping':
        return ok(id, {});

      case 'tools/list':
        return ok(id, {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });

      case 'tools/call': {
        const toolName = params?.name;
        const args = params?.arguments || {};
        const tool = toolMap.get(toolName);

        if (!tool) {
          return fail(id, -32602, `Unknown tool: ${toolName}`);
        }

        try {
          const result = await tool.handler(args);
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
          const formatted = formatResilientResponse({
            provider: name,
            rawOutput: err?.message || String(err),
          });
          return ok(id, {
            content: [{ type: 'text', text: formatted.text }],
            isError: true,
          });
        }
      }

      default:
        if (id !== undefined) {
          fail(id, -32601, `Method not found: ${method}`);
        }
    }
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
  }

  return { start, handleMessage };
}
