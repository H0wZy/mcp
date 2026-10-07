package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// withHome points os.UserHomeDir at a fresh temp dir on every platform.
func withHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	return home
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestCodexRegisterIntoEmptyConfig(t *testing.T) {
	home := withHome(t)

	if err := RegisterCodexServerCommand("antigravity", "node", []string{"/srv/agy/cli.js"}); err != nil {
		t.Fatalf("register: %v", err)
	}

	got := readFile(t, filepath.Join(home, ".codex", "config.toml"))
	want := "[mcp_servers.antigravity]\n" +
		"command = \"node\"\n" +
		"args = [\"/srv/agy/cli.js\", \"--host\", \"codex\"]\n" +
		"env_vars = [\"H0WZY_MCP_RUN_ID\", \"H0WZY_MCP_CHAIN\", \"H0WZY_MCP_DEPTH\", \"H0WZY_MCP_DEADLINE\", \"H0WZY_MCP_STATE_DIR\", \"H0WZY_MCP_MAX_DEPTH\", \"H0WZY_MCP_MAX_CALLS\", \"H0WZY_MCP_ALLOW_REVISIT\", \"H0WZY_MCP_DEADLINE_MINUTES\", \"H0WZY_MCP_CHAIN_LOG\", \"H0WZY_MCP_USER_SERVERS\"]\n" +
		"tool_timeout_sec = 3900\n" +
		"startup_timeout_sec = 60\n"
	if got != want {
		t.Fatalf("config mismatch\n got: %q\nwant: %q", got, want)
	}
}

func TestCodexRegisterClaudeBridgeKeepsUserEnvAndOtherServers(t *testing.T) {
	home := withHome(t)
	cfg := filepath.Join(home, ".codex", "config.toml")
	writeFile(t, cfg, strings.Join([]string{
		`model = "gpt-6-astra"`,
		``,
		`[mcp_servers.claude]`,
		`command = "npx"`,
		`args = ["-y", "@h0wzy/mcp-server-claude"]`,
		``,
		`[mcp_servers.claude.env]`,
		`CLAUDE_MODEL = "sonnet"`,
		`H0WZY_MCP_MAX_DEPTH = "3"`,
		``,
		`[mcp_servers.docs]`,
		`command = "docs-server"`,
		`args = ["--port", "1"]`,
		``,
	}, "\n"))

	for i := 0; i < 2; i++ { // re-register must be stable
		if err := RegisterCodexServerCommand("claude", "npx", []string{"-y", "@h0wzy/mcp-server-claude"}); err != nil {
			t.Fatalf("register #%d: %v", i, err)
		}
	}

	got := readFile(t, cfg)
	for _, want := range []string{
		`model = "gpt-6-astra"`,
		"[mcp_servers.claude]\ncommand = \"npx\"\nargs = [\"-y\", \"@h0wzy/mcp-server-claude\", \"--host\", \"codex\"]\nenv_vars = [",
		"tool_timeout_sec = 3900\nstartup_timeout_sec = 60\n",
		"[mcp_servers.claude.env]\nCLAUDE_MODEL = \"sonnet\"\nH0WZY_MCP_MAX_DEPTH = \"3\"",
		"[mcp_servers.docs]\ncommand = \"docs-server\"\nargs = [\"--port\", \"1\"]",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("expected config to contain %q, got:\n%s", want, got)
		}
	}
	for _, once := range []string{"[mcp_servers.claude]", "env_vars", "--host", "tool_timeout_sec", "[mcp_servers.claude.env]"} {
		if n := strings.Count(got, once); n != 1 {
			t.Errorf("expected %q once, found %d times:\n%s", once, n, got)
		}
	}
	for _, v := range CodexChainEnvVars {
		if !strings.Contains(got, `"`+v+`"`) {
			t.Errorf("env_vars is missing %s:\n%s", v, got)
		}
	}
	if info, err := os.Stat(cfg); err == nil && runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Errorf("config mode = %v, want 0600", info.Mode().Perm())
	}
}

func TestRegisterReplacesStaleHostArg(t *testing.T) {
	home := withHome(t)
	if err := RegisterAntigravityServerCommand("claude", "node", []string{"/srv/claude/cli.js", "--host", "old", "--host=older"}); err != nil {
		t.Fatalf("register: %v", err)
	}
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(readFile(t, filepath.Join(home, ".gemini", "config", "mcp_config.json"))), &data); err != nil {
		t.Fatal(err)
	}
	args := data["mcpServers"].(map[string]interface{})["claude"].(map[string]interface{})["args"].([]interface{})
	if got := fmt.Sprint(args); got != "[/srv/claude/cli.js --host antigravity]" {
		t.Fatalf("args = %s", got)
	}
}

func TestJSONHostsGetHostArg(t *testing.T) {
	home := withHome(t)
	project := t.TempDir()
	t.Chdir(project)

	if err := RegisterClaudeServerCommand("codex", "npx", []string{"-y", "@h0wzy/mcp-server-codex"}, "user"); err != nil {
		t.Fatal(err)
	}
	if err := RegisterClaudeServerCommand("antigravity", "node", []string{"/srv/servers/antigravity/bin/cli.js"}, "project"); err != nil {
		t.Fatal(err)
	}
	if err := RegisterAntigravityServerCommand("claude", "node", []string{`C:\repo\servers\claude\bin\cli.js`}); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		path, key, want string
	}{
		{filepath.Join(home, ".claude.json"), "codex", "[-y @h0wzy/mcp-server-codex --host claude]"},
		{filepath.Join(project, ".mcp.json"), "antigravity", "[/srv/servers/antigravity/bin/cli.js --host claude]"},
		{filepath.Join(home, ".gemini", "config", "mcp_config.json"), "claude", "[" + filepath.ToSlash(`C:\repo\servers\claude\bin\cli.js`) + " --host antigravity]"},
	}
	for _, c := range cases {
		var data map[string]interface{}
		if err := json.Unmarshal([]byte(readFile(t, c.path)), &data); err != nil {
			t.Fatalf("%s: %v", c.path, err)
		}
		entry := data["mcpServers"].(map[string]interface{})[c.key].(map[string]interface{})
		if got := fmt.Sprint(entry["args"]); got != c.want {
			t.Errorf("%s %s args = %s, want %s", c.path, c.key, got, c.want)
		}
	}
}

func TestInstallBridgeWritesEachDirectionIntoItsHost(t *testing.T) {
	home := withHome(t)
	t.Chdir(t.TempDir()) // no ./servers here: the npx launch is used

	for _, b := range Bridges {
		if err := InstallBridge(b.Name, "user"); err != nil {
			t.Fatalf("install %s: %v", b.Name, err)
		}
	}
	codex := readFile(t, filepath.Join(home, ".codex", "config.toml"))
	for _, want := range []string{
		"[mcp_servers.claude]\ncommand = \"npx\"\nargs = [\"-y\", \"@h0wzy/mcp-server-claude\", \"--host\", \"codex\"]",
		"[mcp_servers.antigravity]\ncommand = \"npx\"\nargs = [\"-y\", \"@h0wzy/mcp-server-antigravity\", \"--host\", \"codex\"]",
	} {
		if !strings.Contains(codex, want) {
			t.Errorf("codex config lacks %q:\n%s", want, codex)
		}
	}
	agy := readFile(t, filepath.Join(home, ".gemini", "config", "mcp_config.json"))
	if !strings.Contains(agy, `"@h0wzy/mcp-server-claude"`) || !strings.Contains(agy, `"@h0wzy/mcp-server-codex"`) {
		t.Errorf("antigravity config lacks a bridge:\n%s", agy)
	}

	for _, b := range Bridges {
		if err := RemoveBridge(b.Name, "user"); err != nil {
			t.Fatalf("remove %s: %v", b.Name, err)
		}
	}
	edges, err := InstalledBridges()
	if err != nil || len(edges) != 0 {
		t.Fatalf("after removing every bridge: edges=%v err=%v", edges, err)
	}
	if err := InstallBridge("codex-team", "user"); err == nil {
		t.Fatal("expected an error for an unknown bridge")
	}
}

func TestResolveServerScript(t *testing.T) {
	withHome(t)
	dir := t.TempDir()
	t.Chdir(dir)

	if cmd, args := ResolveServerScript("claude"); cmd != "npx" || fmt.Sprint(args) != "[-y @h0wzy/mcp-server-claude]" {
		t.Fatalf("without a clone: %s %v", cmd, args)
	}

	script := filepath.Join(dir, "servers", "claude", "bin", "cli.js")
	writeFile(t, script, "// stub\n")
	cmd, args := ResolveServerScript("claude")
	if cmd != "node" || len(args) != 1 || !strings.HasSuffix(args[0], "/servers/claude/bin/cli.js") || strings.Contains(args[0], `\`) {
		t.Fatalf("with a clone: %s %v", cmd, args)
	}
}

func TestCodexRegisterReplacesOnlyItsOwnSection(t *testing.T) {
	home := withHome(t)
	cfg := filepath.Join(home, ".codex", "config.toml")
	writeFile(t, cfg, strings.Join([]string{
		`model = "gpt-6-astra"`,
		``,
		`[mcp_servers.antigravity] # managed by hmcp`,
		`command = "old"`,
		`args = ["old.js"]`,
		``,
		`[mcp_servers.antigravity.env]`,
		`AGY_MODEL = "gemini-3.8-flash"`,
		``,
		`[mcp_servers.other]`,
		`command = "keep-me"`,
		``,
	}, "\n"))

	if err := RegisterCodexServerCommand("antigravity", "node", []string{"new.js"}); err != nil {
		t.Fatalf("register: %v", err)
	}

	got := readFile(t, cfg)
	for _, want := range []string{
		`model = "gpt-6-astra"`,
		"[mcp_servers.antigravity]\ncommand = \"node\"\nargs = [\"new.js\", \"--host\", \"codex\"]",
		"[mcp_servers.antigravity.env]\nAGY_MODEL = \"gemini-3.8-flash\"",
		"[mcp_servers.other]\ncommand = \"keep-me\"",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("expected config to contain %q, got:\n%s", want, got)
		}
	}
	if strings.Contains(got, "old.js") || strings.Count(got, "[mcp_servers.antigravity]") != 1 {
		t.Errorf("old section not replaced cleanly:\n%s", got)
	}
}

func TestCodexRegisterKeepsCommentOfNextSection(t *testing.T) {
	home := withHome(t)
	cfg := filepath.Join(home, ".codex", "config.toml")
	writeFile(t, cfg, "[mcp_servers.antigravity]\ncommand = \"old\"\n\n# Docs search server\n[mcp_servers.docs]\ncommand = \"docs\"\n")

	if err := RegisterCodexServerCommand("antigravity", "node", []string{"a.js"}); err != nil {
		t.Fatalf("register: %v", err)
	}
	if got := readFile(t, cfg); !strings.Contains(got, "# Docs search server\n[mcp_servers.docs]") {
		t.Fatalf("comment belonging to the next section was lost:\n%s", got)
	}
}

func TestCodexRegisterIsIdempotent(t *testing.T) {
	home := withHome(t)
	for i := 0; i < 3; i++ {
		if err := RegisterCodexServerCommand("antigravity", "node", []string{"a.js"}); err != nil {
			t.Fatalf("register #%d: %v", i, err)
		}
	}
	got := readFile(t, filepath.Join(home, ".codex", "config.toml"))
	if n := strings.Count(got, "[mcp_servers.antigravity]"); n != 1 {
		t.Fatalf("expected one section after repeated installs, got %d:\n%s", n, got)
	}
}

func TestCodexUnregisterRemovesSectionAndSubtables(t *testing.T) {
	home := withHome(t)
	cfg := filepath.Join(home, ".codex", "config.toml")
	writeFile(t, cfg, strings.Join([]string{
		`[mcp_servers.antigravity]`,
		`command = "node"`,
		``,
		`[mcp_servers.antigravity.env]`,
		`X = "1"`,
		``,
		`[mcp_servers.antigravity-extra]`,
		`command = "keep-me"`,
		``,
	}, "\n"))

	if err := UnregisterCodexServer("antigravity"); err != nil {
		t.Fatalf("unregister: %v", err)
	}

	got := readFile(t, cfg)
	if strings.Contains(got, "[mcp_servers.antigravity]") || strings.Contains(got, "[mcp_servers.antigravity.env]") {
		t.Errorf("section or sub-table left behind:\n%s", got)
	}
	if !strings.Contains(got, "[mcp_servers.antigravity-extra]\ncommand = \"keep-me\"") {
		t.Errorf("unrelated server with a shared prefix was removed:\n%s", got)
	}
}

func TestCodexUnregisterWithoutConfigIsNoop(t *testing.T) {
	home := withHome(t)
	if err := UnregisterCodexServer("antigravity"); err != nil {
		t.Fatalf("unregister: %v", err)
	}
	if _, err := os.Stat(filepath.Join(home, ".codex", "config.toml")); !os.IsNotExist(err) {
		t.Fatalf("unregister must not create a config file")
	}
}

func TestClaudeRegisterPreservesOtherKeysAndNumbers(t *testing.T) {
	home := withHome(t)
	cfg := filepath.Join(home, ".claude.json")
	writeFile(t, cfg, `{"oauthAccount":{"id":"abc"},"firstStartTime":1759780000123456789,"mcpServers":{"other":{"command":"x"}}}`)

	if err := RegisterClaudeServerCommand("codex", "node", []string{"c.js"}, "user"); err != nil {
		t.Fatalf("register: %v", err)
	}

	raw := readFile(t, cfg)
	if !strings.Contains(raw, "1759780000123456789") {
		t.Errorf("large integer was not preserved exactly:\n%s", raw)
	}
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		t.Fatalf("result is not valid JSON: %v", err)
	}
	if _, ok := data["oauthAccount"]; !ok {
		t.Errorf("unrelated key oauthAccount was dropped")
	}
	servers := data["mcpServers"].(map[string]interface{})
	if _, ok := servers["other"]; !ok {
		t.Errorf("existing server was dropped")
	}
	if _, ok := servers["codex"]; !ok {
		t.Errorf("new server was not added")
	}
}

func TestClaudeRegisterRefusesMalformedConfig(t *testing.T) {
	home := withHome(t)
	cfg := filepath.Join(home, ".claude.json")
	const broken = `{"oauthAccount": {"id": "abc"`
	writeFile(t, cfg, broken)

	if err := RegisterClaudeServerCommand("codex", "node", []string{"c.js"}, "user"); err == nil {
		t.Fatal("expected an error for a malformed config")
	}
	if got := readFile(t, cfg); got != broken {
		t.Fatalf("malformed config was modified: %q", got)
	}
}

func TestClaudeRegisterTreatsBlankFileAsEmpty(t *testing.T) {
	home := withHome(t)
	cfg := filepath.Join(home, ".claude.json")
	writeFile(t, cfg, "  \n")

	if err := RegisterClaudeServerCommand("codex", "node", []string{"c.js"}, "user"); err != nil {
		t.Fatalf("register: %v", err)
	}
	if !strings.Contains(readFile(t, cfg), `"codex"`) {
		t.Fatal("server not written into a blank config")
	}
}

func TestClaudeProjectScopeWritesMcpJson(t *testing.T) {
	withHome(t)
	project := t.TempDir()
	t.Chdir(project)

	if err := RegisterClaudeServerCommand("codex", "node", []string{"c.js"}, "project"); err != nil {
		t.Fatalf("register: %v", err)
	}
	if !strings.Contains(readFile(t, filepath.Join(project, ".mcp.json")), `"codex"`) {
		t.Fatal("project scope did not write .mcp.json")
	}
	if err := UnregisterClaudeServer("codex", "project"); err != nil {
		t.Fatalf("unregister: %v", err)
	}
	if strings.Contains(readFile(t, filepath.Join(project, ".mcp.json")), `"codex"`) {
		t.Fatal("unregister left the server in .mcp.json")
	}
}

func TestAntigravityRegisterAndUnregister(t *testing.T) {
	home := withHome(t)
	cfg := filepath.Join(home, ".gemini", "config", "mcp_config.json")

	if err := RegisterAntigravityServerCommand("codex", "node", []string{`C:\srv\codex\cli.js`}); err != nil {
		t.Fatalf("register: %v", err)
	}
	if !strings.Contains(readFile(t, cfg), `"codex"`) {
		t.Fatal("server not written")
	}
	if err := UnregisterAntigravityServer("codex"); err != nil {
		t.Fatalf("unregister: %v", err)
	}
	if strings.Contains(readFile(t, cfg), `"codex"`) {
		t.Fatal("server not removed")
	}
}

func TestAntigravityRegisterRefusesMalformedConfig(t *testing.T) {
	home := withHome(t)
	cfg := filepath.Join(home, ".gemini", "config", "mcp_config.json")
	writeFile(t, cfg, "not json")

	if err := RegisterAntigravityServerCommand("codex", "node", []string{"c.js"}); err == nil {
		t.Fatal("expected an error for a malformed config")
	}
	if got := readFile(t, cfg); got != "not json" {
		t.Fatalf("malformed config was modified: %q", got)
	}
}

func TestWriteFileAtomicLeavesNoTempFiles(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "cfg.json")
	for i := 0; i < 3; i++ {
		if err := writeFileAtomic(target, []byte("{}\n"), 0600); err != nil {
			t.Fatalf("write #%d: %v", i, err)
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("expected only the target file, found %v", names)
	}
}

func TestResolveServerScriptUsesH0wzyMcpRepo(t *testing.T) {
	repo := t.TempDir()
	script := filepath.Join(repo, "servers", "claude", "bin", "cli.js")
	if err := os.MkdirAll(filepath.Dir(script), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(script, []byte("// stub\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("H0WZY_MCP_REPO", repo)
	t.Chdir(t.TempDir())

	command, args := ResolveServerScript("claude")
	if command != "node" || len(args) != 1 || args[0] != filepath.ToSlash(script) {
		t.Fatalf("got %s %v, want node %s", command, args, filepath.ToSlash(script))
	}

	command, args = ResolveServerScript("antigravity")
	if command != "npx" || args[1] != "@h0wzy/mcp-server-antigravity" {
		t.Fatalf("missing server should fall back to npx, got %s %v", command, args)
	}
}
