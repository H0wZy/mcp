package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/H0wZy/mcp/cli/detector"
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

		fmt.Println("🏥 H0wZy/mcp Environment Diagnostics")
		fmt.Println("=====================================")
		allOk := true
		for _, r := range results {
			if r.Healthy {
				fmt.Printf("✓ %-20s : %s\n", r.DisplayName, r.Path)
				fmt.Printf("  └─ Latency: %v | Status: %s\n", r.Latency, r.Message)
			} else {
				allOk = false
				fmt.Printf("✗ %-20s : Not Ready\n", r.DisplayName)
				fmt.Printf("  └─ %s\n", r.Message)
			}
		}

		fmt.Println()
		if allOk {
			fmt.Println("✅ All detected CLIs are healthy and ready for multi-agent bridges!")
		} else {
			fmt.Println("⚠️  Some CLIs are missing or unreachable. Check paths above.")
		}
		return nil
	},
}

func init() {
	doctorCmd.Flags().BoolVar(&doctorJsonFlag, "json", false, "Output report as JSON")
	rootCmd.AddCommand(doctorCmd)
}
