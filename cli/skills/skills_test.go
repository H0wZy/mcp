package skills

import (
	"bytes"
	"testing"
)

func TestAgentTeamSkillIsEmbeddedWithMarker(t *testing.T) {
	if len(AgentTeam) == 0 {
		t.Fatal("agent-team/SKILL.md was not embedded")
	}
	if !bytes.HasPrefix(AgentTeam, []byte("---\nname: "+AgentTeamName+"\n")) && !bytes.HasPrefix(AgentTeam, []byte("---\r\nname: "+AgentTeamName+"\r\n")) {
		t.Errorf("SKILL.md must start with front matter naming %q", AgentTeamName)
	}
	// hmcp only overwrites or deletes copies that carry the marker, so the
	// shipped file must carry it or a reinstall could never update it.
	if !bytes.Contains(AgentTeam, []byte(Marker)) {
		t.Errorf("SKILL.md lacks the %q marker", Marker)
	}
}
