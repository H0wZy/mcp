package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

func getAntigravityConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".gemini", "config", "mcp_config.json"), nil
}

func RegisterAntigravityServer(name, serverCliPath string) error {
	cfgPath, err := getAntigravityConfigPath()
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
		"command": "node",
		"args":    []string{filepath.ToSlash(serverCliPath)},
	}

	out, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize antigravity config: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(cfgPath), 0755); err != nil {
		return err
	}

	return os.WriteFile(cfgPath, out, 0644)
}

func UnregisterAntigravityServer(name string) error {
	cfgPath, err := getAntigravityConfigPath()
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

	return os.WriteFile(cfgPath, out, 0644)
}
