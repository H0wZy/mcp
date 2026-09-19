package config

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
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
	}

	argsFormatted := make([]string, len(args))
	for i, a := range args {
		argsFormatted[i] = fmt.Sprintf("%q", filepath.ToSlash(a))
	}
	sectionHeader := fmt.Sprintf("[mcp_servers.%s]", name)
	newBlock := fmt.Sprintf("%s\ncommand = %q\nargs = [%s]\n", sectionHeader, command, strings.Join(argsFormatted, ", "))

	// Regex to match existing [mcp_servers.<name>] block up to next section or EOF
	re := regexp.MustCompile(fmt.Sprintf(`(?ms)^\[mcp_servers\.%s\].*?(?=^\[|\z)`, regexp.QuoteMeta(name)))

	var updated string
	if re.MatchString(content) {
		updated = re.ReplaceAllString(content, newBlock)
	} else {
		trimmed := strings.TrimRight(content, "\r\n")
		if trimmed != "" {
			updated = trimmed + "\n\n" + newBlock
		} else {
			updated = newBlock
		}
	}

	if err := os.MkdirAll(filepath.Dir(cfgPath), 0700); err != nil {
		return err
	}

	return os.WriteFile(cfgPath, []byte(updated), 0600)
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
	if err != nil {
		return nil
	}

	re := regexp.MustCompile(fmt.Sprintf(`(?ms)^\[mcp_servers\.%s\].*?(?=^\[|\z)`, regexp.QuoteMeta(name)))
	updated := re.ReplaceAllString(string(b), "")

	return os.WriteFile(cfgPath, []byte(strings.TrimSpace(updated)+"\n"), 0600)
}
