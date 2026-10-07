package config

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
)

// registerDirection writes one direction straight through the host's register
// function, using either launch form a bridge can have.
func registerDirection(t *testing.T, b Bridge, viaClone bool, cloneDir string) {
	t.Helper()
	command, args := "npx", []string{"-y", "@h0wzy/mcp-server-" + b.Target}
	if viaClone {
		command, args = "node", []string{filepath.Join(cloneDir, "servers", b.Target, "bin", "cli.js")}
	}
	var err error
	switch b.Host {
	case AgentClaude:
		err = RegisterClaudeServerCommand(b.Target, command, args, "user")
	case AgentCodex:
		err = RegisterCodexServerCommand(b.Target, command, args)
	case AgentAntigravity:
		err = RegisterAntigravityServerCommand(b.Target, command, args)
	}
	if err != nil {
		t.Fatalf("register %s: %v", b.Name, err)
	}
}

// rotationKey identifies a cycle independently of where it starts.
func rotationKey(cycle []string) string {
	best := ""
	for i := range cycle {
		rotated := append(append([]string(nil), cycle[i:]...), cycle[:i]...)
		key := strings.Join(rotated, ">")
		if best == "" || key < best {
			best = key
		}
	}
	return best
}

// bruteForceCycles enumerates every ordered pair and triple of distinct agents
// and keeps those whose consecutive edges (and the closing edge) all exist.
func bruteForceCycles(has map[[2]string]bool) map[string]bool {
	agents := []string{AgentClaude, AgentCodex, AgentAntigravity}
	found := map[string]bool{}
	isCycle := func(path []string) bool {
		for i := range path {
			if !has[[2]string{path[i], path[(i+1)%len(path)]}] {
				return false
			}
		}
		return true
	}
	for _, a := range agents {
		for _, b := range agents {
			if b == a {
				continue
			}
			if isCycle([]string{a, b}) {
				found[rotationKey([]string{a, b})] = true
			}
			for _, c := range agents {
				if c == a || c == b {
					continue
				}
				if isCycle([]string{a, b, c}) {
					found[rotationKey([]string{a, b, c})] = true
				}
			}
		}
	}
	return found
}

func TestInstalledBridgesAndCyclesForEverySubset(t *testing.T) {
	if len(Bridges) != 6 {
		t.Fatalf("expected 6 directions, have %d", len(Bridges))
	}
	for mask := 0; mask < 1<<len(Bridges); mask++ {
		t.Run(fmt.Sprintf("subset-%02d", mask), func(t *testing.T) {
			home := withHome(t)
			t.Chdir(t.TempDir())

			// Unrelated servers in every host config (for most subsets) must be ignored.
			if mask%3 != 0 {
				writeFile(t, filepath.Join(home, ".claude.json"), `{"mcpServers":{"github":{"command":"gh-mcp","args":["serve"]}}}`)
				writeFile(t, filepath.Join(home, ".codex", "config.toml"), "[mcp_servers.docs]\ncommand = \"docs\"\nargs = [\"--stdio\"]\n")
				writeFile(t, filepath.Join(home, ".gemini", "config", "mcp_config.json"), `{"mcpServers":{"fs":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem"]}}}`)
			}

			want := map[string]bool{}
			has := map[[2]string]bool{}
			for i, b := range Bridges {
				if mask&(1<<i) == 0 {
					continue
				}
				registerDirection(t, b, (mask+i)%2 == 1, home)
				want[b.Host+">"+b.Target] = true
				has[[2]string{b.Host, b.Target}] = true
			}

			edges, err := InstalledBridges()
			if err != nil {
				t.Fatalf("InstalledBridges: %v", err)
			}
			got := map[string]bool{}
			for _, e := range edges {
				key := e.Host + ">" + e.Target
				if got[key] {
					t.Errorf("edge %s reported twice", key)
				}
				got[key] = true
				if e.Name != e.Target || e.Scope != "user" || !e.GuardReady {
					t.Errorf("unexpected edge details: %+v", e)
				}
			}
			if fmt.Sprint(sortedSet(got)) != fmt.Sprint(sortedSet(want)) {
				t.Fatalf("edges = %v, want %v", sortedSet(got), sortedSet(want))
			}

			cycles := Cycles(edges)
			gotCycles := map[string]bool{}
			for _, c := range cycles {
				key := rotationKey(c)
				if gotCycles[key] {
					t.Errorf("cycle %s reported twice", FormatCycle(c))
				}
				gotCycles[key] = true
				if c[0] != AgentClaude && strings.Contains(key, AgentClaude) {
					t.Errorf("cycle %s does not start at claude", FormatCycle(c))
				}
			}
			wantCycles := bruteForceCycles(has)
			if fmt.Sprint(sortedSet(gotCycles)) != fmt.Sprint(sortedSet(wantCycles)) {
				t.Fatalf("cycles = %v, want %v", sortedSet(gotCycles), sortedSet(wantCycles))
			}
		})
	}
}

func sortedSet(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func TestCyclesOfTheFullMesh(t *testing.T) {
	var edges []BridgeEdge
	for _, b := range Bridges {
		edges = append(edges, BridgeEdge{Host: b.Host, Target: b.Target})
	}
	var got []string
	for _, c := range Cycles(edges) {
		got = append(got, FormatCycle(c))
	}
	want := []string{
		"claude → codex → claude",
		"claude → antigravity → claude",
		"codex → antigravity → codex",
		"claude → codex → antigravity → claude",
		"claude → antigravity → codex → claude",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("cycles:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestCyclesSelfLoopTeamAndDuplicates(t *testing.T) {
	edges := []BridgeEdge{
		{Host: AgentClaude, Target: AgentClaude},
		{Host: AgentClaude, Target: AgentTeam},
		{Host: AgentCodex, Target: AgentClaude, Scope: "user"},
		{Host: AgentClaude, Target: AgentCodex, Scope: "user"},
		{Host: AgentClaude, Target: AgentCodex, Scope: "project"},
	}
	var got []string
	for _, c := range Cycles(edges) {
		got = append(got, FormatCycle(c))
	}
	if want := "claude → claude|claude → codex → claude"; strings.Join(got, "|") != want {
		t.Fatalf("cycles = %q, want %q", strings.Join(got, "|"), want)
	}
	if !HasPath(edges, AgentCodex, AgentTeam) || HasPath(edges, AgentTeam, AgentClaude) {
		t.Fatal("HasPath gave a wrong answer")
	}
	if len(Cycles(nil)) != 0 || FormatCycle(nil) != "" {
		t.Fatal("empty graph must have no cycles")
	}
}

func TestBridgeTarget(t *testing.T) {
	cases := []struct {
		command string
		args    []string
		want    string
	}{
		{"npx", []string{"-y", "@h0wzy/mcp-server-claude"}, AgentClaude},
		{"npx", []string{"-y", "@h0wzy/mcp-server-codex@1.0.6", "--host", "claude"}, AgentCodex},
		{"node", []string{`C:\Users\dev\mcp\servers\antigravity\bin\cli.js`}, AgentAntigravity},
		{"node", []string{"/home/dev/mcp/servers/team/bin/cli.js"}, AgentTeam},
		{"mcp-server", []string{"@h0wzy/mcp-server-teamwork"}, ""},
		{"npx", []string{"-y", "@modelcontextprotocol/server-filesystem"}, ""},
		{"node", []string{"/srv/servers/other/bin/cli.js"}, ""},
	}
	for _, c := range cases {
		if got := BridgeTarget(c.command, c.args); got != c.want {
			t.Errorf("BridgeTarget(%q, %q) = %q, want %q", c.command, c.args, got, c.want)
		}
	}
}

func TestCodexGuardReadyAndParsing(t *testing.T) {
	home := withHome(t)
	t.Chdir(t.TempDir())
	writeFile(t, filepath.Join(home, ".codex", "config.toml"), strings.Join([]string{
		`# legacy entry written by hmcp 1.0.5: no env_vars`,
		`[mcp_servers.antigravity]`,
		`command = "node"`,
		`args = ["/repo/servers/antigravity/bin/cli.js"]`,
		``,
		`[mcp_servers.antigravity.env]`,
		`env_vars = ["H0WZY_MCP_CHAIN"]  # a sub-table key, not the server's`,
		``,
		`[mcp_servers."claude-bridge"] # quoted key`,
		`command = 'npx'`,
		`args = [`,
		`  "-y", # the package`,
		`  '@h0wzy/mcp-server-claude',`,
		`  "--host", "codex",`,
		`]`,
		`env_vars = ["H0WZY_MCP_RUN_ID", "H0WZY_MCP_CHAIN", "H0WZY_MCP_DEPTH"]`,
		``,
		`[mcp_servers.team]`,
		`command = "npx"`,
		`args = ["-y", "@h0wzy/mcp-server-team"]`,
		`env_vars = ["H0WZY_MCP_CHAIN_LOG"]`,
		``,
		`[profiles.fast]`,
		`args = ["@h0wzy/mcp-server-codex"]`,
		``,
	}, "\n"))

	edges, err := InstalledBridges()
	if err != nil {
		t.Fatalf("InstalledBridges: %v", err)
	}
	got := map[string]BridgeEdge{}
	for _, e := range edges {
		got[e.Name] = e
	}
	if len(edges) != 3 {
		t.Fatalf("expected 3 Codex bridges, got %+v", edges)
	}
	if e := got["antigravity"]; e.Target != AgentAntigravity || e.GuardReady {
		t.Errorf("legacy entry: %+v (want target antigravity, not guard-ready)", e)
	}
	if e := got["claude-bridge"]; e.Target != AgentClaude || !e.GuardReady || e.Host != AgentCodex {
		t.Errorf("multi-line entry: %+v (want codex → claude, guard-ready)", e)
	}
	if e := got["team"]; e.Target != AgentTeam || e.GuardReady {
		t.Errorf("H0WZY_MCP_CHAIN_LOG alone must not count as the chain var: %+v", e)
	}
}

func TestInstalledBridgesProjectAndLocalScope(t *testing.T) {
	home := withHome(t)
	project := t.TempDir()
	t.Chdir(project)
	cwd := filepath.ToSlash(project)

	writeFile(t, filepath.Join(home, ".claude.json"), `{
  "mcpServers": {"codex": {"type": "stdio", "command": "npx", "args": ["-y", "@h0wzy/mcp-server-codex", "--host", "claude"]}},
  "projects": {
    "`+cwd+`": {"mcpServers": {"agy": {"command": "npx", "args": ["-y", "@h0wzy/mcp-server-antigravity"]}}},
    "/some/other/project": {"mcpServers": {"claude": {"command": "npx", "args": ["-y", "@h0wzy/mcp-server-claude"]}}}
  }
}`)
	writeFile(t, filepath.Join(project, ".mcp.json"), `{"mcpServers": {"codex": {"command": "node", "args": ["/r/servers/codex/bin/cli.js"]}}}`)

	edges, err := InstalledBridges()
	if err != nil {
		t.Fatalf("InstalledBridges: %v", err)
	}
	var got []string
	for _, e := range edges {
		got = append(got, fmt.Sprintf("%s>%s:%s:%s", e.Host, e.Target, e.Name, e.Scope))
	}
	sort.Strings(got)
	want := []string{"claude>antigravity:agy:local", "claude>codex:codex:project", "claude>codex:codex:user"}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("edges = %v, want %v", got, want)
	}
}

func TestInstalledBridgesLocalScopeThroughSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on Windows")
	}
	home := withHome(t)
	project := t.TempDir()
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(project, link); err != nil {
		t.Fatal(err)
	}
	// The shell sits in the link; Claude Code keyed the project by its resolved path.
	t.Chdir(link)
	real, _ := filepath.EvalSymlinks(project)
	writeFile(t, filepath.Join(home, ".claude.json"), `{"projects": {"`+filepath.ToSlash(real)+`": {"mcpServers": {"agy": {"command": "npx", "args": ["-y", "@h0wzy/mcp-server-antigravity"]}}}}}`)

	edges, err := InstalledBridges()
	if err != nil {
		t.Fatalf("InstalledBridges: %v", err)
	}
	if len(edges) != 1 || edges[0].Scope != "local" || edges[0].Target != AgentAntigravity {
		t.Fatalf("edges = %+v, want the local-scope antigravity bridge", edges)
	}
}

func TestInstalledBridgesReportsMalformedConfigsAndKeepsTheRest(t *testing.T) {
	home := withHome(t)
	t.Chdir(t.TempDir())
	writeFile(t, filepath.Join(home, ".claude.json"), `{"mcpServers": {`)
	writeFile(t, filepath.Join(home, ".codex", "config.toml"), "[mcp_servers.claude]\ncommand = \"npx\"\nargs = [\"-y\", \"@h0wzy/mcp-server-claude\"\n")
	writeFile(t, filepath.Join(home, ".gemini", "config", "mcp_config.json"), `{"mcpServers": {"claude": {"command": "npx", "args": ["-y", "@h0wzy/mcp-server-claude"]}}}`)

	edges, err := InstalledBridges()
	if err == nil {
		t.Fatal("expected an error describing the unreadable configs")
	}
	msg := err.Error()
	if !strings.Contains(msg, ".claude.json is not valid JSON") || !strings.Contains(msg, "config.toml") || strings.Contains(msg, "refusing to modify") {
		t.Errorf("unexpected error text: %s", msg)
	}
	if len(edges) != 1 || edges[0].Host != AgentAntigravity || edges[0].Target != AgentClaude {
		t.Fatalf("edges from the readable config must still be returned, got %+v", edges)
	}
}

func TestInstalledBridgesWithoutAnyConfig(t *testing.T) {
	withHome(t)
	t.Chdir(t.TempDir())
	edges, err := InstalledBridges()
	if err != nil || len(edges) != 0 {
		t.Fatalf("edges=%v err=%v, want none and no error", edges, err)
	}
}
