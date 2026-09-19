package cmd

import (
	"errors"
	"fmt"
	"os"

	"github.com/H0wZy/mcp/cli/ui"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:           "hmcp",
	Aliases:       []string{"h0wzy-mcp", "hwzmcp"},
	Short:         "H0wZy/mcp — The Ultimate Multi-Agent MCP Hub & Go CLI",
	Long: `H0wZy/mcp centralizes and connects Claude Code, OpenAI Codex, and Google Antigravity
for independent second opinions, cross-reviews, and autonomous multi-agent validation.`,
	SilenceUsage:  true,
	SilenceErrors: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		if v, _ := cmd.Flags().GetBool("version"); v {
			return RunVersionOutput(false, false)
		}
		return ui.RunInteractive()
	},
}

func renderCustomHelp(cmd *cobra.Command, args []string) {
	titleStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#C084FC"))
	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#C084FC")).MarginTop(1)
	cmdStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#04B575"))
	flagStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#A855F7"))
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#888888"))

	fmt.Println(titleStyle.Render("🚀 hmcp — The Ultimate Multi-Agent MCP Hub"))
	fmt.Println(dimStyle.Render("Interconnect Claude Code, OpenAI Codex, and Google Antigravity seamlessly."))
	fmt.Println()

	fmt.Println(headerStyle.Render("USAGE:"))
	fmt.Printf("  %s %s\n", lipgloss.NewStyle().Bold(true).Render("hmcp"), dimStyle.Render("[command] [flags]"))

	fmt.Println(headerStyle.Render("AVAILABLE COMMANDS:"))
	commands := cmd.Commands()
	for _, c := range commands {
		if c.Hidden || c.Name() == "help" {
			continue
		}
		fmt.Printf("  %-14s %s\n",
			cmdStyle.Render(c.Name()),
			dimStyle.Render(c.Short),
		)
	}

	fmt.Println(headerStyle.Render("FLAGS:"))
	fmt.Printf("  %-14s %s\n", flagStyle.Render("-h, --help"), dimStyle.Render("Show help for hmcp"))
	fmt.Printf("  %-14s %s\n", flagStyle.Render("-v, --version"), dimStyle.Render("Print version information and check for updates"))

	fmt.Println()
	fmt.Println(dimStyle.Render("💡 Run 'hmcp [command] --help' for detailed parameters on any command."))
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		if errors.Is(err, huh.ErrUserAborted) {
			fmt.Println("\n  " + lipgloss.NewStyle().Foreground(lipgloss.Color("#A855F7")).Bold(true).Render("👋 Bye!"))
			os.Exit(0)
		}
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func init() {
	rootCmd.Flags().BoolP("version", "v", false, "Print the version of hmcp and check for updates")
	rootCmd.SetHelpFunc(renderCustomHelp)
}
