package cmd

import (
	"fmt"

	"github.com/H0wZy/mcp/cli/config"
	"github.com/spf13/cobra"
)

var removeScope string

var removeCmd = &cobra.Command{
	Use:   "remove <bridge-name>",
	Short: "Unregister and remove an MCP bridge from host agent configuration",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		bridge := args[0]
		switch bridge {
		case "claude-antigravity":
			if err := config.UnregisterClaudeServer("antigravity", removeScope); err != nil {
				return err
			}
			fmt.Println("✓ Removed antigravity from Claude Code configuration.")
		case "claude-codex":
			if err := config.UnregisterClaudeServer("codex", removeScope); err != nil {
				return err
			}
			fmt.Println("✓ Removed codex from Claude Code configuration.")
		case "codex-antigravity":
			if err := config.UnregisterCodexServer("antigravity"); err != nil {
				return err
			}
			fmt.Println("✓ Removed antigravity from OpenAI Codex configuration.")
		case "antigravity-codex":
			if err := config.UnregisterAntigravityServer("codex"); err != nil {
				return err
			}
			fmt.Println("✓ Removed codex from Google Antigravity configuration.")
		default:
			return fmt.Errorf("unknown bridge: %s", bridge)
		}
		return nil
	},
}

func init() {
	removeCmd.Flags().StringVarP(&removeScope, "scope", "s", "user", "Scope to remove from ('user' or 'project')")
	rootCmd.AddCommand(removeCmd)
}
