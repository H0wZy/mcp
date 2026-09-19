package ui

import (
	"fmt"
	"os"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/term"
)

const (
	AppVersion  = "v1.0.2"
	BannerWidth = 75
)

// Static, zero-dependency 3D blocky ASCII art for "H0wZy MCP" (Claude Code CLI style with V2 slashed zero and aligned P)
const asciiBanner = `██╗  ██╗ ██████╗ ██╗    ██╗███████╗██╗   ██╗  ███╗   ███╗  ██████╗ ███████╗
██║  ██║██╔═████╗██║    ██║╚══███╔╝╚██╗ ██╔╝  ████╗ ████║ ██╔════╝ ██╔══██╗
███████║██║██╔██║██║ █╗ ██║  ███╔╝   ╚████╔╝  ██╔████╔██║ ██║      ██████╔╝
██╔══██║████╔╝██║██║███╗██║ ███╔╝     ╚██╔╝   ██║╚██╔╝██║ ██║      ██╔═══╝ 
██║  ██║╚██████╔╝╚███╔███╔╝███████╗    ██║    ██║ ╚═╝ ██║ ╚██████╗ ██║     
╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝    ╚═╝    ╚═╝     ╚═╝  ╚═════╝ ╚═╝     `

var (
	// Gradient from subtle darker purple to vibrant lilac
	gradientColors = []string{
		"#6B21A8", // Line 0: Deep purple
		"#7E22CE", // Line 1: Rich purple
		"#9333EA", // Line 2: Vibrant purple
		"#A855F7", // Line 3: Medium purple-lilac
		"#C084FC", // Line 4: Soft lilac
		"#E9D5FF", // Line 5: Light lilac glow
	}

	metaStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#888888"))

	tagStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#C084FC")).
			Bold(true)

	compactStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#C084FC")).
			Bold(true)
)

// IsTTY returns true if stdout is connected to an interactive terminal.
func IsTTY() bool {
	return term.IsTerminal(os.Stdout.Fd())
}

// GetTerminalWidth returns the width in columns, or 0 as a fallback.
func GetTerminalWidth() int {
	if !IsTTY() {
		return 0
	}
	width, _, err := term.GetSize(os.Stdout.Fd())
	if err != nil || width <= 0 {
		return 0
	}
	return width
}

// RenderCompactHeader renders a clean single-line header for narrow terminals.
func RenderCompactHeader() string {
	return compactStyle.Render("H0wZy/mcp") + " " +
		metaStyle.Render(AppVersion) + " — " +
		tagStyle.Render("The Ultimate Multi-Agent MCP Hub")
}

// RenderBanner renders the full styled ASCII banner or the compact fallback.
func RenderBanner() string {
	return renderBanner(GetTerminalWidth(), IsTTY())
}

func renderBanner(width int, isTTY bool) string {
	if !isTTY {
		return ""
	}

	if width < BannerWidth+2 {
		return RenderCompactHeader() + "\n"
	}

	var sb strings.Builder
	lines := strings.Split(asciiBanner, "\n")
	for i, line := range lines {
		color := gradientColors[i%len(gradientColors)]
		sb.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color(color)).Bold(true).Render(line))
		sb.WriteString("\n")
	}
	sb.WriteString("\n")
	sb.WriteString("  " + tagStyle.Render("H0wZy/mcp") + " " + metaStyle.Render(AppVersion+" • Multi-Agent MCP Hub"))
	sb.WriteString("\n")
	sb.WriteString("  " + metaStyle.Render("Claude Code  ↔  OpenAI Codex  ↔  Google Antigravity"))
	sb.WriteString("\n")

	return sb.String()
}

// PrintBanner prints the banner to stdout if in a TTY.
func PrintBanner() {
	out := RenderBanner()
	if out != "" {
		fmt.Println(out)
	}
}
