package ui

import (
	"fmt"
	"os"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/term"
)

const (
	AppVersion  = "v1.0.0"
	BannerWidth = 76
)

// Static, zero-dependency 3D blocky ASCII art for "H0wZy MCP" (Claude Code CLI style with V2 slashed zero)
const asciiBanner = `██╗  ██╗ ██████╗ ██╗    ██╗███████╗██╗   ██╗   ███╗   ███╗ ██████╗ ██████╗  
██║  ██║██╔═████╗██║    ██║╚══███╔╝╚██╗ ██╔╝   ████╗ ████║██╔════╝ ██╔══██╗ 
███████║██║██╔██║██║ █╗ ██║  ███╔╝  ╚████╔╝    ██╔████╔██║██║     ██████╔╝  
██╔══██║████╔╝██║██║███╗██║ ███╔╝    ╚██╔╝     ██║╚██╔╝██║██║     ██╔═══╝   
██║  ██║╚██████╔╝╚███╔███╔╝███████╗   ██║      ██║ ╚═╝ ██║╚██████╗██║       
╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝   ╚═╝      ╚═╝     ╚═╝ ╚═════╝╚═╝       `

var (
	bannerStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#00ADD8")).
			Bold(true)

	metaStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#888888"))

	tagStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#04B575")).
			Bold(true)

	compactStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#00ADD8")).
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
	sb.WriteString(bannerStyle.Render(asciiBanner))
	sb.WriteString("\n\n")
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
