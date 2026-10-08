package cmd

import (
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/H0wZy/mcp/cli/config"
	"github.com/spf13/cobra"
)

var removeScope string

var removeCmd = &cobra.Command{
	Use:   "remove <bridge-name | team>",
	Short: "Unregister and remove an MCP bridge from host agent configuration",
	Long: "Remove a bridge from its host's config. Bridge names: " + strings.Join(config.BridgeNames(), ", ") + ".\n" +
		"'remove team' removes the team server from every host and the agent-team skill copies hmcp installed.\n" +
		"--scope applies to Claude Code configs and to skill folders.",
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		out := cmd.OutOrStdout()
		if args[0] == config.AgentTeam {
			return runRemoveTeam(out, removeScope)
		}
		b, ok := config.LookupBridge(args[0])
		if !ok {
			return fmt.Errorf("unknown bridge: %s (valid: %s, team)", args[0], strings.Join(config.BridgeNames(), ", "))
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

// runRemoveTeam removes the team server key from every host config and the
// skill copies that carry the hmcp marker. Other copies are kept and listed.
func runRemoveTeam(out io.Writer, scope string) error {
	var problems []error
	for _, host := range config.TeamHosts {
		change, err := config.RemoveTeam(host, scope)
		if err != nil {
			problems = append(problems, fmt.Errorf("team (%s): %w", host, err))
			fmt.Fprintf(out, "  %s Could not fully remove %s from %s\n",
				warnStyle.Render("✗"), agentStyle.Render(config.TeamServerKey), agentStyle.Render(config.AgentDisplayName(host)))
		} else {
			where := ""
			if host == config.AgentClaude {
				where = " " + dimStyle.Render("("+scope+" scope)")
			}
			fmt.Fprintf(out, "  %s Removed %s from %s configuration%s\n",
				successStyle.Render("✓"), agentStyle.Render(config.TeamServerKey),
				agentStyle.Render(config.AgentDisplayName(host)), where)
		}
		for _, s := range change.Skills {
			switch s.Action {
			case "removed":
				fmt.Fprintf(out, "    %s\n", dimStyle.Render("removed skill "+s.Path))
			case "kept":
				fmt.Fprintf(out, "    %s\n", warnStyle.Render("kept "+s.Path+": "+s.Reason))
			}
		}
	}
	fmt.Fprintln(out)
	fmt.Fprintln(out, dimStyle.Render("💡 Restart your host agent CLI to apply the removal."))
	return errors.Join(problems...)
}

func init() {
	removeCmd.Flags().StringVarP(&removeScope, "scope", "s", "user", "Scope to remove from ('user' or 'project')")
	rootCmd.AddCommand(removeCmd)
}
