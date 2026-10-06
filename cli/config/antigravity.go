package config

import (
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

func RegisterAntigravityServerCommand(name, command string, args []string) error {
	cfgPath, err := getAntigravityConfigPath()
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

	formattedArgs := make([]string, len(args))
	for i, a := range args {
		formattedArgs[i] = filepath.ToSlash(a)
	}

	mcpServers[name] = map[string]interface{}{
		"command": command,
		"args":    formattedArgs,
	}

	return writeJSONObject(cfgPath, data)
}

func RegisterAntigravityServer(name, serverCliPath string) error {
	return RegisterAntigravityServerCommand(name, "node", []string{filepath.ToSlash(serverCliPath)})
}

func UnregisterAntigravityServer(name string) error {
	cfgPath, err := getAntigravityConfigPath()
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
