package cmd

import (
	"fmt"

	"github.com/H0wZy/mcp/cli/config"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
)

var removeScope string

var removeCmd = &cobra.Command{
	Use:   "remove <bridge-name>",
	Short: "Unregister and remove an MCP bridge from host agent configuration",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		bridge := args[0]

		successStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#04B575"))
		agentStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FFFFFF"))
		dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#888888"))

		switch bridge {
		case "claude-antigravity":
			if err := config.UnregisterClaudeServer("antigravity", removeScope); err != nil {
				return err
			}
			fmt.Printf("  %s Removed %s from %s configuration %s\n",
				successStyle.Render("✓"),
				agentStyle.Render("antigravity"),
				agentStyle.Render("Claude Code"),
				dimStyle.Render("("+removeScope+" scope)"),
			)
		case "claude-codex":
			if err := config.UnregisterClaudeServer("codex", removeScope); err != nil {
				return err
			}
			fmt.Printf("  %s Removed %s from %s configuration %s\n",
				successStyle.Render("✓"),
				agentStyle.Render("codex"),
				agentStyle.Render("Claude Code"),
				dimStyle.Render("("+removeScope+" scope)"),
			)
		case "codex-antigravity":
			if err := config.UnregisterCodexServer("antigravity"); err != nil {
				return err
			}
			fmt.Printf("  %s Removed %s from %s configuration\n",
				successStyle.Render("✓"),
				agentStyle.Render("antigravity"),
				agentStyle.Render("OpenAI Codex"),
			)
		case "antigravity-codex":
			if err := config.UnregisterAntigravityServer("codex"); err != nil {
				return err
			}
			fmt.Printf("  %s Removed %s from %s configuration\n",
				successStyle.Render("✓"),
				agentStyle.Render("codex"),
				agentStyle.Render("Google Antigravity"),
			)
		default:
			return fmt.Errorf("unknown bridge: %s", bridge)
		}

		fmt.Println()
		fmt.Println(dimStyle.Render("💡 Restart your host agent CLI to apply the removal."))
		return nil
	},
}

func init() {
	removeCmd.Flags().StringVarP(&removeScope, "scope", "s", "user", "Scope to remove from ('user' or 'project')")
	rootCmd.AddCommand(removeCmd)
}
