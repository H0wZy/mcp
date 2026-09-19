package config

import (
	"encoding/json"
	"fmt"
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

	data := make(map[string]interface{})
	if content, err := os.ReadFile(cfgPath); err == nil {
		_ = json.Unmarshal(content, &data)
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

	out, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize claude config: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(cfgPath), 0700); err != nil {
		return err
	}

	return os.WriteFile(cfgPath, out, 0600)
}

func RegisterClaudeServer(name, serverCliPath, scope string) error {
	return RegisterClaudeServerCommand(name, "node", []string{filepath.ToSlash(serverCliPath)}, scope)
}

func UnregisterClaudeServer(name, scope string) error {
	cfgPath, err := getClaudeConfigPath(scope)
	if err != nil {
		return err
	}

	content, err := os.ReadFile(cfgPath)
	if err != nil {
		return nil
	}

	var data map[string]interface{}
	if err := json.Unmarshal(content, &data); err != nil {
		return err
	}

	mcpServers, ok := data["mcpServers"].(map[string]interface{})
	if !ok {
		return nil
	}

	delete(mcpServers, name)

	out, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(cfgPath, out, 0600)
}
