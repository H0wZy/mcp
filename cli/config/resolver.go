package config

import (
	"os"
	"path/filepath"
)

// ResolveServerScript locates the entrypoint for a given server name
// ("claude", "codex", "antigravity"). It checks:
// 0. $H0WZY_MCP_REPO/servers/<name>/bin/cli.js (a clone the developer points to)
// 1. Working directory: ./servers/<name>/bin/cli.js (running from a clone)
// 2. Binary location relative: <exe dir>/../servers/<name>/bin/cli.js
// 3. Fallback to `npx -y @h0wzy/mcp-server-<name>` for standalone installs
func ResolveServerScript(name string) (command string, args []string) {
	// 0. Explicit clone location
	if repo := os.Getenv("H0WZY_MCP_REPO"); repo != "" {
		candidate := filepath.Join(repo, "servers", name, "bin", "cli.js")
		if _, err := os.Stat(candidate); err == nil {
			abs, _ := filepath.Abs(candidate)
			return "node", []string{filepath.ToSlash(abs)}
		}
	}

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

	// 3. Zero-repo fallback via npx
	return "npx", []string{"-y", "@h0wzy/mcp-server-" + name}
}
