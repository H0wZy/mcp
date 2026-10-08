package cmd

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/H0wZy/mcp/cli/config"
)

const regURL1 = "http://127.0.0.1:1/my-server/mcp"

// registryEnv isolates HOME and the registry file.
func registryEnv(t *testing.T) (home, registry string) {
	t.Helper()
	home = withHome(t)
	registry = filepath.Join(t.TempDir(), "registry.json")
	t.Setenv("H0WZY_MCP_REGISTRY", registry)
	return home, registry
}

func mustRead(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func loadReg(t *testing.T) *config.Registry {
	t.Helper()
	path, _ := config.RegistryPath()
	reg, err := config.LoadRegistry(path)
	if err != nil {
		t.Fatal(err)
	}
	return reg
}

func TestRegistryAddWritesEveryClient(t *testing.T) {
	home, registry := registryEnv(t)
	var out bytes.Buffer
	if err := runRegistryAdd(&out, "my-server", &config.RegistryEntry{URL: regURL1}, allAgents, false, false); err != nil {
		t.Fatalf("add: %v\n%s", err, out.String())
	}
	for _, path := range []string{
		filepath.Join(home, ".claude.json"),
		filepath.Join(home, ".codex", "config.toml"),
		filepath.Join(home, ".gemini", "config", "mcp_config.json"),
		registry,
	} {
		if !strings.Contains(mustRead(t, path), regURL1) {
			t.Errorf("%s lacks the server", path)
		}
	}
	if !strings.Contains(out.String(), "Antigravity can call my-server's tools without asking") {
		t.Errorf("no Antigravity notice:\n%s", out.String())
	}

	cmd := &config.RegistryEntry{Command: "node", Args: []string{"server.js", "--stdio"}, Env: []string{"MY_SERVER_TOKEN"}, Clients: []string{"claude", "codex"}, Note: "local"}
	out.Reset()
	if err := runRegistryAdd(&out, "my-local-server", cmd, allAgents, false, false); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "Antigravity can call") {
		t.Errorf("notice printed for a server not applied to Antigravity:\n%s", out.String())
	}
	if !strings.Contains(mustRead(t, filepath.Join(home, ".codex", "config.toml")), `env_vars = ["MY_SERVER_TOKEN"]`) {
		t.Error("codex env_vars missing")
	}

	out.Reset()
	if err := runRegistryList(&out); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"my-local-server", "node server.js --stdio", "claude, codex", "MY_SERVER_TOKEN", "note: local", "my-server", regURL1} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("list lacks %q:\n%s", want, out.String())
		}
	}
}

func TestRegistryAddRefusals(t *testing.T) {
	home, _ := registryEnv(t)
	var out bytes.Buffer
	url := &config.RegistryEntry{URL: regURL1}
	if err := runRegistryAdd(&out, "my-server", url, allAgents, false, false); err != nil {
		t.Fatal(err)
	}
	bad := map[string]struct {
		name string
		e    *config.RegistryEntry
	}{
		"reserved":  {"codex", &config.RegistryEntry{URL: regURL1}},
		"duplicate": {"my-server", &config.RegistryEntry{URL: regURL1}},
		"env value": {"my-other", &config.RegistryEntry{Command: "node", Env: []string{"A=b"}}},
		"both":      {"my-other", &config.RegistryEntry{URL: regURL1, Command: "node"}},
		"neither":   {"my-other", &config.RegistryEntry{}},
	}
	for label, c := range bad {
		if err := runRegistryAdd(&out, c.name, c.e, allAgents, false, false); err == nil {
			t.Errorf("%s accepted", label)
		}
	}

	// --no-apply writes the registry only.
	if err := runRegistryAdd(&out, "my-other", &config.RegistryEntry{URL: "http://127.0.0.1:1/my-other/mcp"}, allAgents, true, false); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(mustRead(t, filepath.Join(home, ".claude.json")), "my-other") || loadReg(t).Servers["my-other"] == nil {
		t.Error("--no-apply")
	}

	// A conflict exits non-zero but keeps the registration.
	writeTestFile(t, filepath.Join(home, ".gemini", "config", "mcp_config.json"), `{"mcpServers": {"my-third": {"serverUrl": "http://elsewhere/my-third/mcp"}}}`)
	out.Reset()
	err := runRegistryAdd(&out, "my-third", &config.RegistryEntry{URL: "http://127.0.0.1:1/my-third/mcp"}, allAgents, false, false)
	if err == nil || !strings.Contains(out.String(), "conflict") || loadReg(t).Servers["my-third"] == nil {
		t.Errorf("conflict: err=%v\n%s", err, out.String())
	}
}

func TestRegistryUpdateApplyAndRemove(t *testing.T) {
	home, _ := registryEnv(t)
	codex := filepath.Join(home, ".codex", "config.toml")
	var out bytes.Buffer
	if err := runRegistryAdd(&out, "my-server", &config.RegistryEntry{URL: regURL1}, allAgents, false, false); err != nil {
		t.Fatal(err)
	}
	moved := "http://127.0.0.1:2/my-server/mcp"
	setURL := func(e *config.RegistryEntry) error { e.URL = moved; return nil }
	if err := runRegistryUpdate(&out, "my-server", setURL, allAgents, false, false); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(mustRead(t, codex), moved) || !strings.Contains(mustRead(t, filepath.Join(home, ".claude.json")), moved) {
		t.Error("update did not reach every client")
	}

	back := func(e *config.RegistryEntry) error { e.URL = regURL1; return nil }
	if err := runRegistryUpdate(&out, "my-server", back, allAgents, true, false); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(mustRead(t, codex), moved) {
		t.Error("--no-apply touched the clients")
	}
	if err := runRegistryApply(&out, nil, allAgents, false, false); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(mustRead(t, codex), regURL1) {
		t.Error("apply did not sync")
	}
	if err := runRegistryUpdate(&out, "nope", back, allAgents, false, false); err == nil {
		t.Error("update of an unknown name")
	}

	// Remove fails on an unreadable file and keeps the entry; then succeeds.
	claude := filepath.Join(home, ".claude.json")
	good := mustRead(t, claude)
	writeTestFile(t, claude, "{oops")
	if err := runRegistryRemove(&out, "my-server", false); err == nil || loadReg(t).Servers["my-server"] == nil {
		t.Errorf("remove with unreadable file: %v", err)
	}
	writeTestFile(t, claude, good)
	if err := runRegistryRemove(&out, "my-server", false); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(mustRead(t, codex), "my-server") || strings.Contains(mustRead(t, claude), "my-server") || loadReg(t).Servers["my-server"] != nil {
		t.Error("remove left something behind")
	}

	if err := runRegistryAdd(&out, "my-server", &config.RegistryEntry{URL: regURL1}, allAgents, false, false); err != nil {
		t.Fatal(err)
	}
	if err := runRegistryRemove(&out, "my-server", true); err != nil || !strings.Contains(mustRead(t, codex), "my-server") {
		t.Errorf("remove --no-apply: %v", err)
	}
}

func TestRegistryStatus(t *testing.T) {
	home, _ := registryEnv(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusMethodNotAllowed)
	}))
	defer srv.Close()
	var out bytes.Buffer
	live := srv.URL + "/my-server/mcp"
	if err := runRegistryAdd(&out, "my-server", &config.RegistryEntry{URL: live}, allAgents, false, false); err != nil {
		t.Fatal(err)
	}
	if err := runRegistryAdd(&out, "my-other", &config.RegistryEntry{URL: "http://127.0.0.1:1/my-other/mcp", Clients: []string{"claude"}}, allAgents, false, false); err != nil {
		t.Fatal(err)
	}

	out.Reset()
	if err := runRegistryStatus(&out, allAgents); err != nil {
		t.Fatalf("status in sync: %v\n%s", err, out.String())
	}
	if !strings.Contains(out.String(), live+"  answers") || !strings.Contains(out.String(), "unreachable") {
		t.Errorf("reachability:\n%s", out.String())
	}

	codex := filepath.Join(home, ".codex", "config.toml")
	edited := strings.Replace(mustRead(t, codex), live, "http://127.0.0.1:3/my-server/mcp", 1)
	writeTestFile(t, codex, edited)
	out.Reset()
	if err := runRegistryStatus(&out, allAgents); err == nil || !strings.Contains(out.String(), "differs (url)") {
		t.Errorf("drift: %v\n%s", err, out.String())
	}
	if mustRead(t, codex) != edited {
		t.Error("status modified the codex config")
	}
}

func TestRegistryApplyCodexProject(t *testing.T) {
	home, _ := registryEnv(t)
	var out bytes.Buffer
	if err := runRegistryAdd(&out, "my-server", &config.RegistryEntry{URL: regURL1, Clients: []string{"claude"}}, allAgents, false, false); err != nil {
		t.Fatal(err)
	}
	project := t.TempDir()
	t.Chdir(project)
	if err := runRegistryApply(&out, []string{"my-server"}, allAgents, false, true); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(mustRead(t, filepath.Join(project, ".codex", "config.toml")), regURL1) {
		t.Error("project config not written")
	}
	if _, err := os.Stat(filepath.Join(home, ".codex", "config.toml")); !os.IsNotExist(err) {
		t.Error("global codex config touched")
	}
	applied := loadReg(t).Servers["my-server"].Applied
	if len(applied) != 2 || !filepath.IsAbs(applied[1].Project) {
		t.Errorf("applied = %+v", applied)
	}
}
