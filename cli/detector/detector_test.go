package detector

import (
	"strings"
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

func TestSanitizeHealthMessage(t *testing.T) {
	raw := "Error: 401 Unauthorized with token sk-proj-1234567890abcdef1234567890 and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
	sanitized := SanitizeHealthMessage(raw)

	if strings.Contains(sanitized, "sk-proj-1234567890abcdef1234567890") {
		t.Errorf("Expected OpenAI key to be redacted, got: %s", sanitized)
	}
	if strings.Contains(sanitized, "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9") {
		t.Errorf("Expected Bearer token to be redacted, got: %s", sanitized)
	}
	if !strings.Contains(sanitized, "[REDACTED_OPENAI_KEY]") {
		t.Errorf("Expected [REDACTED_OPENAI_KEY] in output, got: %s", sanitized)
	}
	if !strings.Contains(sanitized, "[REDACTED_BEARER_TOKEN]") {
		t.Errorf("Expected [REDACTED_BEARER_TOKEN] in output, got: %s", sanitized)
	}
}
