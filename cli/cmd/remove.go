package cmd

import (
	"fmt"
	"strings"

	"github.com/H0wZy/mcp/cli/config"
	"github.com/spf13/cobra"
)

var removeScope string

var removeCmd = &cobra.Command{
	Use:   "remove <bridge-name>",
	Short: "Unregister and remove an MCP bridge from host agent configuration",
	Long: "Remove a bridge from its host's config. Bridge names: " + strings.Join(config.BridgeNames(), ", ") + ".\n" +
		"--scope only applies to Claude Code hosts (claude-*).",
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		out := cmd.OutOrStdout()
		b, ok := config.LookupBridge(args[0])
		if !ok {
			return fmt.Errorf("unknown bridge: %s (valid: %s)", args[0], strings.Join(config.BridgeNames(), ", "))
		}
		if err := config.RemoveBridge(b.Name, removeScope); err != nil {
			return err
		}

		scope := ""
		if b.Host == config.AgentClaude {
			scope = " " + dimStyle.Render("("+removeScope+" scope)")
		}
		fmt.Fprintf(out, "  %s Removed %s from %s configuration%s\n",
			successStyle.Render("✓"),
			agentStyle.Render(b.Target),
			agentStyle.Render(config.AgentDisplayName(b.Host)),
			scope,
		)
		fmt.Fprintln(out)
		fmt.Fprintln(out, dimStyle.Render("💡 Restart your host agent CLI to apply the removal."))
		return nil
	},
}

func init() {
	removeCmd.Flags().StringVarP(&removeScope, "scope", "s", "user", "Scope to remove from ('user' or 'project')")
	rootCmd.AddCommand(removeCmd)
}
