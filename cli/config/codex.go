package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func getCodexConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".codex", "config.toml"), nil
}

func RegisterCodexServerCommand(name, command string, args []string) error {
	cfgPath, err := getCodexConfigPath()
	if err != nil {
		return err
	}

	content := ""
	if b, err := os.ReadFile(cfgPath); err == nil {
		content = string(b)
	} else if !os.IsNotExist(err) {
		return err
	}

	argsFormatted := make([]string, len(args))
	for i, a := range args {
		argsFormatted[i] = fmt.Sprintf("%q", filepath.ToSlash(a))
	}
	table := "mcp_servers." + name
	newBlock := fmt.Sprintf("[%s]\ncommand = %q\nargs = [%s]\n", table, command, strings.Join(argsFormatted, ", "))

	return writeFileAtomic(cfgPath, []byte(upsertTOMLSection(content, table, newBlock)), 0600)
}

func RegisterCodexServer(name, serverCliPath string) error {
	return RegisterCodexServerCommand(name, "node", []string{filepath.ToSlash(serverCliPath)})
}

func UnregisterCodexServer(name string) error {
	cfgPath, err := getCodexConfigPath()
	if err != nil {
		return err
	}

	b, err := os.ReadFile(cfgPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}

	return writeFileAtomic(cfgPath, []byte(removeTOMLSection(string(b), "mcp_servers."+name)), 0600)
}
