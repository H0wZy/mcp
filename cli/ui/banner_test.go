package ui

import (
	"strings"
	"testing"
)

func TestRenderCompactHeader(t *testing.T) {
	header := RenderCompactHeader()
	if !strings.Contains(header, "H0wZy/mcp") {
		t.Errorf("Expected header to contain 'H0wZy/mcp', got: %s", header)
	}
	if !strings.Contains(header, AppVersion) {
		t.Errorf("Expected header to contain version '%s', got: %s", AppVersion, header)
	}
}

func TestRenderBanner_NonTTY(t *testing.T) {
	result := renderBanner(80, false)
	if result != "" {
		t.Errorf("Expected empty string for non-TTY output, got: %s", result)
	}
}

func TestRenderBanner_NarrowTerminal(t *testing.T) {
	result := renderBanner(50, true)
	if !strings.Contains(result, "H0wZy/mcp") {
		t.Errorf("Expected compact header for narrow width, got: %s", result)
	}
	if strings.Contains(result, asciiBanner) {
		t.Errorf("Did not expect full ASCII banner in narrow terminal")
	}
}

func TestRenderBanner_UndetectableWidth(t *testing.T) {
	result := renderBanner(0, true)
	if !strings.Contains(result, "H0wZy/mcp") {
		t.Errorf("Expected compact fallback for 0 width, got: %s", result)
	}
	if strings.Contains(result, asciiBanner) {
		t.Errorf("Did not expect full ASCII banner when terminal width is 0")
	}
}

func TestRenderBanner_WideTerminal(t *testing.T) {
	result := renderBanner(100, true)
	if !strings.Contains(result, "Claude Code") || !strings.Contains(result, "OpenAI Codex") || !strings.Contains(result, "Google Antigravity") {
		t.Errorf("Expected metadata in wide banner, got: %s", result)
	}
	if !strings.Contains(result, AppVersion) {
		t.Errorf("Expected AppVersion in banner, got: %s", result)
	}
}

func TestAsciiBannerProperties(t *testing.T) {
	lines := strings.Split(asciiBanner, "\n")
	if len(lines) < 4 {
		t.Errorf("Expected banner to have multiple lines, got %d", len(lines))
	}
	for i, line := range lines {
		if len(line) > 65 {
			t.Errorf("Line %d exceeds recommended terminal width limit: %d chars", i, len(line))
		}
	}
}
