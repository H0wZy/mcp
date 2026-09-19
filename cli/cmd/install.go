package cmd

import (
	"fmt"

	"github.com/H0wZy/mcp/cli/config"
	"github.com/H0wZy/mcp/cli/detector"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
)

var (
	installAll   bool
	installScope string
)

var installCmd = &cobra.Command{
	Use:   "install [bridge-name]",
	Short: "Install and register MCP bridges into host agent configs",
	Long: `Install bridges between AI developer CLIs.
Supported bridge names:
  claude-antigravity  (Connects Claude Code to Google Antigravity)
  claude-codex        (Connects Claude Code to OpenAI Codex)
  codex-antigravity   (Connects OpenAI Codex to Google Antigravity)
  antigravity-codex   (Connects Google Antigravity to OpenAI Codex)`,
	RunE: func(cmd *cobra.Command, args []string) error {
		var toInstall []string

		if installAll {
			tools := detector.DetectTools()
			toolMap := make(map[string]bool)
			for _, t := range tools {
				toolMap[t.Name] = t.Installed
			}

			if toolMap["claude"] && toolMap["agy"] {
				toInstall = append(toInstall, "claude-antigravity")
			}
			if toolMap["claude"] && toolMap["codex"] {
				toInstall = append(toInstall, "claude-codex")
			}
			if toolMap["codex"] && toolMap["agy"] {
				toInstall = append(toInstall, "codex-antigravity")
			}
			if toolMap["agy"] && toolMap["codex"] {
				toInstall = append(toInstall, "antigravity-codex")
			}
		} else if len(args) > 0 {
			toInstall = append(toInstall, args[0])
		} else {
			return fmt.Errorf("please specify a bridge name or use --all (run 'hmcp' for interactive mode)")
		}

		successStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#04B575"))
		agentStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FFFFFF"))
		arrowStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#A855F7"))
		dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#888888"))
		warnStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FFA500"))

		if len(toInstall) == 0 {
			fmt.Println(warnStyle.Render("⚠️  No supported bridges detected to install."))
			return nil
		}

		for _, bridge := range toInstall {
			switch bridge {
			case "claude-antigravity":
				serverCmd, serverArgs := config.ResolveServerScript("antigravity")
				if err := config.RegisterClaudeServerCommand("antigravity", serverCmd, serverArgs, installScope); err != nil {
					return err
				}
				fmt.Printf("  %s Connected: %s %s %s %s\n",
					successStyle.Render("✓"),
					agentStyle.Render("Claude Code"),
					arrowStyle.Render("↔"),
					agentStyle.Render("Google Antigravity"),
					dimStyle.Render("("+installScope+" scope)"),
				)
			case "claude-codex":
				serverCmd, serverArgs := config.ResolveServerScript("codex")
				if err := config.RegisterClaudeServerCommand("codex", serverCmd, serverArgs, installScope); err != nil {
					return err
				}
				fmt.Printf("  %s Connected: %s %s %s %s\n",
					successStyle.Render("✓"),
					agentStyle.Render("Claude Code"),
					arrowStyle.Render("↔"),
					agentStyle.Render("OpenAI Codex"),
					dimStyle.Render("("+installScope+" scope)"),
				)
			case "codex-antigravity":
				serverCmd, serverArgs := config.ResolveServerScript("antigravity")
				if err := config.RegisterCodexServerCommand("antigravity", serverCmd, serverArgs); err != nil {
					return err
				}
				fmt.Printf("  %s Connected: %s %s %s\n",
					successStyle.Render("✓"),
					agentStyle.Render("OpenAI Codex"),
					arrowStyle.Render("↔"),
					agentStyle.Render("Google Antigravity"),
				)
			case "antigravity-codex":
				serverCmd, serverArgs := config.ResolveServerScript("codex")
				if err := config.RegisterAntigravityServerCommand("codex", serverCmd, serverArgs); err != nil {
					return err
				}
				fmt.Printf("  %s Connected: %s %s %s\n",
					successStyle.Render("✓"),
					agentStyle.Render("Google Antigravity"),
					arrowStyle.Render("↔"),
					agentStyle.Render("OpenAI Codex"),
				)
			default:
				return fmt.Errorf("unknown bridge: %s", bridge)
			}
		}

		fmt.Println()
		fmt.Println(successStyle.Render("✅ Configuration complete!"))
		fmt.Println(dimStyle.Render("💡 Restart your host agent CLI to activate the newly connected tools."))
		return nil
	},
}

func init() {
	installCmd.Flags().BoolVar(&installAll, "all", false, "Install all bridges supported by detected local CLIs")
	installCmd.Flags().StringVarP(&installScope, "scope", "s", "user", "Scope to install into ('user' or 'project')")
	rootCmd.AddCommand(installCmd)
}
