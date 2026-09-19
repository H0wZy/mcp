package cmd

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/H0wZy/mcp/cli/detector"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
)

var doctorJsonFlag bool

var doctorCmd = &cobra.Command{
	Use:   "doctor",
	Short: "Diagnose local CLI installations, paths, and communication health",
	RunE: func(cmd *cobra.Command, args []string) error {
		tools := detector.DetectTools()
		var results []detector.HealthCheckResult

		for _, t := range tools {
			res := detector.CheckHealth(t)
			results = append(results, res)
		}

		if doctorJsonFlag {
			data, _ := json.MarshalIndent(results, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		titleStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#00ADD8"))
		dividerStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#005F87"))
		checkStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#04B575"))
		crossStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#EF4444"))
		nameStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FFFFFF"))
		pathStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#737373"))
		branchStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#525252"))
		labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#888888"))
		latencyStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#A855F7"))
		okStatusStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#04B575"))
		failStatusStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#EF4444"))
		successBannerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#04B575"))

		fmt.Println(titleStyle.Render("🏥 H0wZy/mcp Environment Diagnostics"))
		fmt.Println(dividerStyle.Render(strings.Repeat("─", 45)))

		allOk := true
		for _, r := range results {
			if r.Healthy {
				latencyStr := fmt.Sprintf("%.1fms", float64(r.Latency.Microseconds())/1000.0)
				if r.Latency >= time.Second {
					latencyStr = fmt.Sprintf("%.2fs", r.Latency.Seconds())
				}

				fmt.Printf("%s %-22s %s %s\n",
					checkStyle.Render("✓"),
					nameStyle.Render(r.DisplayName),
					pathStyle.Render(":"),
					pathStyle.Render(r.Path),
				)
				fmt.Printf("  %s %s %s %s %s %s\n",
					branchStyle.Render("└─"),
					labelStyle.Render("Latency:"),
					latencyStyle.Render(latencyStr),
					branchStyle.Render("|"),
					labelStyle.Render("Status:"),
					okStatusStyle.Render(r.Message),
				)
			} else {
				allOk = false
				fmt.Printf("%s %-22s %s %s\n",
					crossStyle.Render("✗"),
					nameStyle.Render(r.DisplayName),
					pathStyle.Render(":"),
					failStatusStyle.Render("Not Found / Unreachable"),
				)
				fmt.Printf("  %s %s\n",
					branchStyle.Render("└─"),
					failStatusStyle.Render(r.Message),
				)
			}
		}

		fmt.Println()
		if allOk {
			fmt.Println(successBannerStyle.Render("✅ All detected CLIs are healthy and ready for multi-agent bridges!"))
		} else {
			warnStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FFA500"))
			fmt.Println(warnStyle.Render("⚠️  Some CLIs are missing or unreachable. Check paths above."))
		}
		return nil
	},
}

func init() {
	doctorCmd.Flags().BoolVar(&doctorJsonFlag, "json", false, "Output report as JSON")
	rootCmd.AddCommand(doctorCmd)
}
