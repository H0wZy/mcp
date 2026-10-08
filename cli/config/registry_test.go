package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestRegistryPathDefaultAndOverride(t *testing.T) {
	home := withHome(t)
	t.Setenv("H0WZY_MCP_REGISTRY", "")
	if p, _ := RegistryPath(); p != filepath.Join(home, ".h0wzy-mcp", "registry.json") {
		t.Errorf("default path = %s", p)
	}
	custom := filepath.Join(t.TempDir(), "reg.json")
	t.Setenv("H0WZY_MCP_REGISTRY", custom)
	if p, _ := RegistryPath(); p != custom {
		t.Errorf("override path = %s", p)
	}
}

func TestLoadAndSaveRegistry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "registry.json")
	reg, err := LoadRegistry(path)
	if err != nil || reg.Version != 1 || len(reg.Servers) != 0 {
		t.Fatalf("missing file: %+v, %v", reg, err)
	}
	reg.Servers["my-server"] = &RegistryEntry{URL: "http://127.0.0.1:1/my-server/mcp", Applied: []Destination{{Client: AgentClaude}}}
	if err := SaveRegistry(path, reg); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if info, _ := os.Stat(path); info.Mode().Perm() != 0600 {
			t.Errorf("mode = %v, want 0600", info.Mode().Perm())
		}
	}
	back, err := LoadRegistry(path)
	if err != nil || back.Servers["my-server"].URL != "http://127.0.0.1:1/my-server/mcp" || len(back.Servers["my-server"].Applied) != 1 {
		t.Fatalf("round trip: %+v, %v", back, err)
	}

	for content, want := range map[string]string{
		"{not json":                        "refusing to modify",
		`{"version":1,"servers":{},"x":1}`: "refusing to modify",
		`{"version":2,"servers":{}}`:       "newer hmcp",
	} {
		writeFile(t, path, content)
		if _, err := LoadRegistry(path); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: err = %v, want %q", content, err, want)
		}
	}
}

func TestValidateName(t *testing.T) {
	if err := ValidateName("my-server"); err != nil {
		t.Errorf("my-server: %v", err)
	}
	for _, bad := range []string{"codex", "antigravity", "claude", "team", "-x", "a.b", "", strings.Repeat("a", 65)} {
		if ValidateName(bad) == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestValidateEntry(t *testing.T) {
	good := []*RegistryEntry{
		{URL: "http://127.0.0.1:1/my-server/mcp", Clients: []string{AgentClaude}},
		{Command: "node", Args: []string{"server.js"}, Env: []string{"MY_SERVER_TOKEN"}},
	}
	for _, e := range good {
		if err := ValidateEntry(e); err != nil {
			t.Errorf("%+v: %v", e, err)
		}
	}
	bad := map[string]*RegistryEntry{
		"both":        {URL: "http://h/x/mcp", Command: "node"},
		"neither":     {},
		"scheme":      {URL: "ftp://h/x/mcp"},
		"credentials": {URL: "http://u:p@h/x/mcp"},
		"env value":   {Command: "node", Env: []string{"A=b"}},
		"env name":    {Command: "node", Env: []string{"1A"}},
		"env on url":  {URL: "http://h/x/mcp", Env: []string{"A"}},
		"client":      {URL: "http://h/x/mcp", Clients: []string{"cursor"}},
	}
	for label, e := range bad {
		if ValidateEntry(e) == nil {
			t.Errorf("%s accepted", label)
		}
	}
	if err := ValidateEntry(&RegistryEntry{Command: "node", Env: []string{"TOKEN=secret"}}); strings.Contains(err.Error(), "secret") {
		t.Errorf("error echoes the value: %v", err)
	}
}

func TestRegistryWarnings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "registry.json")
	reg := &Registry{Servers: map[string]*RegistryEntry{"my-server": {URL: "http://127.0.0.1:1/my-server/mcp"}}}
	if w := RegistryWarnings(reg, path); len(w) != 0 {
		t.Errorf("unexpected warnings: %v", w)
	}
	reg.Servers["my-other"] = &RegistryEntry{URL: "http://127.0.0.1:1/my-server/mcp/"}
	reg.Servers["my-third"] = &RegistryEntry{URL: "http://127.0.0.1:1/other?k=v"}
	w := strings.Join(RegistryWarnings(reg, path), "\n")
	for _, want := range []string{"same host and path", "/<tool>/mcp", "query string"} {
		if !strings.Contains(w, want) {
			t.Errorf("warnings lack %q:\n%s", want, w)
		}
	}

	repo := t.TempDir()
	writeFile(t, filepath.Join(repo, ".git", "HEAD"), "ref: refs/heads/main\n")
	if w := RegistryWarnings(&Registry{}, filepath.Join(repo, "a", "registry.json")); len(w) != 1 || !strings.Contains(w[0], "git work tree") {
		t.Errorf("git warning: %v", w)
	}
}
