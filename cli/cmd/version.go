package cmd

import (
	"encoding/json"
	"fmt"
	"runtime"

	"github.com/H0wZy/mcp/cli/version"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
)

var (
	forceCheck bool
	outputJSON bool
)

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the version of hmcp and check for updates",
	Long:  `Displays current version details, runtime platform architecture, and checks whether a newer release is available.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		info, err := version.CheckForUpdate(forceCheck)
		if err != nil {
			info = &version.UpdateInfo{
				CurrentVersion:  version.Current,
				LatestVersion:   version.Current,
				UpdateAvailable: false,
			}
		}

		if outputJSON {
			data := map[string]interface{}{
				"version":          version.Current,
				"os":               runtime.GOOS,
				"arch":             runtime.GOARCH,
				"latest_version":   info.LatestVersion,
				"update_available": info.UpdateAvailable,
				"release_url":      info.ReleaseURL,
			}
			out, _ := json.MarshalIndent(data, "", "  ")
			fmt.Println(string(out))
			return nil
		}

		boldStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#00ADD8"))
		dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#888888"))
		successStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#04B575"))
		alertStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FFA500"))

		fmt.Printf("%s %s (%s/%s)\n",
			boldStyle.Render("hmcp"),
			version.Current,
			runtime.GOOS,
			runtime.GOARCH,
		)

		if info.UpdateAvailable {
			fmt.Println()
			fmt.Println(alertStyle.Render(fmt.Sprintf("⚡ A new version is available: %s → %s", version.Current, info.LatestVersion)))
			fmt.Println(dimStyle.Render("   Run 'hmcp upgrade' to update to the latest release."))
		} else {
			fmt.Printf("%s You are running the latest version!\n", successStyle.Render("✓"))
		}

		return nil
	},
}

func init() {
	versionCmd.Flags().BoolVarP(&forceCheck, "check", "c", false, "Force remote registry check (ignore local cache)")
	versionCmd.Flags().BoolVarP(&outputJSON, "json", "j", false, "Output version information as JSON")
	rootCmd.AddCommand(versionCmd)
	rootCmd.Version = version.Current
}
