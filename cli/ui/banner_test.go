package ui

import (
	"strings"
	"testing"
	"unicode/utf8"
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

func TestSlashedZeroInBanner(t *testing.T) {
	lines := strings.Split(asciiBanner, "\n")
	if len(lines) < 4 {
		t.Fatalf("Expected banner to have at least 4 lines")
	}
	// Row 2 and Row 3 must contain the diagonal slash cut inside the 0
	if !strings.Contains(lines[2], "█╗") {
		t.Errorf("Expected row 2 of banner to contain upper slash cut '█╗' in the zero")
	}
	if !strings.Contains(lines[3], "█╔╝") {
		t.Errorf("Expected row 3 of banner to contain lower slash cut '█╔╝' in the zero")
	}
}

func TestAsciiBannerProperties(t *testing.T) {
	lines := strings.Split(asciiBanner, "\n")
	if len(lines) < 4 {
		t.Errorf("Expected banner to have multiple lines, got %d", len(lines))
	}
	for i, line := range lines {
		runeCount := utf8.RuneCountInString(line)
		t.Logf("Line %d width: %d runes", i, runeCount)
		if runeCount > 80 {
			t.Errorf("Line %d exceeds 80-column terminal width limit: %d runes", i, runeCount)
		}
	}
}
