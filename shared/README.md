# ⚡ @h0wzy/mcp-shared

[![npm](https://img.shields.io/npm/v/%40h0wzy%2Fmcp-shared?color=CB3837&logo=npm)](https://www.npmjs.com/package/@h0wzy/mcp-shared)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/H0wZy/mcp/blob/main/LICENSE)

Reusable core engine, cross-platform binary resolvers, resilient error handlers, credential sanitizers, and generic MCP JSON-RPC 2.0 stdio server for **[H0wZy/mcp](https://github.com/H0wZy/mcp)**.

---

## 📦 What's Inside

`@h0wzy/mcp-shared` eliminates code duplication across MCP server implementations:

- **`createMcpServer(config)`**: A lightweight, zero-dependency JSON-RPC 2.0 stdio engine managing lifecycle handshakes (`initialize`, `ping`, `tools/list`, `tools/call`), request validation, and error serialization.
- **`resolveExecutable(name, overridePath)`**: Cross-platform executable discovery. Safely handles Windows path delimiters (`;`), extensions (`.exe`, `.cmd`, `.bat` via `PATHEXT`), and POSIX paths.
- **`sanitizeOutput(text)`**: Proactive security regex scrubber that strips OpenAI keys (`sk-...`), Google/Gemini keys (`AIza...`), GitHub tokens (`ghp_...`), NPM tokens (`npm_...`), and Bearer authorization headers from stderr and error messages before delivering to host agents.
- **`runCliCommand(executable, args, options)`**: Child process runner with configurable execution timeouts, stdout/stderr buffer limits, and exit-code inspection.
- **`formatResilientResponse(toolName, err)`**: Error formatter that catches HTTP 429 and `ResourceExhausted` quota errors, returning informative non-crashing `{ isError: true }` responses so host agents fall back seamlessly.

---

## 🚀 Installation & Usage

```bash
npm install @h0wzy/mcp-shared
```

```javascript
import { createMcpServer, resolveExecutable, runCliCommand } from '@h0wzy/mcp-shared';

const server = createMcpServer({
  name: 'my-custom-mcp-server',
  version: '1.0.0',
  tools: [
    {
      name: 'my_tool',
      description: 'Executes a custom CLI task',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      },
      handler: async (args) => {
        const binPath = resolveExecutable('my-cli');
        const output = await runCliCommand(binPath, [args.query]);
        return output;
      }
    }
  ]
});

server.start();
```

---

## 📄 License

Created by **Marcos (H0wZy)** under the [MIT License](https://github.com/H0wZy/mcp/blob/main/LICENSE).  
Full repository: 👉 **[H0wZy/mcp](https://github.com/H0wZy/mcp)**
