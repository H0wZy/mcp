package config

import (
	"os"
	"path/filepath"
)

type ClaudeMCPEntry struct {
	Type    string   `json:"type,omitempty"`
	Command string   `json:"command"`
	Args    []string `json:"args"`
}

func getClaudeConfigPath(scope string) (string, error) {
	if scope == "project" || scope == "local" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", err
		}
		return filepath.Join(cwd, ".mcp.json"), nil
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".claude.json"), nil
}

func RegisterClaudeServerCommand(name, command string, args []string, scope string) error {
	cfgPath, err := getClaudeConfigPath(scope)
	if err != nil {
		return err
	}

	data, err := readJSONObject(cfgPath)
	if err != nil {
		return err
	}

	mcpServers, ok := data["mcpServers"].(map[string]interface{})
	if !ok {
		mcpServers = make(map[string]interface{})
		data["mcpServers"] = mcpServers
	}

	mcpServers[name] = map[string]interface{}{
		"type":    "stdio",
		"command": command,
		"args":    args,
	}

	return writeJSONObject(cfgPath, data)
}

func RegisterClaudeServer(name, serverCliPath, scope string) error {
	return RegisterClaudeServerCommand(name, "node", []string{filepath.ToSlash(serverCliPath)}, scope)
}

func UnregisterClaudeServer(name, scope string) error {
	cfgPath, err := getClaudeConfigPath(scope)
	if err != nil {
		return err
	}

	if _, err := os.Stat(cfgPath); os.IsNotExist(err) {
		return nil
	}

	data, err := readJSONObject(cfgPath)
	if err != nil {
		return err
	}

	mcpServers, ok := data["mcpServers"].(map[string]interface{})
	if !ok {
		return nil
	}

	delete(mcpServers, name)

	return writeJSONObject(cfgPath, data)
}
