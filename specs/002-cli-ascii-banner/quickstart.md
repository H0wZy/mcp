# Quickstart & Validation Guide: CLI ASCII Banner

**Feature**: `002-cli-ascii-banner`  
**Date**: 2026-09-19  

---

## Prerequisites
- Go 1.22+ installed
- Terminal emulator with standard UTF-8 support

---

## Validation Scenarios

### Scenario 1: Interactive Banner Display (Claude Code Style)
1. Run the interactive CLI:
   ```bash
   go run ./cli
   ```
2. **Expected Outcome**:
   - The chunky 3D-shadow `H0wZy MCP` banner renders with cyan accent styling.
   - Metadata line displays `v1.0.0 • Multi-Agent MCP Hub` with green tag.
   - AI agent bridge summary displays `Claude Code ↔ OpenAI Codex ↔ Google Antigravity`.

### Scenario 2: Pipeline / Redirection Safety
1. Run the doctor command with redirection to a text file:
   ```bash
   go run ./cli doctor > doctor_output.txt
   ```
2. Inspect the file:
   ```powershell
   Get-Content doctor_output.txt
   ```
3. **Expected Outcome**:
   - 0 banner art or escape codes in the output.
   - Pure diagnostics report.

### Scenario 3: Automation JSON Safety
1. Run doctor with `--json`:
   ```bash
   go run ./cli doctor --json
   ```
2. **Expected Outcome**:
   - Valid JSON output only, parseable by `jq` or `ConvertFrom-Json`.

### Scenario 4: Accessibility & `NO_COLOR` Compliance
1. Run with `NO_COLOR=1`:
   ```powershell
   $env:NO_COLOR="1"; go run ./cli doctor; Remove-Item Env:\NO_COLOR
   ```
2. **Expected Outcome**:
   - Plain text output with zero ANSI color escape sequences.

### Scenario 5: Unit Test Suite
1. Run the Go test suite:
   ```bash
   go test -v ./cli/...
   ```
2. **Expected Outcome**:
   - 100% tests pass across detector, config, and banner modules.
