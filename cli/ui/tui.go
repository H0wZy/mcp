package ui

import (
	"errors"
	"fmt"

	"github.com/H0wZy/mcp/cli/config"
	"github.com/H0wZy/mcp/cli/detector"
	"github.com/H0wZy/mcp/cli/version"
	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

var (
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#C084FC")).
			MarginBottom(1)

	successStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#04B575"))

	dimStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#888888"))
)

func newHubTheme() *huh.Theme {
	t := huh.ThemeCharm()

	purple := lipgloss.Color("#A855F7")
	lilac := lipgloss.Color("#C084FC")
	emerald := lipgloss.Color("#04B575")
	dimText := lipgloss.Color("#71717A")
	white := lipgloss.Color("#FFFFFF")
	buttonBg := lipgloss.Color("#27272A")

	// Group & field titles
	t.Focused.Title = lipgloss.NewStyle().Bold(true).Foreground(lilac)
	t.Blurred.Title = lipgloss.NewStyle().Foreground(dimText)

	// Select / MultiSelect
	t.Focused.SelectSelector = lipgloss.NewStyle().Bold(true).Foreground(purple)
	t.Focused.SelectedOption = lipgloss.NewStyle().Bold(true).Foreground(white)
	t.Focused.SelectedPrefix = lipgloss.NewStyle().Bold(true).Foreground(emerald)
	t.Focused.UnselectedPrefix = lipgloss.NewStyle().Foreground(dimText)
	t.Focused.Option = lipgloss.NewStyle().Foreground(lipgloss.Color("#D4D4D8"))

	// Buttons (Confirm)
	t.Focused.FocusedButton = lipgloss.NewStyle().
		Bold(true).
		Foreground(white).
		Background(purple).
		Padding(0, 2).
		MarginRight(1)

	t.Focused.BlurredButton = lipgloss.NewStyle().
		Foreground(dimText).
		Background(buttonBg).
		Padding(0, 2).
		MarginRight(1)

	// Keymap help footer
	t.Help.ShortKey = lipgloss.NewStyle().Bold(true).Foreground(purple)
	t.Help.ShortDesc = lipgloss.NewStyle().Foreground(dimText)
	t.Help.ShortSeparator = lipgloss.NewStyle().Foreground(lipgloss.Color("#3F3F46"))

	return t
}

func newHubKeyMap() *huh.KeyMap {
	km := huh.NewDefaultKeyMap()
	km.Quit = key.NewBinding(
		key.WithKeys("ctrl+c", "esc"),
		key.WithHelp("esc", "quit"),
	)
	return km
}

func RunInteractive() error {
	PrintBanner()

	if info, err := version.CheckForUpdate(false); err == nil && info != nil && info.UpdateAvailable {
		if notice := version.RenderNotice(info); notice != "" {
			fmt.Println(notice)
		}
	}

	// 1. Scan environment
	scanHeader := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#C084FC"))
	fmt.Println(scanHeader.Render("🔍 Scanning local AI developer CLIs..."))
	tools := detector.DetectTools()

	var detectedMap = make(map[string]detector.DetectedTool)
	for _, t := range tools {
		detectedMap[t.Name] = t
		if t.Installed {
			fmt.Printf("  %s %-22s %s\n",
				successStyle.Render("✓"),
				lipgloss.NewStyle().Bold(true).Render(t.DisplayName),
				dimStyle.Render("("+t.Path+")"),
			)
		} else {
			fmt.Printf("  %s %-22s %s\n",
				dimStyle.Render("-"),
				dimStyle.Render(t.DisplayName),
				dimStyle.Render("(not detected)"),
			)
		}
	}
	fmt.Println()

	// 2. Build available bridge options
	var bridgeOptions []huh.Option[string]

	if detectedMap["claude"].Installed && detectedMap["agy"].Installed {
		bridgeOptions = append(bridgeOptions, huh.NewOption("Claude Code ↔ Google Antigravity (Gemini 3.1 Pro/Flash)", "claude-antigravity"))
	}
	if detectedMap["claude"].Installed && detectedMap["codex"].Installed {
		bridgeOptions = append(bridgeOptions, huh.NewOption("Claude Code ↔ OpenAI Codex (GPT-5.6 / GPT-6 Astra)", "claude-codex"))
	}
	if detectedMap["codex"].Installed && detectedMap["agy"].Installed {
		bridgeOptions = append(bridgeOptions, huh.NewOption("OpenAI Codex ↔ Google Antigravity (Gemini 3.1)", "codex-antigravity"))
	}
	if detectedMap["agy"].Installed && detectedMap["codex"].Installed {
		bridgeOptions = append(bridgeOptions, huh.NewOption("Google Antigravity ↔ OpenAI Codex", "antigravity-codex"))
	}

	if len(bridgeOptions) == 0 {
		warnStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FFA500"))
		fmt.Println(warnStyle.Render("⚠️  No pairs of supported CLIs found on this machine to interconnect."))
		fmt.Println(dimStyle.Render("   Install at least two of: Claude Code, OpenAI Codex, or Google Antigravity."))
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
	).
		WithTheme(newHubTheme()).
		WithKeyMap(newHubKeyMap())

	if err := form.Run(); err != nil {
		if errors.Is(err, huh.ErrUserAborted) {
			fmt.Println("\n  " + lipgloss.NewStyle().Foreground(lipgloss.Color("#A855F7")).Bold(true).Render("👋 Bye!"))
			return nil
		}
		return err
	}

	if !confirm || len(selectedBridges) == 0 {
		fmt.Println("\n  " + lipgloss.NewStyle().Foreground(lipgloss.Color("#888888")).Render("👋 Cancelled. No configurations were changed."))
		return nil
	}

	// 3. Apply configurations
	fmt.Println("\n" + lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#C084FC")).Render("⚡ Applying configuration..."))
	arrowStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#A855F7"))

	for _, bridge := range selectedBridges {
		switch bridge {
		case "claude-antigravity":
			serverCmd, serverArgs := config.ResolveServerScript("antigravity")
			if err := config.RegisterClaudeServerCommand("antigravity", serverCmd, serverArgs, selectedScope); err != nil {
				fmt.Printf("  %s Failed to register claude-antigravity: %v\n", lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#EF4444")).Render("✗"), err)
			} else {
				fmt.Printf("  %s Connected: %s %s %s\n",
					successStyle.Render("✓"),
					lipgloss.NewStyle().Bold(true).Render("Claude Code"),
					arrowStyle.Render("↔"),
					lipgloss.NewStyle().Bold(true).Render("Google Antigravity"),
				)
			}
		case "claude-codex":
			serverCmd, serverArgs := config.ResolveServerScript("codex")
			if err := config.RegisterClaudeServerCommand("codex", serverCmd, serverArgs, selectedScope); err != nil {
				fmt.Printf("  %s Failed to register claude-codex: %v\n", lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#EF4444")).Render("✗"), err)
			} else {
				fmt.Printf("  %s Connected: %s %s %s\n",
					successStyle.Render("✓"),
					lipgloss.NewStyle().Bold(true).Render("Claude Code"),
					arrowStyle.Render("↔"),
					lipgloss.NewStyle().Bold(true).Render("OpenAI Codex"),
				)
			}
		case "codex-antigravity":
			serverCmd, serverArgs := config.ResolveServerScript("antigravity")
			if err := config.RegisterCodexServerCommand("antigravity", serverCmd, serverArgs); err != nil {
				fmt.Printf("  %s Failed to register codex-antigravity: %v\n", lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#EF4444")).Render("✗"), err)
			} else {
				fmt.Printf("  %s Connected: %s %s %s\n",
					successStyle.Render("✓"),
					lipgloss.NewStyle().Bold(true).Render("OpenAI Codex"),
					arrowStyle.Render("↔"),
					lipgloss.NewStyle().Bold(true).Render("Google Antigravity"),
				)
			}
		case "antigravity-codex":
			serverCmd, serverArgs := config.ResolveServerScript("codex")
			if err := config.RegisterAntigravityServerCommand("codex", serverCmd, serverArgs); err != nil {
				fmt.Printf("  %s Failed to register antigravity-codex: %v\n", lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#EF4444")).Render("✗"), err)
			} else {
				fmt.Printf("  %s Connected: %s %s %s\n",
					successStyle.Render("✓"),
					lipgloss.NewStyle().Bold(true).Render("Google Antigravity"),
					arrowStyle.Render("↔"),
					lipgloss.NewStyle().Bold(true).Render("OpenAI Codex"),
				)
			}
		}
	}

	fmt.Println("\n" + successStyle.Render("✅ All selected bridges configured successfully!"))
	fmt.Println(dimStyle.Render("💡 Restart your host agent CLI to activate the newly connected tools."))
	return nil
}
