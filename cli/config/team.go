package config

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/H0wZy/mcp/cli/skills"
)

// TeamServerKey is the server key of the agent team server (spec 007) in every host config.
const TeamServerKey = AgentTeam

// TeamHosts are the harnesses that can run the team server, in install order.
var TeamHosts = []string{AgentClaude, AgentCodex, AgentAntigravity}

// States of an agent-team skill copy.
const (
	SkillCurrent    = "current"    // byte-equal to the embedded SKILL.md
	SkillOutdated   = "outdated"   // carries the hmcp marker but differs
	SkillForeign    = "foreign"    // no marker: someone else's file, never touched
	SkillMissing    = "missing"    // nothing at that path
	SkillUnreadable = "unreadable" // exists but can't be read
)

// SkillChange is what install or remove did to one skill copy.
type SkillChange struct {
	Path   string
	Action string // installed | updated | unchanged | skipped | removed | kept
	Reason string // why it was skipped or kept
}

// TeamChange is the outcome of installing or removing the team for one host.
type TeamChange struct {
	Host   string
	Skills []SkillChange
}

// SkillCopy is one place a harness reads the agent-team skill from.
type SkillCopy struct {
	Path  string `json:"path"`
	Scope string `json:"scope"`
	State string `json:"state"`
}

// TeamHostStatus is what doctor reports about the team in one host.
type TeamHostStatus struct {
	Host   string      `json:"host"`
	Server bool        `json:"server"`
	Skills []SkillCopy `json:"skills"`
}

// SkillTrigger is how a user invokes the agent-team skill in a host.
func SkillTrigger(host string) string {
	if host == AgentCodex {
		return "$" + skills.AgentTeamName
	}
	return "/" + skills.AgentTeamName
}

// teamSkillPaths returns where the host reads the agent-team skill for a scope
// (research: Claude ~/.claude/skills, Codex ~/.agents/skills, Antigravity CLI
// ~/.gemini/antigravity-cli/skills and IDE ~/.gemini/config/skills; projects use
// ./.claude/skills or ./.agents/skills). The Antigravity IDE folder is only
// included when ~/.gemini/config/ exists, unless all is set (removal).
func teamSkillPaths(host, scope string, all bool) ([]string, error) {
	rel := filepath.Join(skills.AgentTeamName, "SKILL.md")
	if scope == "project" || scope == "local" {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, err
		}
		switch host {
		case AgentClaude:
			return []string{filepath.Join(cwd, ".claude", "skills", rel)}, nil
		case AgentCodex, AgentAntigravity:
			return []string{filepath.Join(cwd, ".agents", "skills", rel)}, nil
		}
		return nil, unknownTeamHost(host)
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	switch host {
	case AgentClaude:
		return []string{filepath.Join(home, ".claude", "skills", rel)}, nil
	case AgentCodex:
		return []string{filepath.Join(home, ".agents", "skills", rel)}, nil
	case AgentAntigravity:
		paths := []string{filepath.Join(home, ".gemini", "antigravity-cli", "skills", rel)}
		ide := filepath.Join(home, ".gemini", "config")
		if info, err := os.Stat(ide); all || (err == nil && info.IsDir()) {
			paths = append(paths, filepath.Join(ide, "skills", rel))
		}
		return paths, nil
	}
	return nil, unknownTeamHost(host)
}

func unknownTeamHost(host string) error {
	return fmt.Errorf("unknown team host: %s (valid: claude, codex, antigravity)", host)
}

// classifySkillCopy compares the file at path with the embedded skill.
func classifySkillCopy(path string) (string, error) {
	info, err := os.Stat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return SkillMissing, nil
	}
	if err != nil {
		return SkillUnreadable, err
	}
	if !info.Mode().IsRegular() {
		return SkillForeign, nil
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return SkillUnreadable, err
	}
	switch {
	case bytes.Equal(content, skills.AgentTeam):
		return SkillCurrent, nil
	case bytes.Contains(content, []byte(skills.Marker)):
		return SkillOutdated, nil
	}
	return SkillForeign, nil
}

// installSkillCopy writes the embedded skill to path unless a file without the
// hmcp marker is already there. Folders are 0755 and the file 0644, so the
// harness can read it; the write is atomic.
func installSkillCopy(path string) (SkillChange, error) {
	change := SkillChange{Path: path}
	state, err := classifySkillCopy(path)
	if err != nil {
		change.Action, change.Reason = "skipped", err.Error()
		return change, err
	}
	switch state {
	case SkillForeign:
		change.Action, change.Reason = "skipped", "a different agent-team skill already exists at "+path
		return change, nil
	case SkillCurrent:
		change.Action = "unchanged"
		return change, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		change.Action, change.Reason = "skipped", err.Error()
		return change, err
	}
	if err := writeFileAtomic(path, skills.AgentTeam, 0644); err != nil {
		change.Action, change.Reason = "skipped", err.Error()
		return change, err
	}
	change.Action = "installed"
	if state == SkillOutdated {
		change.Action = "updated"
	}
	return change, nil
}

// removeSkillCopy deletes path only if it carries the hmcp marker, then its
// agent-team folder if that is left empty.
func removeSkillCopy(path string) (*SkillChange, error) {
	state, err := classifySkillCopy(path)
	switch {
	case err != nil:
		return &SkillChange{Path: path, Action: "kept", Reason: err.Error()}, err
	case state == SkillMissing:
		return nil, nil
	case state == SkillForeign:
		return &SkillChange{Path: path, Action: "kept", Reason: "it was not installed by hmcp"}, nil
	}
	if err := os.Remove(path); err != nil {
		return &SkillChange{Path: path, Action: "kept", Reason: err.Error()}, err
	}
	_ = os.Remove(filepath.Dir(path)) // fails, and keeps the folder, when other files are in it
	return &SkillChange{Path: path, Action: "removed"}, nil
}

// InstallTeam registers the team server in the host's config (with --host, and
// for Codex the chain and team env_vars plus timeouts) and copies the
// agent-team skill to every folder the host reads skills from. The server is
// written even when a skill copy is skipped; copy failures are returned joined
// after every copy has been tried.
func InstallTeam(host, scope string) (TeamChange, error) {
	change := TeamChange{Host: host}
	command, args := ResolveServerScript(AgentTeam)
	var err error
	switch host {
	case AgentClaude:
		err = RegisterClaudeServerCommand(TeamServerKey, command, args, scope)
	case AgentCodex:
		err = registerCodexServer(TeamServerKey, command, args, codexTeamEnvVars())
	case AgentAntigravity:
		err = RegisterAntigravityServerCommand(TeamServerKey, command, args)
	default:
		err = unknownTeamHost(host)
	}
	if err != nil {
		return change, err
	}

	paths, err := teamSkillPaths(host, scope, false)
	if err != nil {
		return change, err
	}
	var problems []error
	for _, p := range paths {
		c, err := installSkillCopy(p)
		change.Skills = append(change.Skills, c)
		if err != nil {
			problems = append(problems, fmt.Errorf("%s: %w", p, err))
		}
	}
	return change, errors.Join(problems...)
}

// RemoveTeam removes the team server key from the host's config and deletes
// the skill copies hmcp installed for that scope. Copies without the marker
// are kept and reported.
func RemoveTeam(host, scope string) (TeamChange, error) {
	change := TeamChange{Host: host}
	var err error
	switch host {
	case AgentClaude:
		err = UnregisterClaudeServer(TeamServerKey, scope)
	case AgentCodex:
		err = UnregisterCodexServer(TeamServerKey)
	case AgentAntigravity:
		err = UnregisterAntigravityServer(TeamServerKey)
	default:
		err = unknownTeamHost(host)
	}
	if err != nil {
		return change, err
	}

	paths, err := teamSkillPaths(host, scope, true)
	if err != nil {
		return change, err
	}
	var problems []error
	for _, p := range paths {
		c, err := removeSkillCopy(p)
		if c != nil {
			change.Skills = append(change.Skills, *c)
		}
		if err != nil {
			problems = append(problems, fmt.Errorf("%s: %w", p, err))
		}
	}
	return change, errors.Join(problems...)
}

// TeamStatus reports, for each host, whether the team server is registered
// (from the installed edges) and the state of every user-scope skill copy the
// host reads, plus project-scope copies in the current directory when present.
func TeamStatus(hosts []string, edges []BridgeEdge) []TeamHostStatus {
	statuses := make([]TeamHostStatus, 0, len(hosts))
	for _, host := range hosts {
		s := TeamHostStatus{Host: host, Skills: []SkillCopy{}}
		for _, e := range edges {
			if e.Host == host && e.Target == AgentTeam {
				s.Server = true
			}
		}
		seen := map[string]bool{} // run from $HOME, project and user paths coincide
		for _, scope := range []string{"user", "project"} {
			paths, err := teamSkillPaths(host, scope, false)
			if err != nil {
				continue
			}
			for _, p := range paths {
				if seen[p] {
					continue
				}
				seen[p] = true
				state, _ := classifySkillCopy(p)
				if scope == "project" && state == SkillMissing {
					continue // project copies are optional
				}
				s.Skills = append(s.Skills, SkillCopy{Path: p, Scope: scope, State: state})
			}
		}
		statuses = append(statuses, s)
	}
	return statuses
}
