package config

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"

	"github.com/H0wZy/mcp/cli/skills"
)

func userSkillPaths(home string) map[string][]string {
	rel := filepath.Join("agent-team", "SKILL.md")
	return map[string][]string{
		AgentClaude: {filepath.Join(home, ".claude", "skills", rel)},
		AgentCodex:  {filepath.Join(home, ".agents", "skills", rel)},
		AgentAntigravity: {
			filepath.Join(home, ".gemini", "antigravity-cli", "skills", rel),
			filepath.Join(home, ".gemini", "config", "skills", rel),
		},
	}
}

func assertEmbeddedCopy(t *testing.T, path string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("skill copy %s: %v", path, err)
	}
	if !bytes.Equal(got, skills.AgentTeam) {
		t.Fatalf("skill copy %s differs from the embedded SKILL.md", path)
	}
	if runtime.GOOS != "windows" {
		if info, _ := os.Stat(path); info.Mode().Perm() != 0644 {
			t.Errorf("skill copy %s mode %v, want 0644", path, info.Mode().Perm())
		}
	}
}

// assertReadableFolder checks a folder hmcp created is readable and listable
// by everyone (0755 under the usual 022 umask), unlike the 0700 config folders.
func assertReadableFolder(t *testing.T, dir string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		return
	}
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0555 != 0555 {
		t.Errorf("folder %s mode %v, want 0755", dir, info.Mode().Perm())
	}
}

func TestInstallTeamWritesServerAndSkillInEveryHost(t *testing.T) {
	home := withHome(t)
	t.Chdir(t.TempDir()) // no ./servers: the npx launch is used

	for _, host := range TeamHosts {
		change, err := InstallTeam(host, "user")
		if err != nil {
			t.Fatalf("install team in %s: %v", host, err)
		}
		for _, s := range change.Skills {
			if s.Action != "installed" {
				t.Errorf("%s: %s was %s, want installed", host, s.Path, s.Action)
			}
		}
	}

	// Server entries, with --host and (Codex) the chain and team env_vars.
	edges, err := InstalledBridges()
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, e := range edges {
		got = append(got, fmt.Sprintf("%s>%s:%s:%v", e.Host, e.Target, e.Name, e.GuardReady))
	}
	sort.Strings(got)
	if want := "antigravity>team:team:true claude>team:team:true codex>team:team:true"; strings.Join(got, " ") != want {
		t.Fatalf("team edges = %v, want %s", got, want)
	}
	codex := readFile(t, filepath.Join(home, ".codex", "config.toml"))
	for _, want := range []string{
		"[mcp_servers.team]\ncommand = \"npx\"\nargs = [\"-y\", \"@h0wzy/mcp-server-team\", \"--host\", \"codex\"]\nenv_vars = [",
		`"H0WZY_MCP_CHAIN", `,
		`"H0WZY_MCP_CHAIN_LOG", "H0WZY_TEAM_MAX_TEAMMATES", "H0WZY_TEAM_MAX_TURNS", "H0WZY_TEAM_MAX_TOTAL_TURNS", "H0WZY_TEAM_DEADLINE_MINUTES", "H0WZY_TEAM_TURN_MINUTES", "H0WZY_TEAM_RESULT_CAP", "H0WZY_TEAM_ALLOW_CHECKS"]`,
		"tool_timeout_sec = 3900\nstartup_timeout_sec = 60",
	} {
		if !strings.Contains(codex, want) {
			t.Errorf("codex config lacks %q:\n%s", want, codex)
		}
	}
	for path, want := range map[string]string{
		filepath.Join(home, ".claude.json"):                         "[-y @h0wzy/mcp-server-team --host claude]",
		filepath.Join(home, ".gemini", "config", "mcp_config.json"): "[-y @h0wzy/mcp-server-team --host antigravity]",
	} {
		var data map[string]interface{}
		if err := json.Unmarshal([]byte(readFile(t, path)), &data); err != nil {
			t.Fatal(err)
		}
		entry := data["mcpServers"].(map[string]interface{})["team"].(map[string]interface{})
		if fmt.Sprint(entry["args"]) != want {
			t.Errorf("%s team args = %v, want %s", path, entry["args"], want)
		}
	}

	// Every skill copy is byte-equal to the embedded file, in a folder hmcp made readable.
	for _, paths := range userSkillPaths(home) {
		for _, p := range paths {
			assertEmbeddedCopy(t, p)
			assertReadableFolder(t, filepath.Dir(p))
		}
	}

	// Bridges to the team never form a cycle.
	all := append([]BridgeEdge(nil), edges...)
	for _, b := range Bridges {
		all = append(all, BridgeEdge{Host: b.Host, Target: b.Target})
	}
	for _, c := range Cycles(all) {
		for _, n := range c {
			if n == AgentTeam {
				t.Fatalf("cycle through the team: %s", FormatCycle(c))
			}
		}
	}
}

func TestTeamSkillPathsAntigravityIDEOnlyWithItsConfigFolder(t *testing.T) {
	home := withHome(t)
	paths, err := teamSkillPaths(AgentAntigravity, "user", false)
	if err != nil || len(paths) != 1 || !strings.Contains(filepath.ToSlash(paths[0]), "/.gemini/antigravity-cli/skills/agent-team/") {
		t.Fatalf("without ~/.gemini/config: %v %v", paths, err)
	}
	if all, _ := teamSkillPaths(AgentAntigravity, "user", true); len(all) != 2 {
		t.Fatalf("removal must consider the IDE folder too: %v", all)
	}
	if err := os.MkdirAll(filepath.Join(home, ".gemini", "config"), 0700); err != nil {
		t.Fatal(err)
	}
	if paths, _ := teamSkillPaths(AgentAntigravity, "user", false); len(paths) != 2 {
		t.Fatalf("with ~/.gemini/config: %v", paths)
	}
}

func TestInstallTeamProjectScope(t *testing.T) {
	home := withHome(t)
	project := t.TempDir()
	t.Chdir(project)

	for _, host := range TeamHosts {
		if _, err := InstallTeam(host, "project"); err != nil {
			t.Fatalf("install team in %s: %v", host, err)
		}
	}
	assertEmbeddedCopy(t, filepath.Join(project, ".claude", "skills", "agent-team", "SKILL.md"))
	assertEmbeddedCopy(t, filepath.Join(project, ".agents", "skills", "agent-team", "SKILL.md"))
	if !strings.Contains(readFile(t, filepath.Join(project, ".mcp.json")), "@h0wzy/mcp-server-team") {
		t.Error("project scope must register the Claude team server in .mcp.json")
	}
	for _, paths := range userSkillPaths(home) {
		for _, p := range paths {
			if _, err := os.Stat(p); !os.IsNotExist(err) {
				t.Errorf("project scope wrote a user skill copy at %s", p)
			}
		}
	}
}

func TestInstallTeamUpdatesMarkedCopyAndKeepsForeignOne(t *testing.T) {
	home := withHome(t)
	t.Chdir(t.TempDir())
	paths := userSkillPaths(home)
	outdated := "---\nname: agent-team\n---\n<!-- installed by hmcp (H0wZy/mcp). -->\nold body\n"
	foreign := "---\nname: agent-team\n---\nMy own team skill.\n"
	writeFile(t, paths[AgentClaude][0], outdated)
	writeFile(t, paths[AgentCodex][0], foreign)

	change, err := InstallTeam(AgentClaude, "user")
	if err != nil || len(change.Skills) != 1 || change.Skills[0].Action != "updated" {
		t.Fatalf("claude: change=%+v err=%v, want the marked copy updated", change, err)
	}
	assertEmbeddedCopy(t, paths[AgentClaude][0])

	change, err = InstallTeam(AgentCodex, "user")
	if err != nil {
		t.Fatalf("a foreign copy is not an error: %v", err)
	}
	if len(change.Skills) != 1 || change.Skills[0].Action != "skipped" ||
		change.Skills[0].Reason != "a different agent-team skill already exists at "+paths[AgentCodex][0] {
		t.Fatalf("codex: %+v, want the foreign copy skipped with the contract's reason", change.Skills)
	}
	if got := readFile(t, paths[AgentCodex][0]); got != foreign {
		t.Fatalf("foreign copy was modified: %q", got)
	}
	if !strings.Contains(readFile(t, filepath.Join(home, ".codex", "config.toml")), "[mcp_servers.team]") {
		t.Fatal("the team server must be registered even when the skill copy is skipped")
	}

	// A second install leaves the current copy alone.
	change, _ = InstallTeam(AgentClaude, "user")
	if change.Skills[0].Action != "unchanged" {
		t.Fatalf("reinstall of a current copy: %+v", change.Skills)
	}
}

func TestRemoveTeamDeletesOnlyMarkedCopies(t *testing.T) {
	home := withHome(t)
	t.Chdir(t.TempDir())
	for _, host := range TeamHosts {
		if _, err := InstallTeam(host, "user"); err != nil {
			t.Fatal(err)
		}
	}
	paths := userSkillPaths(home)
	foreign := "my own skill\n"
	writeFile(t, paths[AgentCodex][0], foreign)                                               // replaced by the user
	writeFile(t, filepath.Join(filepath.Dir(paths[AgentAntigravity][1]), "notes.md"), "mine") // extra file in the folder

	var changes []SkillChange
	for _, host := range TeamHosts {
		change, err := RemoveTeam(host, "user")
		if err != nil {
			t.Fatalf("remove team from %s: %v", host, err)
		}
		changes = append(changes, change.Skills...)
	}

	if _, err := os.Stat(filepath.Dir(paths[AgentClaude][0])); !os.IsNotExist(err) {
		t.Error("the marked Claude copy and its empty agent-team folder must be gone")
	}
	if _, err := os.Stat(paths[AgentAntigravity][0]); !os.IsNotExist(err) {
		t.Error("the marked Antigravity CLI copy must be gone")
	}
	if _, err := os.Stat(paths[AgentAntigravity][1]); !os.IsNotExist(err) {
		t.Error("the marked Antigravity IDE copy must be gone")
	}
	if got := readFile(t, filepath.Join(filepath.Dir(paths[AgentAntigravity][1]), "notes.md")); got != "mine" {
		t.Error("a folder with other files must be kept, with those files")
	}
	if got := readFile(t, paths[AgentCodex][0]); got != foreign {
		t.Errorf("a copy without the marker must be kept, got %q", got)
	}
	kept := 0
	for _, c := range changes {
		if c.Action == "kept" && c.Path == paths[AgentCodex][0] {
			kept++
		}
	}
	if kept != 1 {
		t.Errorf("the kept copy must be reported once: %+v", changes)
	}

	edges, err := InstalledBridges()
	if err != nil || len(edges) != 0 {
		t.Fatalf("team servers left after remove: %+v %v", edges, err)
	}
}

func TestTeamStatusClassifiesCopies(t *testing.T) {
	home := withHome(t)
	project := t.TempDir()
	t.Chdir(project)
	if err := os.MkdirAll(filepath.Join(home, ".gemini", "config"), 0700); err != nil {
		t.Fatal(err)
	}
	paths := userSkillPaths(home)
	writeFile(t, paths[AgentClaude][0], string(skills.AgentTeam))                        // current
	writeFile(t, paths[AgentAntigravity][0], "<!-- installed by hmcp -->\nolder text\n") // outdated
	writeFile(t, paths[AgentAntigravity][1], "someone else's skill\n")                   // foreign
	// Codex: missing. A project copy for Claude is reported too.
	writeFile(t, filepath.Join(project, ".claude", "skills", "agent-team", "SKILL.md"), string(skills.AgentTeam))

	edges := []BridgeEdge{{Host: AgentClaude, Target: AgentTeam}, {Host: AgentCodex, Target: AgentClaude}}
	status := TeamStatus(TeamHosts, edges)
	var got []string
	for _, s := range status {
		line := fmt.Sprintf("%s server=%v", s.Host, s.Server)
		for _, c := range s.Skills {
			line += fmt.Sprintf(" %s:%s", c.Scope, c.State)
		}
		got = append(got, line)
	}
	want := []string{
		"claude server=true user:current project:current",
		"codex server=false user:missing",
		"antigravity server=false user:outdated user:foreign",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("status:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}
