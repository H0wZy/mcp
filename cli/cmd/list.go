package cmd

import (
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/H0wZy/mcp/cli/config"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
)

// defaultModelTag names the model a target bridge uses unless configured otherwise.
var defaultModelTag = map[string]string{
	config.AgentClaude:      "default: Opus",
	config.AgentCodex:       "default: GPT-6-Astra",
	config.AgentAntigravity: "default: Gemini 3.8 Flash",
}

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List the MCP bridge directions and which ones are installed",
	Run: func(cmd *cobra.Command, args []string) {
		installed, err := config.InstalledBridges()
		renderBridgeList(cmd.OutOrStdout(), installed, err)
	},
}

func renderBridgeList(out io.Writer, installed []config.BridgeEdge, readErr error) {
	dividerStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#3F3F46"))
	tagStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#71717A"))
	cmdStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#C084FC"))

	fmt.Fprintln(out, headingStyle.Render("🔌 Multi-Agent Bridges (host → target)"))
	fmt.Fprintln(out, dividerStyle.Render(strings.Repeat("─", 60)))

	for _, b := range config.Bridges {
		var scopes []string
		for _, e := range installed {
			if e.Host == b.Host && e.Target == b.Target {
				scopes = appendUnique(scopes, e.Scope)
			}
		}
		state := dimStyle.Render("· not installed")
		bullet := dimStyle.Render("•")
		if len(scopes) > 0 {
			sort.Strings(scopes)
			state = successStyle.Render("✓ installed") + " " + dimStyle.Render("("+strings.Join(scopes, ", ")+")")
			bullet = successStyle.Render("•")
		}
		desc := fmt.Sprintf("%s %s %s %s",
			agentStyle.Render(config.AgentDisplayName(b.Host)),
			arrowStyle.Render("→"),
			agentStyle.Render(config.AgentDisplayName(b.Target)),
			tagStyle.Render("("+defaultModelTag[b.Target]+")"),
		)
		fmt.Fprintf(out, "  %s %s %s\n", bullet, agentStyle.Render(fmt.Sprintf("%-19s", b.Name)), desc)
		fmt.Fprintf(out, "      %s\n", state)
	}

	// The team server is installed per host rather than per direction.
	var teamIn []string
	for _, host := range config.TeamHosts {
		var scopes []string
		for _, e := range installed {
			if e.Host == host && e.Target == config.AgentTeam {
				scopes = appendUnique(scopes, e.Scope)
			}
		}
		if len(scopes) > 0 {
			sort.Strings(scopes)
			teamIn = append(teamIn, host+" ("+strings.Join(scopes, ", ")+")")
		}
	}
	teamState, teamBullet := dimStyle.Render("· not installed"), dimStyle.Render("•")
	if len(teamIn) > 0 {
		teamState = successStyle.Render("✓ installed in") + " " + dimStyle.Render(strings.Join(teamIn, ", "))
		teamBullet = successStyle.Render("•")
	}
	fmt.Fprintf(out, "  %s %s %s %s\n", teamBullet, agentStyle.Render(fmt.Sprintf("%-19s", config.AgentTeam)),
		agentStyle.Render("Agent team server + agent-team skill"), tagStyle.Render("(every detected CLI)"))
	fmt.Fprintf(out, "      %s\n", teamState)

	if readErr != nil {
		fmt.Fprintln(out)
		fmt.Fprintln(out, warnStyle.Render("⚠️  Some host configs could not be read:"))
		for _, line := range strings.Split(readErr.Error(), "\n") {
			fmt.Fprintf(out, "   %s\n", dimStyle.Render(line))
		}
	}

	fmt.Fprintln(out)
	fmt.Fprintf(out, "  %s %s '%s' %s\n",
		dimStyle.Render("💡"),
		dimStyle.Render("Run"),
		cmdStyle.Render("hmcp install <bridge>"),
		dimStyle.Render("to register a specific bridge into your configs."),
	)
	fmt.Fprintf(out, "     %s '%s' %s\n",
		dimStyle.Render("Or run"),
		cmdStyle.Render("hmcp"),
		dimStyle.Render("for interactive guided setup."),
	)
}

func appendUnique(list []string, v string) []string {
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}

func init() {
	rootCmd.AddCommand(listCmd)
}
