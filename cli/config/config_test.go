package config

import (
	"encoding/json"
	"os"
	"path/filepath"
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
	want := "[mcp_servers.antigravity]\ncommand = \"node\"\nargs = [\"/srv/agy/cli.js\"]\n"
	if got != want {
		t.Fatalf("config mismatch\n got: %q\nwant: %q", got, want)
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
		"[mcp_servers.antigravity]\ncommand = \"node\"\nargs = [\"new.js\"]",
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
