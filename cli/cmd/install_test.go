package cmd

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/H0wZy/mcp/cli/config"
)

// withHome points os.UserHomeDir at a fresh temp dir and runs from an empty
// directory, so ResolveServerScript uses the npx launch.
func withHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Chdir(t.TempDir())
	return home
}

var allAgents = map[string]bool{config.AgentClaude: true, config.AgentCodex: true, config.AgentAntigravity: true}

// installedNames lists the installed bridge directions, without team servers.
func installedNames(t *testing.T) []string {
	t.Helper()
	var names []string
	for _, e := range installedEdges(t) {
		if e.Target != config.AgentTeam {
			names = append(names, e.Host+"-"+e.Target)
		}
	}
	sort.Strings(names)
	return names
}

// teamServerHosts lists the hosts that have the team server registered.
func teamServerHosts(t *testing.T) []string {
	t.Helper()
	var hosts []string
	for _, e := range installedEdges(t) {
		if e.Target == config.AgentTeam {
			hosts = append(hosts, e.Host)
		}
	}
	sort.Strings(hosts)
	return hosts
}

func installedEdges(t *testing.T) []config.BridgeEdge {
	t.Helper()
	edges, err := config.InstalledBridges()
	if err != nil {
		t.Fatalf("InstalledBridges: %v", err)
	}
	return edges
}

func TestPlanInstallSkipsCycleClosingDirections(t *testing.T) {
	install, skipped := planInstall(supportedBridges(allAgents), nil, false)
	if got, want := strings.Join(install, ","), "claude-antigravity,claude-codex,codex-antigravity"; got != want {
		t.Errorf("install = %s, want %s", got, want)
	}
	if got, want := strings.Join(skipped, ","), "codex-claude,antigravity-codex,antigravity-claude"; got != want {
		t.Errorf("skipped = %s, want %s", got, want)
	}

	// The planned set must itself be acyclic.
	var edges []config.BridgeEdge
	for _, name := range install {
		b, _ := config.LookupBridge(name)
		edges = append(edges, config.BridgeEdge{Host: b.Host, Target: b.Target})
	}
	if c := config.Cycles(edges); len(c) != 0 {
		t.Errorf("planned bridges form cycles: %v", c)
	}
}

func TestPlanInstallAllowCyclesInstallsEverything(t *testing.T) {
	install, skipped := planInstall(supportedBridges(allAgents), nil, true)
	if got, want := strings.Join(install, ","), strings.Join(config.BridgeNames(), ","); got != want || len(skipped) != 0 {
		t.Fatalf("install = %s skipped = %v, want all and none", got, skipped)
	}
}

func TestPlanInstallAccountsForInstalledBridges(t *testing.T) {
	// A 1.0.5 install left antigravity → codex behind.
	installed := []config.BridgeEdge{{Host: config.AgentAntigravity, Target: config.AgentCodex, Name: "codex"}}
	install, skipped := planInstall(supportedBridges(allAgents), installed, false)
	if got, want := strings.Join(install, ","), "claude-antigravity,claude-codex,antigravity-codex"; got != want {
		t.Errorf("install = %s, want %s (the installed direction is refreshed)", got, want)
	}
	if got, want := strings.Join(skipped, ","), "codex-antigravity,codex-claude,antigravity-claude"; got != want {
		t.Errorf("skipped = %s, want %s", got, want)
	}

	// Only two agents: the pair is one cycle, so the second direction waits.
	install, skipped = planInstall(supportedBridges(map[string]bool{config.AgentCodex: true, config.AgentClaude: true}), nil, false)
	if strings.Join(install, ",") != "claude-codex" || strings.Join(skipped, ",") != "codex-claude" {
		t.Errorf("two agents: install = %v skipped = %v", install, skipped)
	}
}

func TestInstallAllNonInteractiveRefusesCycles(t *testing.T) {
	withHome(t)
	var out bytes.Buffer
	if err := runInstallAll(&out, strings.NewReader(""), allAgents, "user", false, false); err != nil {
		t.Fatalf("install --all: %v", err)
	}
	if got, want := strings.Join(installedNames(t), ","), "claude-antigravity,claude-codex,codex-antigravity"; got != want {
		t.Fatalf("installed = %s, want %s\n%s", got, want, out.String())
	}
	text := out.String()
	for _, want := range []string{
		"claude → codex → claude",
		"claude → codex → antigravity → claude",
		"depth 2 · calls 8 · revisits off · deadline 60 min",
		"Skipped because they would close a cycle",
		"codex-claude", "antigravity-codex", "antigravity-claude",
		"--allow-cycles",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("output lacks %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "[y/N]") {
		t.Errorf("non-interactive install must not prompt:\n%s", text)
	}
}

func TestInstallAllWithAllowCyclesInstallsAllSix(t *testing.T) {
	home := withHome(t)
	var out bytes.Buffer
	if err := runInstallAll(&out, strings.NewReader(""), allAgents, "user", true, false); err != nil {
		t.Fatalf("install --all --allow-cycles: %v", err)
	}
	want := append([]string(nil), config.BridgeNames()...)
	sort.Strings(want)
	if got := strings.Join(installedNames(t), ","); got != strings.Join(want, ",") {
		t.Fatalf("installed = %s, want all six\n%s", got, out.String())
	}
	if strings.Contains(out.String(), "Skipped") {
		t.Errorf("nothing should be skipped:\n%s", out.String())
	}

	codex, err := os.ReadFile(filepath.Join(home, ".codex", "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"[mcp_servers.claude]", "[mcp_servers.antigravity]", `"--host", "codex"`, "tool_timeout_sec = 3900", "startup_timeout_sec = 60"} {
		if !strings.Contains(string(codex), want) {
			t.Errorf("codex config lacks %q:\n%s", want, codex)
		}
	}
}

func TestInstallAllInteractiveAsks(t *testing.T) {
	for _, tc := range []struct {
		answer string
		count  int
	}{
		{"y\n", 6},
		{"YES\n", 6},
		{"\n", 3},
		{"n\n", 3},
	} {
		t.Run(fmt.Sprintf("%q", tc.answer), func(t *testing.T) {
			withHome(t)
			var out bytes.Buffer
			if err := runInstallAll(&out, strings.NewReader(tc.answer), allAgents, "user", false, true); err != nil {
				t.Fatalf("install --all: %v", err)
			}
			if !strings.Contains(out.String(), config.CycleConfirmPrompt()) {
				t.Errorf("prompt missing:\n%s", out.String())
			}
			if got := len(installedNames(t)); got != tc.count {
				t.Errorf("installed %d bridges, want %d\n%s", got, tc.count, out.String())
			}
		})
	}
}

func TestInstallAllWithTwoAgentsAndWithOne(t *testing.T) {
	withHome(t)
	var out bytes.Buffer
	// Two agents support both directions between them, which is a 2-cycle: the
	// user is asked, and on "no" only the first direction is installed.
	agents := map[string]bool{config.AgentClaude: true, config.AgentCodex: true}
	if err := runInstallAll(&out, strings.NewReader(""), agents, "user", false, true); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "[y/N]") {
		t.Fatalf("a 2-cycle must be confirmed:\n%s", out.String())
	}
	if got := strings.Join(installedNames(t), ","); got != "claude-codex" {
		t.Fatalf("installed = %s, want claude-codex", got)
	}
	if got := strings.Join(teamServerHosts(t), ","); got != "claude,codex" {
		t.Fatalf("team installed in %s, want claude,codex", got)
	}
}

func TestInstallAllWithOneAgentInstallsOnlyTheTeam(t *testing.T) {
	withHome(t)
	var out bytes.Buffer
	if err := runInstallAll(&out, strings.NewReader(""), map[string]bool{config.AgentCodex: true}, "user", false, true); err != nil {
		t.Fatal(err)
	}
	if len(installedNames(t)) != 0 || strings.Join(teamServerHosts(t), ",") != "codex" {
		t.Fatalf("bridges = %v team = %v, want no bridge and the team in codex", installedNames(t), teamServerHosts(t))
	}
	if strings.Contains(out.String(), "[y/N]") || !strings.Contains(out.String(), "OpenAI Codex: team server + skill ($agent-team)") {
		t.Fatalf("unexpected output:\n%s", out.String())
	}

	out.Reset()
	if err := runInstallAll(&out, strings.NewReader(""), map[string]bool{}, "user", false, true); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "No supported CLIs detected") {
		t.Fatalf("no CLI means nothing to install:\n%s", out.String())
	}
}

func TestInstallOneReportsTheCyclesItCloses(t *testing.T) {
	withHome(t)
	var out bytes.Buffer
	if err := runInstallOne(&out, "claude-codex", "user"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "closes cycles") {
		t.Fatalf("the first direction closes no cycle:\n%s", out.String())
	}
	out.Reset()
	if err := runInstallOne(&out, "codex-claude", "user"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "claude → codex → claude") {
		t.Fatalf("expected the closed cycle to be named:\n%s", out.String())
	}
	if err := runInstallOne(&out, "codex-team", "user"); err == nil {
		t.Fatal("expected an error for an unknown bridge")
	}
}

func TestDoctorBridgeGraph(t *testing.T) {
	home := withHome(t)
	if err := config.InstallBridge("claude-codex", "user"); err != nil {
		t.Fatal(err)
	}
	// A Codex entry from before spec 006: no env_vars.
	codexCfg := filepath.Join(home, ".codex", "config.toml")
	if err := os.MkdirAll(filepath.Dir(codexCfg), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(codexCfg, []byte("[mcp_servers.claude]\ncommand = \"npx\"\nargs = [\"-y\", \"@h0wzy/mcp-server-claude\"]\n"), 0600); err != nil {
		t.Fatal(err)
	}

	g := inspectBridges(func(k string) string {
		if k == "H0WZY_MCP_MAX_DEPTH" {
			return "7"
		}
		return ""
	})
	var out bytes.Buffer
	renderBridgeGraph(&out, g)
	text := out.String()
	for _, want := range []string{
		"🔗 Bridges (host → target)",
		"claude → codex",
		"user scope",
		"codex → claude",
		"⚠ env_vars missing: chain context only via the ancestry fallback",
		"🔁 Cycles",
		"  claude → codex → claude",
		"Loop guard: depth 4* · calls 8 · revisits off · deadline 60 min",
		"H0WZY_MCP_MAX_DEPTH=7 is above the hard cap 4: clamped",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("doctor output lacks %q:\n%s", want, text)
		}
	}
	if closed := g.closedCycles(); len(closed) != 1 || strings.Join(closed[0], ">") != "claude>codex>claude" {
		t.Errorf("closedCycles = %v", closed)
	}
}
