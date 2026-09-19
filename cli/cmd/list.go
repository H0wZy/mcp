package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List available and supported MCP bridges in H0wZy/mcp",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Println("Available Multi-Agent Bridges:")
		fmt.Println("==============================")
		fmt.Println("• claude-antigravity : Claude Code -> Google Antigravity (Gemini 3.1 Pro/Flash)")
		fmt.Println("• claude-codex       : Claude Code -> OpenAI Codex (GPT-5.6 / GPT-6 Astra)")
		fmt.Println("• codex-antigravity  : OpenAI Codex -> Google Antigravity")
		fmt.Println("• antigravity-codex  : Google Antigravity -> OpenAI Codex")
		fmt.Println()
		fmt.Println("Use 'h0wzy-mcp install <bridge>' or 'h0wzy-mcp' for interactive setup.")
	},
}

func init() {
	rootCmd.AddCommand(listCmd)
}
