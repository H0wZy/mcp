package config

import (
	"strings"
	"testing"
)

func envOf(vars map[string]string) func(string) string {
	return func(k string) string { return vars[k] }
}

func TestLoadGuardPolicyDefaults(t *testing.T) {
	p := LoadGuardPolicy(envOf(nil))
	if p.MaxDepth != 2 || p.MaxCalls != 8 || p.AllowRevisit || p.DeadlineMinutes != 60 || len(p.Overrides) != 0 {
		t.Fatalf("defaults = %+v", p)
	}
	if got, want := p.Summary(), "depth 2 · calls 8 · revisits off · deadline 60 min"; got != want {
		t.Fatalf("Summary() = %q, want %q", got, want)
	}
	if !strings.Contains(CycleConfirmPrompt(), "(depth 2, 8 calls, no revisits). [y/N]") {
		t.Fatalf("prompt = %q", CycleConfirmPrompt())
	}
}

func TestLoadGuardPolicyOverridesClampAndInvalid(t *testing.T) {
	p := LoadGuardPolicy(envOf(map[string]string{
		"H0WZY_MCP_MAX_DEPTH":        "9",
		"H0WZY_MCP_MAX_CALLS":        "abc",
		"H0WZY_MCP_ALLOW_REVISIT":    "true",
		"H0WZY_MCP_DEADLINE_MINUTES": "90",
	}))
	if p.MaxDepth != 4 || p.MaxCalls != 8 || !p.AllowRevisit || p.DeadlineMinutes != 90 {
		t.Fatalf("policy = %+v", p)
	}
	if got, want := p.Summary(), "depth 4* · calls 8 · revisits on · deadline 90 min"; got != want {
		t.Fatalf("Summary() = %q, want %q", got, want)
	}
	var described []string
	for _, o := range p.Overrides {
		described = append(described, o.Describe())
	}
	want := []string{
		"H0WZY_MCP_MAX_DEPTH=9 is above the hard cap 4: clamped",
		"H0WZY_MCP_MAX_CALLS=abc is not a whole number ≥ 1: the default is used",
		"H0WZY_MCP_ALLOW_REVISIT=true",
		"H0WZY_MCP_DEADLINE_MINUTES=90",
	}
	if strings.Join(described, "\n") != strings.Join(want, "\n") {
		t.Fatalf("overrides:\n%s\nwant:\n%s", strings.Join(described, "\n"), strings.Join(want, "\n"))
	}

	p = LoadGuardPolicy(envOf(map[string]string{"H0WZY_MCP_MAX_CALLS": "500", "H0WZY_MCP_DEADLINE_MINUTES": "0", "H0WZY_MCP_ALLOW_REVISIT": "yes"}))
	if p.MaxCalls != 32 || p.DeadlineMinutes != 60 || p.AllowRevisit {
		t.Fatalf("policy = %+v", p)
	}
}
