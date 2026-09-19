package config

import (
	"os"
	"path/filepath"
)

// ResolveServerScript locates the entrypoint for a given server name.
// It checks:
// 1. Working directory: ./servers/<name>/bin/cli.js
// 2. Binary location relative: ../servers/<name>/bin/cli.js
// 3. User's known repository location: ~/projects/mcp/servers/<name>/bin/cli.js
// 4. Fallback to npx command for zero-repo standalone runners
func ResolveServerScript(name string) (command string, args []string) {
	// 1. Current working directory
	cwd, err := os.Getwd()
	if err == nil {
		localPath := filepath.Join(cwd, "servers", name, "bin", "cli.js")
		if _, err := os.Stat(localPath); err == nil {
			abs, _ := filepath.Abs(localPath)
			return "node", []string{filepath.ToSlash(abs)}
		}
	}

	// 2. Binary relative directory
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidate := filepath.Join(exeDir, "..", "servers", name, "bin", "cli.js")
		if _, err := os.Stat(candidate); err == nil {
			abs, _ := filepath.Abs(candidate)
			return "node", []string{filepath.ToSlash(abs)}
		}
	}

	// 3. Known repository clone in user's home
	if home, err := os.UserHomeDir(); err == nil {
		candidate := filepath.Join(home, "projects", "mcp", "servers", name, "bin", "cli.js")
		if _, err := os.Stat(candidate); err == nil {
			return "node", []string{filepath.ToSlash(candidate)}
		}
	}

	// 4. Worldwide zero-repo fallback via npx
	return "npx", []string{"-y", "@h0wzy/mcp-server-" + name}
}
