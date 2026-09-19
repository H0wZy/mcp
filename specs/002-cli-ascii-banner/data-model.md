# Data Model: CLI Visual Banner & Terminal State

**Feature**: `002-cli-ascii-banner`  
**Date**: 2026-09-19  

---

## Entities & Data Structures

### 1. TerminalEnvironment (State Entity)

Represents the detected execution environment where the CLI is being run.

| Field | Type | Description |
|-------|------|-------------|
| `IsInteractive` | `bool` | True if `os.Stdout` is an interactive character device (TTY). |
| `Width` | `int` | Terminal viewport width in columns. `0` if non-TTY or undetectable. |
| `NoColor` | `bool` | True if `NO_COLOR` environment variable is defined and non-empty. |

### 2. BannerLayout (Rendering Entity)

Represents the visual output configuration chosen based on `TerminalEnvironment`.

| Variant | Condition | Render Output |
|---------|-----------|---------------|
| `Suppressed` | `IsInteractive == false` | Empty string `""` (0 bytes emitted). |
| `CompactHeader` | `IsInteractive == true && Width < 80` | Single line: `H0wZy/mcp v1.0.0 — The Ultimate Multi-Agent MCP Hub\n` |
| `FullBanner` | `IsInteractive == true && Width >= 80` | 6-line 3D blocky ASCII art + metadata line + agent bridge summary. |

### 3. VisualTokens (Styling Entity)

Lipgloss style definitions applied to terminal text elements.

| Style Token | Foreground Color | Font Weight | Applied To |
|-------------|------------------|-------------|------------|
| `bannerStyle` | `#00ADD8` (Cyan) | Bold | 3D Block ASCII Art letters (`H0wZy MCP`) |
| `tagStyle` | `#04B575` (Emerald) | Bold | Brand tag `H0wZy/mcp` and tagline |
| `metaStyle` | `#888888` (Muted Gray) | Normal | Version string, delimiters, bridge list |
| `compactStyle`| `#00ADD8` (Cyan) | Bold | Single-line compact brand header |

---

## State Transition Diagram

```text
               CLI Execution Started
                         │
                  Is stdout a TTY?
                    /         \
                 [No]         [Yes]
                  │             │
              Suppressed   Query Terminal Width
              (0 bytes)         │
                         Width >= 80 cols?
                           /         \
                        [No]         [Yes]
                         │             │
                    CompactHeader   Full 3D Block Banner
                    (Single line)   (Styled ASCII Art + Meta)
```
