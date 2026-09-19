package version

import (
	"testing"
)

func TestIsNewer(t *testing.T) {
	tests := []struct {
		remote   string
		local    string
		expected bool
	}{
		{"1.0.3", "1.0.2", true},
		{"v1.0.3", "1.0.2", true},
		{"1.1.0", "1.0.9", true},
		{"2.0.0", "1.9.9", true},
		{"1.0.2", "1.0.2", false},
		{"1.0.1", "1.0.2", false},
		{"v1.0.0", "1.0.2", false},
		{"1.0.2.1", "1.0.2", true},
	}

	for _, tt := range tests {
		result := IsNewer(tt.remote, tt.local)
		if result != tt.expected {
			t.Errorf("IsNewer(%q, %q) = %v, expected %v", tt.remote, tt.local, result, tt.expected)
		}
	}
}
