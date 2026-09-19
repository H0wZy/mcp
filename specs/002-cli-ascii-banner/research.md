# Research & Technical Decisions: CLI ASCII Banner

**Feature**: `002-cli-ascii-banner`  
**Date**: 2026-09-19  

---

## 1. Typography & Aesthetic Design

### Context & Goal
The user requested a visual identity inspired by the **Claude Code CLI** logo and typography:
- Chunky, blocky, square pixel lettering with drop shadow / 3D extrusion.
- Replacing the initial diagonal slash font (`/---\ /---\`) which felt chaotic and unrefined.
- Must render cleanly in modern terminal emulators (Windows Terminal, VS Code Terminal, macOS Terminal, iTerm2, Alacritty, Ghostty, Linux xterm).

### Alternatives Evaluated

1. **Standard Slant FIGlet font (Initial implementation)**:
   - *Pros*: Simple ASCII characters (`/`, `\`, `|`, `_`).
   - *Cons*: Visually busy, diagonal slashes look ragged at small terminal sizes, lacks the modern "AI harness" blocky feel requested.
   - *Result*: Rejected based on user feedback.

2. **Full Unicode Block Art (`████`)**:
   - *Pros*: Solid and chunky.
   - *Cons*: Can look like solid black/colored bricks without outline definition or character nuance.
   - *Result*: Sub-optimal without shadow/outline.

3. **ANSI Shadow / Isometric 3D Box-Drawing Typography (Selected)**:
   - *Design*: Combines full blocks (`█`), double-line box drawings (`║`, `═`), and shadow corners (`╔`, `╗`, `╚`, `╝`).
   - *Visual*: Creates the exact chunky, square, extruded 3D drop-shadow aesthetic of Claude Code CLI's logo (`CLAUDE CODE`).
   - *Width*: `H0wZy` (45 cols) + gap (3 cols) + `MCP` (29 cols) = **77 columns**. Fits within standard 80-column terminal windows!
   - *Result*: **Adopted**.

---

## 2. Zero-Dependency Static Storage

### Context & Decision
Rather than bundling a Go FIGlet parser library or external `.flf` font files:
- The ASCII art is stored directly as an immutable raw string literal constant (`const asciiBanner = ...`) in `cli/ui/banner.go`.
- **Rationale**:
  - 0 external dependencies added to `cli/go.mod`.
  - Sub-millisecond execution (< 0.05ms).
  - No risk of missing font files, filesystem IO errors, or cross-platform path resolution issues.

---

## 3. Terminal Detection & Pipeline Safety

### Context & Decision
Non-interactive scripts and pipelines (such as `h0wzy-mcp doctor --json` or `h0wzy-mcp doctor > output.txt`) must never receive ANSI escape codes or ASCII banners:
- Use `term.IsTerminal(os.Stdout.Fd())` from `github.com/charmbracelet/x/term` (already a transitive dependency in `go.mod`).
- If `!IsTTY()`, `RenderBanner()` immediately returns an empty string `""`.
- Subcommands (`doctor`, `install`, `list`, `remove`) do not call `PrintBanner()`, guaranteeing that JSON output and automation remain 100% clean.

---

## 4. Responsive Viewport Adaptation

### Context & Decision
Terminal split panes (e.g. VS Code side panes, tmux splits, mobile terminals) frequently have widths between 40 and 70 columns.
- The full 3D block banner requires 77 columns + 2 columns margin (79 columns minimum).
- When `width < 80` (or if width is 0/undetectable), `RenderBanner()` automatically renders a sleek single-line header:
  ```text
  H0wZy/mcp v1.0.0 — The Ultimate Multi-Agent MCP Hub
  ```
- This prevents horizontal line wraps that scramble ASCII art into unreadable visual artifacts.

---

## 5. Color Palette & `NO_COLOR` Compliance

### Palette
- **Banner Color**: Modern Cyan `#00ADD8` (matching Go / modern developer harnesses) or Claude Terracotta `#D97757`.
- **Tag / Status Color**: Emerald Green `#04B575` (success / active bridges).
- **Metadata Color**: Subtle Gray `#888888` (versions, delimiters, bridge mappings).

### `NO_COLOR` Standard
`lipgloss` automatically respects the `NO_COLOR` environment variable (per the no-color.org specification) by stripping all ANSI escape codes when set, ensuring full accessibility and compliance.
