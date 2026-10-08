package cmd

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/H0wZy/mcp/cli/config"
)

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestInstallTeamInDetectedHostsOnly(t *testing.T) {
	home := withHome(t)
	foreign := filepath.Join(home, ".agents", "skills", "agent-team", "SKILL.md")
	writeTestFile(t, foreign, "my own agent-team skill\n")

	var out bytes.Buffer
	agents := map[string]bool{config.AgentClaude: true, config.AgentCodex: true}
	if err := runInstallTeam(&out, agents, "user"); err != nil {
		t.Fatalf("install team: %v", err)
	}
	text := out.String()
	for _, want := range []string{
		"✓ Claude Code: team server + skill (/agent-team)",
		"⚠ OpenAI Codex: team server only",
		"skipped: a different agent-team skill already exists at " + foreign,
	} {
		if !strings.Contains(text, want) {
			t.Errorf("output lacks %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "Google Antigravity") {
		t.Errorf("antigravity is not detected and must not be touched:\n%s", text)
	}
	if got := strings.Join(teamServerHosts(t), ","); got != "claude,codex" {
		t.Fatalf("team servers in %s, want claude,codex", got)
	}

	out.Reset()
	if err := runInstallTeam(&out, map[string]bool{config.AgentAntigravity: true}, "user"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "✓ Google Antigravity: team server + skill (/agent-team)") {
		t.Fatalf("unexpected output:\n%s", out.String())
	}
}

func TestRemoveTeamCommand(t *testing.T) {
	home := withHome(t)
	if err := runInstallTeam(&bytes.Buffer{}, allAgents, "user"); err != nil {
		t.Fatal(err)
	}
	foreign := filepath.Join(home, ".claude", "skills", "agent-team", "SKILL.md")
	writeTestFile(t, foreign, "not from hmcp\n")

	var out bytes.Buffer
	if err := runRemoveTeam(&out, "user"); err != nil {
		t.Fatalf("remove team: %v", err)
	}
	text := out.String()
	if !strings.Contains(text, "kept "+foreign+": it was not installed by hmcp") || !strings.Contains(text, "removed skill") {
		t.Errorf("unexpected output:\n%s", text)
	}
	if len(teamServerHosts(t)) != 0 {
		t.Errorf("team servers left: %v", teamServerHosts(t))
	}
	if _, err := os.Stat(foreign); err != nil {
		t.Errorf("the foreign copy must be kept: %v", err)
	}
}

func TestDoctorTeamSection(t *testing.T) {
	home := withHome(t)
	if err := runInstallTeam(&bytes.Buffer{}, allAgents, "user"); err != nil {
		t.Fatal(err)
	}
	// Codex copy removed, Antigravity CLI copy outdated, IDE copy foreign.
	if err := os.Remove(filepath.Join(home, ".agents", "skills", "agent-team", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(home, ".gemini", "antigravity-cli", "skills", "agent-team", "SKILL.md"), "<!-- installed by hmcp -->\nold\n")
	writeTestFile(t, filepath.Join(home, ".gemini", "config", "skills", "agent-team", "SKILL.md"), "someone else's\n")

	edges, err := config.InstalledBridges()
	if err != nil {
		t.Fatal(err)
	}
	team := config.TeamStatus(doctorTeamHosts(allAgents, edges), edges)
	var out bytes.Buffer
	renderTeam(&out, team)
	text := out.String()
	for _, want := range []string{
		"👥 Agent team",
		"claude: server ✓ · skill ✓ ~/.claude/skills/agent-team (current)",
		"codex: server ✓ · skill ✗ missing (run hmcp install team)",
		"antigravity: server ✓ · skill ⚠ outdated ~/.gemini/antigravity-cli/skills/agent-team",
		"skill ⚠ foreign ~/.gemini/config/skills/agent-team",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("doctor output lacks %q:\n%s", want, text)
		}
	}

	data, err := json.Marshal(doctorReport{Team: team})
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Team []struct {
			Host   string `json:"host"`
			Server bool   `json:"server"`
			Skills []struct {
				Path, Scope, State string
			} `json:"skills"`
		} `json:"team"`
	}
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Team) != 3 || decoded.Team[2].Host != "antigravity" || decoded.Team[2].Skills[0].State != config.SkillOutdated || decoded.Team[2].Skills[1].State != config.SkillForeign {
		t.Fatalf("doctor --json team = %s", data)
	}
}

func TestDoctorTeamHosts(t *testing.T) {
	// Detected CLIs, plus hosts that still have a team server registered.
	edges := []config.BridgeEdge{{Host: config.AgentAntigravity, Target: config.AgentTeam}, {Host: config.AgentCodex, Target: config.AgentClaude}}
	if got := strings.Join(doctorTeamHosts(map[string]bool{config.AgentClaude: true}, edges), ","); got != "claude,antigravity" {
		t.Fatalf("hosts = %s", got)
	}
	var out bytes.Buffer
	renderTeam(&out, nil)
	if !strings.Contains(out.String(), "no supported CLI detected") {
		t.Fatalf("empty team section:\n%s", out.String())
	}
}
