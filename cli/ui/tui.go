package ui

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/H0wZy/mcp/cli/config"
	"github.com/H0wZy/mcp/cli/detector"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

var (
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#00ADD8")).
			MarginBottom(1)

	successStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#04B575"))

	dimStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#888888"))
)

func RunInteractive() error {
	fmt.Println(titleStyle.Render("🚀 H0wZy/mcp — Multi-Agent MCP Hub Setup"))

	// 1. Scan environment
	fmt.Println("Scanning local AI developer CLIs...")
	tools := detector.DetectTools()

	var detectedMap = make(map[string]detector.DetectedTool)
	for _, t := range tools {
		detectedMap[t.Name] = t
		if t.Installed {
			fmt.Printf("  %s %s (%s)\n", successStyle.Render("✓"), t.DisplayName, dimStyle.Render(t.Path))
		} else {
			fmt.Printf("  %s %s (not found)\n", dimStyle.Render("-"), t.DisplayName)
		}
	}
	fmt.Println()

	// 2. Build available bridge options
	var bridgeOptions []huh.Option[string]

	if detectedMap["claude"].Installed && detectedMap["agy"].Installed {
		bridgeOptions = append(bridgeOptions, huh.NewOption("Claude Code -> Google Antigravity (Gemini 3.1 Pro/Flash)", "claude-antigravity"))
	}
	if detectedMap["claude"].Installed && detectedMap["codex"].Installed {
		bridgeOptions = append(bridgeOptions, huh.NewOption("Claude Code -> OpenAI Codex (GPT-5.6 / GPT-6 Astra)", "claude-codex"))
	}
	if detectedMap["codex"].Installed && detectedMap["agy"].Installed {
		bridgeOptions = append(bridgeOptions, huh.NewOption("OpenAI Codex -> Google Antigravity (Gemini 3.1)", "codex-antigravity"))
	}
	if detectedMap["agy"].Installed && detectedMap["codex"].Installed {
		bridgeOptions = append(bridgeOptions, huh.NewOption("Google Antigravity -> OpenAI Codex", "antigravity-codex"))
	}

	if len(bridgeOptions) == 0 {
		fmt.Println("⚠️  No pairs of supported CLIs found on this machine to interconnect.")
		fmt.Println("   Install at least two of: Claude Code, OpenAI Codex, or Google Antigravity.")
		return nil
	}

	var selectedBridges []string
	var selectedScope string
	var confirm bool

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewMultiSelect[string]().
				Title("Select MCP bridges to configure:").
				Options(bridgeOptions...).
				Value(&selectedBridges),

			huh.NewSelect[string]().
				Title("Configuration Scope:").
				Options(
					huh.NewOption("User (Global across all projects)", "user"),
					huh.NewOption("Project (Local to current workspace)", "project"),
				).
				Value(&selectedScope),

			huh.NewConfirm().
				Title("Apply configuration now?").
				Value(&confirm),
		),
	)

	if err := form.Run(); err != nil {
		return err
	}

	if !confirm || len(selectedBridges) == 0 {
		fmt.Println("Cancelled. No configurations were changed.")
		return nil
	}

	// 3. Apply configurations
	repoRoot, err := os.Getwd()
	if err != nil {
		return err
	}

	antigravityServerPath := filepath.Join(repoRoot, "servers", "antigravity", "bin", "cli.js")
	codexServerPath := filepath.Join(repoRoot, "servers", "codex", "bin", "cli.js")

	fmt.Println("\nApplying configuration...")
	for _, bridge := range selectedBridges {
		switch bridge {
		case "claude-antigravity":
			if err := config.RegisterClaudeServer("antigravity", antigravityServerPath, selectedScope); err != nil {
				fmt.Printf("❌ Failed to register claude-antigravity: %v\n", err)
			} else {
				fmt.Println(successStyle.Render("✓") + " Connected: Claude Code -> Google Antigravity")
			}
		case "claude-codex":
			if err := config.RegisterClaudeServer("codex", codexServerPath, selectedScope); err != nil {
				fmt.Printf("❌ Failed to register claude-codex: %v\n", err)
			} else {
				fmt.Println(successStyle.Render("✓") + " Connected: Claude Code -> OpenAI Codex")
			}
		case "codex-antigravity":
			if err := config.RegisterCodexServer("antigravity", antigravityServerPath); err != nil {
				fmt.Printf("❌ Failed to register codex-antigravity: %v\n", err)
			} else {
				fmt.Println(successStyle.Render("✓") + " Connected: OpenAI Codex -> Google Antigravity")
			}
		case "antigravity-codex":
			if err := config.RegisterAntigravityServer("codex", codexServerPath); err != nil {
				fmt.Printf("❌ Failed to register antigravity-codex: %v\n", err)
			} else {
				fmt.Println(successStyle.Render("✓") + " Connected: Google Antigravity -> OpenAI Codex")
			}
		}
	}

	fmt.Println("\n" + successStyle.Render("✅ All selected bridges configured successfully!"))
	fmt.Println("Restart your agent CLI to activate the newly connected tools.")
	return nil
}
