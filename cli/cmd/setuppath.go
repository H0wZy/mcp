package cmd

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/spf13/cobra"
)

var setupPathCmd = &cobra.Command{
	Use:   "setup-path",
	Short: "Install binary shims and aliases into user PATH (hmcp, hwzmcp, h0wzy-mcp)",
	Long: `Registers executable shims and aliases in your user PATH directory (~/.local/bin or npm global)
so that you can run 'hmcp', 'hwzmcp', or 'h0wzy-mcp' from any terminal without full paths.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}

		// Prefer ~/.local/bin as standard cross-platform user bin directory
		targetDir := filepath.Join(home, ".local", "bin")
		if err := os.MkdirAll(targetDir, 0755); err != nil {
			return fmt.Errorf("failed to create target directory %s: %w", targetDir, err)
		}

		// Determine source executable
		exePath, err := os.Executable()
		if err != nil {
			return err
		}

		// If running via temporary `go run` or inside a build folder, try to build/copy cleanly
		isTemp := strings.Contains(exePath, "go-build") || strings.Contains(exePath, "Temp")
		aliases := []string{"hmcp", "hwzmcp", "h0wzy-mcp"}

		if isTemp {
			// Compile directly to ~/.local/bin/hmcp.exe
			mainExe := filepath.Join(targetDir, "hmcp.exe")
			if runtime.GOOS != "windows" {
				mainExe = filepath.Join(targetDir, "hmcp")
			}

			fmt.Println("Compiling native binary to user bin directory...")
			buildCmd := exec.Command("go", "build", "-o", mainExe, "./cli")
			buildCmd.Stdout = os.Stdout
			buildCmd.Stderr = os.Stderr
			if err := buildCmd.Run(); err != nil {
				return fmt.Errorf("failed to compile binary to %s: %w", mainExe, err)
			}
			exePath = mainExe
		}

		// Copy executable to all alias names in targetDir
		for _, alias := range aliases {
			dstName := alias
			if runtime.GOOS == "windows" {
				dstName += ".exe"
			}
			dstPath := filepath.Join(targetDir, dstName)

			if dstPath != exePath {
				if err := copyFile(exePath, dstPath); err != nil {
					fmt.Printf("⚠️ Warning: could not copy %s: %v\n", dstName, err)
				}
			}

			if runtime.GOOS != "windows" {
				_ = os.Chmod(dstPath, 0755)
			} else {
				// Also create .cmd batch wrappers for Windows cmd.exe / powershell compatibility
				cmdWrapper := filepath.Join(targetDir, alias+".cmd")
				cmdContent := fmt.Sprintf("@echo off\r\n\"%%~dp0%s.exe\" %%*\r\n", alias)
				_ = os.WriteFile(cmdWrapper, []byte(cmdContent), 0644)
			}
		}

		// Check if targetDir is in current PATH
		pathEnv := os.Getenv("PATH")
		inPath := false
		for _, p := range filepath.SplitList(pathEnv) {
			if strings.EqualFold(filepath.Clean(p), filepath.Clean(targetDir)) {
				inPath = true
				break
			}
		}

		fmt.Printf("✅ Installed binary aliases in: %s\n", targetDir)
		for _, a := range aliases {
			fmt.Printf("   • %s\n", a)
		}

		if inPath {
			fmt.Println("\n🎉 Ready! You can immediately run 'hmcp' in any terminal window.")
		} else {
			fmt.Printf("\n⚠️ Notice: %s was not found in your current PATH.\n", targetDir)
			if runtime.GOOS == "windows" {
				fmt.Println("   To add it permanently to your User PATH, run in PowerShell:")
				fmt.Printf("   [Environment]::SetEnvironmentVariable('PATH', [Environment]::GetEnvironmentVariable('PATH', 'User') + ';%s', 'User')\n", targetDir)
			} else {
				fmt.Println("   Add this line to your ~/.bashrc or ~/.zshrc:")
				fmt.Printf("   export PATH=\"%s:$PATH\"\n", targetDir)
			}
		}

		return nil
	},
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err = io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

func init() {
	rootCmd.AddCommand(setupPathCmd)
}
