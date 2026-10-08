package cmd

import "github.com/charmbracelet/lipgloss"

// Styles shared by install, remove, list and doctor.
var (
	successStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#04B575"))
	agentStyle   = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FFFFFF"))
	arrowStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("#A855F7"))
	dimStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("#888888"))
	warnStyle    = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FFA500"))
	headingStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#C084FC"))
)
