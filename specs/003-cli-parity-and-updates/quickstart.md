# Quickstart: CLI Parity, PATH Aliases, and Auto-Update Engine

This guide walks through verifying the new features end-to-end.

---

## 1. Verify Global Terminal Aliases

Run the setup-path command from the repository root:
```bash
go run ./cli setup-path
```

Open any fresh PowerShell or Command Prompt terminal and test all aliases:
```powershell
hmcp doctor
hwzmcp doctor
h0wzy-mcp doctor
```

**Expected Outcome**: All three commands run instantly, detect local CLIs (`claude`, `codex`, `agy`), and display healthy diagnostic badges.

---

## 2. Verify Subcommands `version` and `upgrade`

Check version and remote update availability:
```bash
hmcp version
```

**Expected Outcome**:
```text
hmcp version 1.0.2 (windows/amd64)
Checking for updates...
✓ You are running the latest version!
```

Test upgrade check:
```bash
hmcp upgrade
```

**Expected Outcome**:
Reports that the CLI is already up to date, or updates seamlessly.

---

## 3. Verify Full Tool Parity in Stdio Servers

Run automated stdio test:
```bash
node --test ./test/stdio-verification.test.js
```

**Expected Outcome**:
- `antigravity` server answers `tools/list` with 4 tools: `ask_antigravity`, `review_antigravity`, `brainstorm_antigravity`, `plan_antigravity`.
- `codex` server answers `tools/list` with 4 tools: `ask_codex`, `review_codex`, `brainstorm_codex`, `plan_codex`.
- All tests PASS.

---

## 4. Claude Code Real-World Invocation

Open Claude Code:
```bash
claude
```

Verify in Claude Code:
- Type `/mcp` and observe 4 tools under `antigravity` and 4 tools under `codex`.
- Ask Claude:
  `"Use brainstorm_antigravity to propose alternative architectures for caching remote API calls."`
  `"Use review_codex to inspect cli/ui/banner.go."`
