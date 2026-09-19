# Contract: CLI Subcommands

This contract specifies the expected command-line interfaces, exit codes, and output formats for the new subcommands.

---

## 1. `hmcp version`

**Usage**:
```bash
hmcp version [flags]
h0wzy-mcp version
hwzmcp version
```

**Flags**:
- `-c, --check`: Explicitly trigger an online registry check (bypassing 4h cache).
- `-j, --json`: Output version and update state as JSON.

**Sample Human Output (Up to date)**:
```text
hmcp version 1.0.1 (windows/amd64)
Built: 2026-09-19
✓ You are running the latest version!
```

**Sample Human Output (Update Available)**:
```text
hmcp version 1.0.1 (windows/amd64)
Built: 2026-09-19
⚡ Update available: 1.0.1 → 1.0.2
Run 'hmcp upgrade' to update to the latest version.
```

**Sample JSON Output (`--json`)**:
```json
{
  "version": "1.0.1",
  "os": "windows",
  "arch": "amd64",
  "latest": "1.0.2",
  "update_available": true
}
```

---

## 2. `hmcp upgrade` (alias: `hmcp update`)

**Usage**:
```bash
hmcp upgrade [flags]
hmcp update [flags]
```

**Flags**:
- `-f, --force`: Reinstall even if already at the latest version.

**Behavior**:
1. Checks latest version on npm / GitHub.
2. If already latest and `--force` is false:
   `✓ You are already running the latest version of hmcp (v1.0.2).`
3. If installed through npm (`which hmcp` points to npm or npm package detected):
   Runs `npm install -g @h0wzy/mcp@latest`.
4. If standalone binary:
   Downloads latest release asset into `~/.h0wzy/bin/` and updates `~/.local/bin/`.
5. Exits with code 0 on success, code 1 on failure.

---

## 3. `hmcp setup-path`

**Usage**:
```bash
hmcp setup-path
```

**Behavior**:
1. Detects current executable location.
2. Identifies user PATH candidates:
   - `~/.local/bin` (already in PATH on Windows/macOS/Linux)
   - npm global bin directory (`%APPDATA%\npm` or `/usr/local/bin`)
3. Copies or links binary as:
   - `hmcp.exe`
   - `hwzmcp.exe`
   - `h0wzy-mcp.exe`
   (Plus `.cmd` batch wrappers on Windows for non-elevated instant execution).
4. Outputs:
   ```text
   ✅ Successfully configured command shims in C:\Users\...\.local\bin:
      • hmcp
      • hwzmcp
      • h0wzy-mcp
   You can now run 'hmcp' from any directory or terminal!
   ```
