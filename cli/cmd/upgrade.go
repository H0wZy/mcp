package cmd

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/H0wZy/mcp/cli/version"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
)

var forceUpgrade bool

var upgradeCmd = &cobra.Command{
	Use:     "upgrade",
	Aliases: []string{"update"},
	Short:   "Upgrade hmcp to the latest release",
	Long:    `Checks the remote release registry (npm and GitHub) and upgrades the local installation to the newest version.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		successStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#04B575"))
		boldStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#C084FC"))

		fmt.Println("Checking for updates...")
		info, err := version.CheckForUpdate(true)
		if err != nil {
			return fmt.Errorf("failed to check for updates: %w", err)
		}

		if !info.UpdateAvailable && !forceUpgrade {
			fmt.Printf("%s You are already running the latest version of hmcp (%s).\n",
				successStyle.Render("✓"),
				version.Current,
			)
			return nil
		}

		fmt.Printf("Upgrading hmcp: %s → %s...\n", version.Current, info.LatestVersion)

		// 1. Check if npm global is present and manages @h0wzy/mcp
		npmCheck := exec.Command("npm", "list", "-g", "@h0wzy/mcp")
		npmOut, _ := npmCheck.Output()
		if strings.Contains(string(npmOut), "@h0wzy/mcp") {
			fmt.Println("Updating via npm global...")
			npmUpgrade := exec.Command("npm", "install", "-g", "@h0wzy/mcp@latest")
			npmUpgrade.Stdout = os.Stdout
			npmUpgrade.Stderr = os.Stderr
			if err := npmUpgrade.Run(); err == nil {
				fmt.Printf("\n%s Successfully upgraded @h0wzy/mcp to v%s via npm!\n",
					successStyle.Render("✅"),
					info.LatestVersion,
				)
				return nil
			}
		}

		// 2. Direct binary upgrade from GitHub Releases
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}

		assetName := getPlatformAssetName()
		if assetName == "" {
			return fmt.Errorf("unsupported platform for direct binary download: %s/%s", runtime.GOOS, runtime.GOARCH)
		}

		downloadURL := fmt.Sprintf("https://github.com/H0wZy/mcp/releases/download/v%s/%s", info.LatestVersion, assetName)
		targetDir := filepath.Join(home, ".local", "bin")
		_ = os.MkdirAll(targetDir, 0755)

		tempFile := filepath.Join(targetDir, "hmcp-download.tmp")
		fmt.Printf("Downloading binary from %s...\n", downloadURL)

		resp, err := http.Get(downloadURL)
		if err != nil || resp.StatusCode != 200 {
			if resp != nil {
				resp.Body.Close()
			}
			return fmt.Errorf("could not download release asset (status: %v): %w", resp, err)
		}
		defer resp.Body.Close()

		outFile, err := os.OpenFile(tempFile, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
		if err != nil {
			return err
		}
		if _, err := io.Copy(outFile, resp.Body); err != nil {
			outFile.Close()
			_ = os.Remove(tempFile)
			return err
		}
		outFile.Close()

		// Replace aliases
		aliases := []string{"hmcp", "hwzmcp", "h0wzy-mcp"}
		for _, alias := range aliases {
			dst := filepath.Join(targetDir, alias)
			if runtime.GOOS == "windows" {
				dst += ".exe"
			}
			_ = copyFile(tempFile, dst)
			if runtime.GOOS != "windows" {
				_ = os.Chmod(dst, 0755)
			}
		}
		_ = os.Remove(tempFile)

		fmt.Printf("\n%s Successfully upgraded %s to v%s in %s!\n",
			successStyle.Render("✅"),
			boldStyle.Render("hmcp"),
			info.LatestVersion,
			targetDir,
		)

		return nil
	},
}

func getPlatformAssetName() string {
	switch runtime.GOOS {
	case "windows":
		return "h0wzy-mcp-windows-amd64.exe"
	case "darwin":
		if runtime.GOARCH == "arm64" {
			return "h0wzy-mcp-darwin-arm64"
		}
		return "h0wzy-mcp-darwin-amd64"
	case "linux":
		return "h0wzy-mcp-linux-amd64"
	}
	return ""
}

func init() {
	upgradeCmd.Flags().BoolVarP(&forceUpgrade, "force", "f", false, "Force upgrade even if already at latest version")
	rootCmd.AddCommand(upgradeCmd)
}
