package cmd

import (
	"os"

	"github.com/H0wZy/mcp/cli/ui"
	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "h0wzy-mcp",
	Short: "H0wZy/mcp — The Ultimate Multi-Agent MCP Hub & Go CLI",
	Long: `H0wZy/mcp centralizes and connects Claude Code, OpenAI Codex, and Google Antigravity
for independent second opinions, cross-reviews, and autonomous multi-agent validation.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		return ui.RunInteractive()
	},
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
