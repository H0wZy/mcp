# ⚡ @h0wzy/mcp-shared

[![npm](https://img.shields.io/npm/v/%40h0wzy%2Fmcp-shared?color=CB3837&logo=npm)](https://www.npmjs.com/package/@h0wzy/mcp-shared)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/H0wZy/mcp/blob/main/LICENSE)

Reusable core engine, cross-platform binary resolvers, resilient error handlers, credential sanitizers, and generic MCP JSON-RPC 2.0 stdio server for **[H0wZy/mcp](https://github.com/H0wZy/mcp)**.

---

## 📦 What's Inside

`@h0wzy/mcp-shared` eliminates code duplication across MCP server implementations:

- **`createMcpServer({ name, version, tools })`**: Zero-dependency JSON-RPC 2.0 stdio engine (`initialize` with protocol version negotiation, `ping`, `tools/list` with annotations, `tools/call`, `notifications/cancelled`). Tool handlers receive `(args, { signal })`. Closing stdin stops in-flight calls and the processes they started.
- **`executeProcess(command, args, options)`**: Child process runner with timeouts, process-tree kill (process group on POSIX, `taskkill /T` on Windows), `AbortSignal` cancellation, per-stream output cap, stdin input, and safe quoting for `.cmd`/`.bat` shims.
- **`resolveBinary(name, overrideEnvVar)`**: Cross-platform executable discovery. Handles Windows path delimiters (`;`), extensions (`.exe`, `.cmd`, `.bat` via `PATHEXT`), and POSIX paths.
- **`validateCwd(cwd)`, `normalizePaths(paths, base)`, `clampTimeoutMinutes(value)`**: Validation for values that reach an agent's command line.
- **`createAgentConfig({ provider, catalogLoader })`**: Model and reasoning-effort control: catalogs, tiers (`light` / `balanced` / `deep`), developer ceilings and per-call snapshots.
- **`sanitizeOutput(text)`**: Strips OpenAI keys (`sk-...`), Google/Gemini keys (`AIza...`), GitHub tokens (`ghp_...`), npm tokens (`npm_...`) and Bearer tokens before output reaches host agents.
- **`formatResilientResponse({ provider, rawOutput, exitCode })`**: Turns HTTP 429 / `ResourceExhausted` quota errors and auth failures into informative `{ isError: true }` responses, so host agents degrade gracefully.

---

## 🚀 Installation & Usage

```bash
npm install @h0wzy/mcp-shared
```

```javascript
import { createMcpServer, resolveBinary, executeProcess } from '@h0wzy/mcp-shared';

const server = createMcpServer({
  name: 'my-custom-mcp-server',
  version: '1.0.0',
  tools: [
    {
      name: 'my_tool',
      description: 'Executes a custom CLI task',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      annotations: { readOnlyHint: true },
      handler: async ({ query }, { signal }) => {
        const bin = resolveBinary('my-cli', 'MY_CLI_PATH');
        if (!bin) return { text: 'my-cli not found', isError: true };
        const res = await executeProcess(bin, [query], { timeoutMs: 60000, signal });
        return { text: res.ok ? res.stdout : res.stderr, isError: !res.ok };
      },
    },
  ],
});

server.start();
```

---

## 📄 License

Created by **Marcos (H0wZy)** under the [MIT License](https://github.com/H0wZy/mcp/blob/main/LICENSE).  
Full repository: 👉 **[H0wZy/mcp](https://github.com/H0wZy/mcp)**
