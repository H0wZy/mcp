# Data Model: CLI Parity, PATH Aliases, and Auto-Update Engine

## 1. Entities

### 1.1 UpdateManifest
Persisted locally at `~/.h0wzy/update-check.json`.
Caches update state to eliminate repeated network calls on each invocation.

```json
{
  "current_version": "1.0.1",
  "latest_version": "1.0.2",
  "checked_at": 1789812000000,
  "update_available": true,
  "release_url": "https://github.com/H0wZy/mcp/releases/tag/v1.0.2"
}
```

**Fields**:
- `current_version` (string, required): Active version string of the binary.
- `latest_version` (string, required): Upstream version string detected on npm/GitHub.
- `checked_at` (int64 unix millis, required): Timestamp when registry was polled.
- `update_available` (bool, required): Derived via semver comparison (`latest_version > current_version`).
- `release_url` (string, optional): URL to the latest release on GitHub.

---

### 1.2 ToolDefinition (MCP Protocol)
Standard JSON-RPC 2.0 tool declaration advertised by the servers.

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: {
      prompt: {
        type: "string";
        description: string;
      };
      paths?: {
        type: "array";
        items: { type: "string" };
        description: string;
      };
      model?: {
        type: "string";
        description: string;
      };
    };
    required: ["prompt"];
  };
}
```

---

### 1.3 BinaryShim (PATH Entry)
Represents the executable or script wrapper placed into a directory present in `$env:PATH`.

```typescript
interface BinaryShim {
  alias: "hmcp" | "hwzmcp" | "h0wzy-mcp";
  target_path: string; // e.g. ~/.local/bin/hmcp.exe or ~/.h0wzy/bin/h0wzy-mcp.exe
  shim_type: "symlink" | "hardlink" | "copy" | "cmd_batch";
}
```
