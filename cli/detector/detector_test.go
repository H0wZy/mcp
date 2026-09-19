package detector

import (
	"testing"
)

func TestDetectTools(t *testing.T) {
	tools := DetectTools()
	if len(tools) == 0 {
		t.Fatal("Expected tools to be detected")
	}

	foundAny := false
	for _, tool := range tools {
		if tool.Installed {
			foundAny = true
			t.Logf("Found %s at %s (%s)", tool.DisplayName, tool.Path, tool.Version)
		}
	}

	if !foundAny {
		t.Log("Warning: No local tools installed on this machine")
	}
}
