package config

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var everyClient = map[string]bool{AgentClaude: true, AgentCodex: true, AgentAntigravity: true}

type clientPaths struct{ claude, codex, agy string }

func registryHome(t *testing.T) clientPaths {
	home := withHome(t)
	return clientPaths{
		claude: filepath.Join(home, ".claude.json"),
		codex:  filepath.Join(home, ".codex", "config.toml"),
		agy:    filepath.Join(home, ".gemini", "config", "mcp_config.json"),
	}
}

func jsonEntry(t *testing.T, path, name string) map[string]interface{} {
	t.Helper()
	var data map[string]map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(readFile(t, path)), &data); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	return data["mcpServers"][name]
}

func oneServer(e *RegistryEntry) *Registry {
	return &Registry{Version: 1, Servers: map[string]*RegistryEntry{"my-server": e}}
}

const testURL = "http://127.0.0.1:1/my-server/mcp"

func TestWriteDestinationShapes(t *testing.T) {
	p := registryHome(t)
	url := &RegistryEntry{URL: testURL}
	cmd := &RegistryEntry{Command: "node", Args: []string{"server.js", "--stdio"}, Env: []string{"MY_SERVER_TOKEN"}}

	for _, c := range RegistryClients {
		if err := writeDestination(Destination{Client: c}, "my-server", url); err != nil {
			t.Fatal(err)
		}
	}
	if e := jsonEntry(t, p.claude, "my-server"); e["type"] != "http" || e["url"] != testURL || e["command"] != nil {
		t.Errorf("claude url entry: %v", e)
	}
	if e := jsonEntry(t, p.agy, "my-server"); e["serverUrl"] != testURL || len(e) != 1 {
		t.Errorf("antigravity url entry: %v", e)
	}
	if got := readFile(t, p.codex); got != "[mcp_servers.my-server]\nurl = \""+testURL+"\"\n" {
		t.Errorf("codex url entry:\n%s", got)
	}

	for _, c := range RegistryClients {
		if err := writeDestination(Destination{Client: c}, "my-server", cmd); err != nil {
			t.Fatal(err)
		}
	}
	if e := jsonEntry(t, p.claude, "my-server"); e["type"] != "stdio" || e["command"] != "node" || e["url"] != nil {
		t.Errorf("claude command entry: %v", e)
	}
	if e := jsonEntry(t, p.agy, "my-server"); e["command"] != "node" || e["serverUrl"] != nil || len(e["args"].([]interface{})) != 2 {
		t.Errorf("antigravity command entry: %v", e)
	}
	want := "[mcp_servers.my-server]\ncommand = \"node\"\nargs = [\"server.js\", \"--stdio\"]\nenv_vars = [\"MY_SERVER_TOKEN\"]\n"
	if got := readFile(t, p.codex); got != want {
		t.Errorf("codex command entry:\n%s", got)
	}
	for _, path := range []string{p.claude, p.codex, p.agy} {
		if strings.Contains(readFile(t, path), "--host") {
			t.Errorf("%s has a --host argument", path)
		}
	}
}

func TestWriteDestinationKeepsUserContent(t *testing.T) {
	p := registryHome(t)
	writeFile(t, p.claude, `{"numStartups": 12345678901234567890, "mcpServers": {"my-server": {"type": "http", "url": "http://old/my-server/mcp", "headers": {"X": "y"}}, "my-other": {"command": "x"}}}`)
	writeFile(t, p.codex, strings.Join([]string{
		"model = \"m\"",
		"",
		"[mcp_servers.my-server]",
		"# my comment",
		"command = \"old\"",
		"args = [",
		"  \"a\",",
		"  \"b\",",
		"]",
		"enabled = false",
		"",
		"[mcp_servers.my-server.env]",
		"K = \"v\"",
		"",
		"[mcp_servers.my-other]",
		"command = \"x\"",
		"",
	}, "\n"))

	e := &RegistryEntry{URL: testURL}
	for _, c := range []string{AgentClaude, AgentCodex} {
		if err := writeDestination(Destination{Client: c}, "my-server", e); err != nil {
			t.Fatal(err)
		}
	}
	claude := readFile(t, p.claude)
	for _, want := range []string{"12345678901234567890", `"headers"`, `"my-other"`, testURL} {
		if !strings.Contains(claude, want) {
			t.Errorf("claude config lost %q:\n%s", want, claude)
		}
	}
	codex := readFile(t, p.codex)
	for _, want := range []string{"model = \"m\"", "# my comment", "enabled = false", "[mcp_servers.my-server.env]", "K = \"v\"", "[mcp_servers.my-other]", "url = \"" + testURL + "\""} {
		if !strings.Contains(codex, want) {
			t.Errorf("codex config lost %q:\n%s", want, codex)
		}
	}
	for _, gone := range []string{"command = \"old\"", "\"a\",", "args"} {
		if strings.Contains(strings.Split(codex, "[mcp_servers.my-server.env]")[0], gone) {
			t.Errorf("codex section kept %q:\n%s", gone, codex)
		}
	}
}

func TestRefusedConfigsAreNotTouched(t *testing.T) {
	p := registryHome(t)
	e := &RegistryEntry{URL: testURL}
	cases := map[string]struct {
		dest    Destination
		path    string
		content string
	}{
		"invalid json":   {Destination{Client: AgentAntigravity}, p.agy, "{oops"},
		"bad toml array": {Destination{Client: AgentCodex}, p.codex, "[mcp_servers.x]\nargs = [1, 2]\n"},
		"inline table":   {Destination{Client: AgentCodex}, p.codex, "[mcp_servers]\nmy-server = { url = \"http://h/my-server/mcp\" }\n"},
		"dotted key":     {Destination{Client: AgentCodex}, p.codex, "mcp_servers.my-server.url = \"http://h/my-server/mcp\"\n"},
		"quoted header":  {Destination{Client: AgentCodex}, p.codex, "[mcp_servers.\"my-server\"]\nurl = \"http://h/my-server/mcp\"\n"},
	}
	for label, c := range cases {
		writeFile(t, c.path, c.content)
		if _, _, err := readDestination(c.dest, "my-server"); err == nil {
			t.Errorf("%s: read accepted", label)
		}
		if err := writeDestination(c.dest, "my-server", e); err == nil {
			t.Errorf("%s: write accepted", label)
		}
		if err := removeDestination(c.dest, "my-server"); err == nil {
			t.Errorf("%s: remove accepted", label)
		}
		if got := readFile(t, c.path); got != c.content {
			t.Errorf("%s: file changed:\n%s", label, got)
		}
	}
}

func TestSameTarget(t *testing.T) {
	if !sameTarget(ownedFields{URL: "http://h/x/mcp"}, ownedFields{URL: "http://h/x/mcp/"}) {
		t.Error("trailing slash")
	}
	if !sameTarget(ownedFields{Command: "node", Args: []string{`a\b.js`}, EnvVars: []string{"A"}}, ownedFields{Command: "node", Args: []string{"a/b.js"}}) {
		t.Error("slashes or env_vars")
	}
	if sameTarget(ownedFields{Command: "node"}, ownedFields{URL: "http://h/x/mcp"}) {
		t.Error("command vs url")
	}
}

func TestApplyEntryWritesAdoptsAndReportsConflicts(t *testing.T) {
	p := registryHome(t)
	writeFile(t, p.claude, `{"mcpServers": {"my-server": {"type": "http", "url": "`+testURL+`/", "headers": {"X": "y"}}}}`)
	writeFile(t, p.agy, `{"mcpServers": {"my-server": {"serverUrl": "http://elsewhere/my-server/mcp"}}}`)
	reg := oneServer(&RegistryEntry{URL: testURL})

	results := ApplyEntry(reg, "my-server", ApplyOptions{Installed: everyClient})
	got := map[string]DestinationResult{}
	for _, r := range results {
		got[r.Dest.Client] = r
	}
	if r := got[AgentClaude]; r.Action != "adopted" || r.State != StateInSync {
		t.Errorf("claude: %+v", r)
	}
	if r := got[AgentCodex]; r.Action != "written" {
		t.Errorf("codex: %+v", r)
	}
	if r := got[AgentAntigravity]; r.State != StateConflict || !r.Failed() {
		t.Errorf("antigravity: %+v", r)
	}
	// SC-003: adopting keeps the entry's own URL (trailing slash included).
	if e := jsonEntry(t, p.claude, "my-server"); e["headers"] == nil || e["url"] != testURL+"/" {
		t.Errorf("adopted entry: %v", e)
	}
	if e := jsonEntry(t, p.agy, "my-server"); e["serverUrl"] != "http://elsewhere/my-server/mcp" {
		t.Errorf("conflict overwritten: %v", e)
	}
	if applied := reg.Servers["my-server"].Applied; len(applied) != 2 {
		t.Errorf("applied = %v", applied)
	}

	results = ApplyEntry(reg, "my-server", ApplyOptions{Installed: everyClient, Replace: true})
	for _, r := range results {
		if r.State != StateInSync {
			t.Errorf("after replace: %+v", r)
		}
	}
	if e := jsonEntry(t, p.agy, "my-server"); e["serverUrl"] != testURL {
		t.Errorf("replace: %v", e)
	}

	before := readFile(t, p.codex)
	stat, _ := os.Stat(p.codex)
	for _, r := range ApplyEntry(reg, "my-server", ApplyOptions{Installed: everyClient}) {
		if r.Action != "" || r.State != StateInSync {
			t.Errorf("second apply: %+v", r)
		}
	}
	if after, _ := os.Stat(p.codex); readFile(t, p.codex) != before || !after.ModTime().Equal(stat.ModTime()) {
		t.Error("second apply rewrote the codex config")
	}
}

func TestApplyEntryClientsNotInstalledAndUnreadable(t *testing.T) {
	p := registryHome(t)
	writeFile(t, p.agy, "{oops")
	reg := oneServer(&RegistryEntry{URL: testURL})
	results := ApplyEntry(reg, "my-server", ApplyOptions{Installed: map[string]bool{AgentClaude: true, AgentAntigravity: true}})
	states := map[string]DestinationState{}
	for _, r := range results {
		states[r.Dest.Client] = r.State
	}
	if states[AgentCodex] != StateNotInstalled || states[AgentAntigravity] != StateUnreadable || states[AgentClaude] != StateInSync {
		t.Errorf("states = %v", states)
	}
	if _, err := os.Stat(p.codex); !os.IsNotExist(err) {
		t.Error("codex is not installed and must not be written")
	}

	reg = oneServer(&RegistryEntry{URL: testURL, Clients: []string{AgentClaude}})
	if results := ApplyEntry(reg, "my-server", ApplyOptions{Installed: everyClient}); len(results) != 1 {
		t.Errorf("--clients claude: %+v", results)
	}
}

func TestUpdateNarrowAndRemove(t *testing.T) {
	p := registryHome(t)
	reg := oneServer(&RegistryEntry{Command: "node", Args: []string{"old.js"}})
	ApplyEntry(reg, "my-server", ApplyOptions{Installed: everyClient})

	reg.Servers["my-server"].Args = []string{"new.js"}
	for _, r := range ApplyEntry(reg, "my-server", ApplyOptions{Installed: everyClient}) {
		if r.Action != "written" {
			t.Errorf("update: %+v", r)
		}
	}
	if !strings.Contains(readFile(t, p.codex), "new.js") || strings.Contains(readFile(t, p.codex), "old.js") {
		t.Errorf("codex after update:\n%s", readFile(t, p.codex))
	}

	reg.Servers["my-server"].Clients = []string{AgentClaude}
	ApplyEntry(reg, "my-server", ApplyOptions{Installed: everyClient})
	if strings.Contains(readFile(t, p.codex), "my-server") || jsonEntry(t, p.agy, "my-server") != nil {
		t.Error("narrowing --clients left entries behind")
	}
	if applied := reg.Servers["my-server"].Applied; len(applied) != 1 || applied[0].Client != AgentClaude {
		t.Errorf("applied = %v", applied)
	}

	// A hand-made entry in a client hmcp never applied to stays.
	writeFile(t, p.agy, `{"mcpServers": {"my-server": {"command": "mine"}}}`)
	writeFile(t, p.claude, "{oops")
	if results := RemoveEntry(reg, "my-server"); len(results) != 1 || !results[0].Failed() || reg.Servers["my-server"] == nil {
		t.Errorf("remove with unreadable file: %+v", results)
	}
	writeFile(t, p.claude, `{"mcpServers": {"my-server": {"type": "stdio", "command": "node", "args": ["new.js"]}}}`)
	if results := RemoveEntry(reg, "my-server"); len(results) != 1 || results[0].Action != "removed" || reg.Servers["my-server"] != nil {
		t.Errorf("remove: %+v", results)
	}
	if jsonEntry(t, p.claude, "my-server") != nil || jsonEntry(t, p.agy, "my-server")["command"] != "mine" {
		t.Error("remove touched the wrong entries")
	}
}

func TestEntryStatusIsReadOnly(t *testing.T) {
	p := registryHome(t)
	reg := oneServer(&RegistryEntry{URL: testURL})
	ApplyEntry(reg, "my-server", ApplyOptions{Installed: everyClient})
	writeFile(t, p.codex, "[mcp_servers.my-server]\nurl = \"http://moved/my-server/mcp\"\n")
	writeFile(t, p.agy, `{"mcpServers": {}}`)
	snapshot := map[string]string{p.claude: readFile(t, p.claude), p.codex: readFile(t, p.codex), p.agy: readFile(t, p.agy)}

	got := map[string]DestinationResult{}
	for _, r := range EntryStatus(reg, "my-server", everyClient) {
		got[r.Dest.Client] = r
	}
	if got[AgentClaude].State != StateInSync || got[AgentCodex].State != StateDiffers || got[AgentCodex].Detail != "url" || got[AgentAntigravity].State != StateMissing {
		t.Errorf("status = %+v", got)
	}
	for path, content := range snapshot {
		if readFile(t, path) != content {
			t.Errorf("status modified %s", path)
		}
	}
	if r := EntryStatus(reg, "my-server", map[string]bool{AgentClaude: true}); r[1].State != StateNotInstalled {
		t.Errorf("not installed: %+v", r)
	}
}

func TestCodexProjectScope(t *testing.T) {
	p := registryHome(t)
	project := t.TempDir()
	reg := oneServer(&RegistryEntry{URL: testURL, Clients: []string{AgentClaude}})
	ApplyEntry(reg, "my-server", ApplyOptions{Installed: everyClient, Projects: []string{project}})
	projectConfig := filepath.Join(project, ".codex", "config.toml")
	if !strings.Contains(readFile(t, projectConfig), testURL) {
		t.Error("project config not written")
	}
	if _, err := os.Stat(p.codex); !os.IsNotExist(err) {
		t.Error("global codex config touched")
	}

	reg.Servers["my-server"].URL = "http://127.0.0.1:2/my-server/mcp"
	ApplyEntry(reg, "my-server", ApplyOptions{Installed: everyClient})
	if !strings.Contains(readFile(t, projectConfig), ":2/") {
		t.Error("recorded project not re-synced")
	}

	gone := filepath.Join(t.TempDir(), "gone")
	reg.Servers["my-server"].Applied = append(reg.Servers["my-server"].Applied, Destination{Client: AgentCodex, Project: gone})
	var dropped bool
	for _, r := range ApplyEntry(reg, "my-server", ApplyOptions{Installed: everyClient}) {
		dropped = dropped || (r.Dest.Project == gone && r.Action == "dropped")
	}
	if !dropped || len(reg.Servers["my-server"].Applied) != 2 {
		t.Errorf("gone project: applied = %v", reg.Servers["my-server"].Applied)
	}

	RemoveEntry(reg, "my-server")
	if strings.Contains(readFile(t, projectConfig), "my-server") {
		t.Error("remove left the project entry")
	}
}

func TestProbeURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusMethodNotAllowed)
	}))
	defer srv.Close()
	if !ProbeURL(srv.URL+"/my-server/mcp", time.Second) {
		t.Error("405 should count as answering")
	}
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	closed := "http://" + l.Addr().String() + "/my-server/mcp"
	l.Close()
	start := time.Now()
	if ProbeURL(closed, time.Second) || time.Since(start) > 2*time.Second {
		t.Error("closed port should be unreachable within the timeout")
	}
}
