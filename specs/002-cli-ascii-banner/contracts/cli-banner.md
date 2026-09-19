# CLI Visual Contract: Banner & Visual Identity

**Feature**: `002-cli-ascii-banner`  
**Date**: 2026-09-19  

---

## 1. Go Package API Contract (`cli/ui`)

```go
package ui

// Constants defining dimensions and versioning
const (
    AppVersion  = "v1.0.0"
    BannerWidth = 77
)

// IsTTY reports whether os.Stdout is attached to an interactive terminal.
func IsTTY() bool

// GetTerminalWidth queries the terminal width in columns; returns 0 if non-TTY or undetectable.
func GetTerminalWidth() int

// RenderCompactHeader returns a single-line styled header string suitable for narrow viewports.
func RenderCompactHeader() string

// RenderBanner evaluates terminal dimensions and returns the appropriate string (empty, compact, or full).
func RenderBanner() string

// PrintBanner prints the rendered banner to stdout if non-empty.
func PrintBanner()
```

---

## 2. Command Output Contracts

### Interactive CLI Root (`h0wzy-mcp` on TTY >= 80 cols)
```text
██╗  ██╗ ██████╗ ██╗    ██╗███████╗██╗   ██╗   ███╗   ███╗ ██████╗██████╗ 
██║  ██║██╔═████╗██║    ██║╚══███╔╝╚██╗ ██╔╝   ████╗ ████║██╔════╝██╔══██╗
███████║██║██╔██║██║ █╗ ██║  ███╔╝  ╚████╔╝    ██╔████╔██║██║     ██████╔╝
██╔══██║████╔╝██║██║███╗██║ ███╔╝    ╚██╔╝     ██║╚██╔╝██║██║     ██╔═══╝ 
██║  ██║╚██████╔╝╚███╔███╔╝███████╗   ██║      ██║ ╚═╝ ██║╚██████╗██║     
╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝   ╚═╝      ╚═╝     ╚═╝ ╚═════╝╚═╝     

  H0wZy/mcp v1.0.0 • Multi-Agent MCP Hub
  Claude Code  ↔  OpenAI Codex  ↔  Google Antigravity
```

### Interactive CLI Root on Narrow Terminal (< 80 cols)
```text
H0wZy/mcp v1.0.0 — The Ultimate Multi-Agent MCP Hub
```

### Pipe / File Redirection (`h0wzy-mcp > file.txt`)
- Banner output: `""` (0 bytes).
- No ANSI codes.

### Subcommands (`h0wzy-mcp doctor --json`)
- Only pure JSON output emitted:
```json
[
  {
    "toolName": "claude",
    "displayName": "Claude Code",
    "path": "...",
    "healthy": true,
    "latency": 25000000,
    "message": "CLI is functional and responsive"
  }
]
```
