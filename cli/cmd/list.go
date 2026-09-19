package cmd

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
)

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List available and supported MCP bridges in H0wZy/mcp",
	Run: func(cmd *cobra.Command, args []string) {
		titleStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#C084FC"))
		dividerStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#3F3F46"))
		bulletStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#04B575"))
		slugStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FFFFFF"))
		arrowStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#A855F7"))
		tagStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#71717A"))
		tipStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#888888"))
		cmdStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#C084FC"))

		bridges := []struct {
			slug string
			from string
			to   string
			tag  string
		}{
			{"claude-antigravity", "Claude Code", "Google Antigravity", "Gemini 3.1 Pro/Flash"},
			{"claude-codex", "Claude Code", "OpenAI Codex", "GPT-5.6 / GPT-6 Astra"},
			{"codex-antigravity", "OpenAI Codex", "Google Antigravity", "Gemini 3.1"},
			{"antigravity-codex", "Google Antigravity", "OpenAI Codex", "Agent Bridge"},
		}

		fmt.Println(titleStyle.Render("🔌 Available Multi-Agent Bridges"))
		fmt.Println(dividerStyle.Render(strings.Repeat("─", 52)))

		for _, b := range bridges {
			desc := fmt.Sprintf("%s %s %s",
				slugStyle.Render(b.from),
				arrowStyle.Render("↔"),
				slugStyle.Render(b.to),
			)
			if b.tag != "" {
				desc += fmt.Sprintf(" %s", tagStyle.Render("("+b.tag+")"))
			}

			fmt.Printf("  %s %-22s %s\n",
				bulletStyle.Render("•"),
				slugStyle.Render(b.slug),
				desc,
			)
		}

		fmt.Println()
		fmt.Printf("  %s %s '%s' %s\n",
			tipStyle.Render("💡"),
			tipStyle.Render("Run"),
			cmdStyle.Render("hmcp install <bridge>"),
			tipStyle.Render("to register a specific bridge into your configs."),
		)
		fmt.Printf("     %s '%s' %s\n",
			tipStyle.Render("Or run"),
			cmdStyle.Render("hmcp"),
			tipStyle.Render("for interactive guided setup."),
		)
	},
}

func init() {
	rootCmd.AddCommand(listCmd)
}
