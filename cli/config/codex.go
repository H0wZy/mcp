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

// CodexChainEnvVars are the loop-guard variables Codex must forward to bridge
// servers. Codex only passes an allow-list of env vars to MCP servers, so
// without this list a nested bridge can't see the chain it belongs to.
var CodexChainEnvVars = []string{
	"H0WZY_MCP_RUN_ID",
	"H0WZY_MCP_CHAIN",
	"H0WZY_MCP_DEPTH",
	"H0WZY_MCP_DEADLINE",
	"H0WZY_MCP_STATE_DIR",
	"H0WZY_MCP_MAX_DEPTH",
	"H0WZY_MCP_MAX_CALLS",
	"H0WZY_MCP_ALLOW_REVISIT",
	"H0WZY_MCP_DEADLINE_MINUTES",
	"H0WZY_MCP_CHAIN_LOG",
}

// CodexTeamEnvVars are the team limits (spec 007) the team server reads. The
// Codex team entry forwards them on top of CodexChainEnvVars.
var CodexTeamEnvVars = []string{
	"H0WZY_TEAM_MAX_TEAMMATES",
	"H0WZY_TEAM_MAX_TURNS",
	"H0WZY_TEAM_MAX_TOTAL_TURNS",
	"H0WZY_TEAM_DEADLINE_MINUTES",
	"H0WZY_TEAM_TURN_MINUTES",
	"H0WZY_TEAM_RESULT_CAP",
}

// codexTeamEnvVars is the env_vars allow-list of the Codex team entry.
func codexTeamEnvVars() []string {
	return append(append([]string(nil), CodexChainEnvVars...), CodexTeamEnvVars...)
}

const (
	// CodexToolTimeoutSec covers the longest delegation (60 min) plus margin (research D7).
	CodexToolTimeoutSec = 3900
	// CodexStartupTimeoutSec leaves room for a cold `npx -y` download.
	CodexStartupTimeoutSec = 60
)

// tomlStringArray formats values as a TOML array of basic strings.
func tomlStringArray(values []string) string {
	quoted := make([]string, len(values))
	for i, v := range values {
		quoted[i] = fmt.Sprintf("%q", v)
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}

// RegisterCodexServerCommand writes a stdio MCP server section into Codex's
// config.toml. "--host codex" is appended to args, and the section also gets the
// loop-guard env_vars allow-list and long tool / startup timeouts. Only the
// [mcp_servers.<name>] section is replaced: sub-tables such as
// [mcp_servers.<name>.env] and every other setting are kept.
func RegisterCodexServerCommand(name, command string, args []string) error {
	return registerCodexServer(name, command, args, CodexChainEnvVars)
}

func registerCodexServer(name, command string, args, envVars []string) error {
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

	args = withHostArg(args, AgentCodex)
	slashed := make([]string, len(args))
	for i, a := range args {
		slashed[i] = filepath.ToSlash(a)
	}
	table := "mcp_servers." + name
	newBlock := fmt.Sprintf("[%s]\ncommand = %q\nargs = %s\nenv_vars = %s\ntool_timeout_sec = %d\nstartup_timeout_sec = %d\n",
		table, command, tomlStringArray(slashed), tomlStringArray(envVars),
		CodexToolTimeoutSec, CodexStartupTimeoutSec)

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
