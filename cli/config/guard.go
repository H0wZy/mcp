package config

import (
	"fmt"
	"strconv"
	"strings"
)

// Loop-guard defaults and hard caps (spec 006 data-model.md, Policy). The bridges
// enforce them at runtime; hmcp only reports them.
const (
	GuardDefaultMaxDepth        = 2
	GuardDefaultMaxCalls        = 8
	GuardDefaultDeadlineMinutes = 60
	GuardCapMaxDepth            = 4
	GuardCapMaxCalls            = 32
	GuardCapDeadlineMinutes     = 240
)

// GuardOverride is an H0WZY_MCP_* variable found in the environment.
type GuardOverride struct {
	Var     string `json:"var"`
	Value   string `json:"value"`
	Clamped bool   `json:"clamped,omitempty"` // above the hard cap, cut to the cap
	Invalid bool   `json:"invalid,omitempty"` // not a number or below 1, default used
}

// GuardPolicy is the effective loop-guard limits for bridges started with the
// given environment.
type GuardPolicy struct {
	MaxDepth        int             `json:"maxDepth"`
	MaxCalls        int             `json:"maxCalls"`
	AllowRevisit    bool            `json:"allowRevisit"`
	DeadlineMinutes int             `json:"deadlineMinutes"`
	Overrides       []GuardOverride `json:"overrides"`
}

// LoadGuardPolicy applies the data-model validation to the H0WZY_MCP_* variables
// read through getenv: a value that isn't a whole number ≥ 1 falls back to the
// default, and a value above the hard cap is clamped and flagged.
func LoadGuardPolicy(getenv func(string) string) GuardPolicy {
	p := GuardPolicy{Overrides: []GuardOverride{}}
	limit := func(name string, def, max int) int {
		raw := strings.TrimSpace(getenv(name))
		if raw == "" {
			return def
		}
		o := GuardOverride{Var: name, Value: raw}
		n, err := strconv.Atoi(raw)
		switch {
		case err != nil || n < 1:
			o.Invalid = true
			n = def
		case n > max:
			o.Clamped = true
			n = max
		}
		p.Overrides = append(p.Overrides, o)
		return n
	}
	p.MaxDepth = limit("H0WZY_MCP_MAX_DEPTH", GuardDefaultMaxDepth, GuardCapMaxDepth)
	p.MaxCalls = limit("H0WZY_MCP_MAX_CALLS", GuardDefaultMaxCalls, GuardCapMaxCalls)
	if raw := strings.TrimSpace(getenv("H0WZY_MCP_ALLOW_REVISIT")); raw != "" {
		p.AllowRevisit = raw == "1" || strings.EqualFold(raw, "true")
		p.Overrides = append(p.Overrides, GuardOverride{Var: "H0WZY_MCP_ALLOW_REVISIT", Value: raw})
	}
	p.DeadlineMinutes = limit("H0WZY_MCP_DEADLINE_MINUTES", GuardDefaultDeadlineMinutes, GuardCapDeadlineMinutes)
	return p
}

// Summary renders the limits as "depth 2 · calls 8 · revisits off · deadline 60 min".
// A clamped value is marked with "*".
func (p GuardPolicy) Summary() string {
	mark := func(name string) string {
		for _, o := range p.Overrides {
			if o.Var == name && o.Clamped {
				return "*"
			}
		}
		return ""
	}
	revisits := "off"
	if p.AllowRevisit {
		revisits = "on"
	}
	return fmt.Sprintf("depth %d%s · calls %d%s · revisits %s · deadline %d min%s",
		p.MaxDepth, mark("H0WZY_MCP_MAX_DEPTH"),
		p.MaxCalls, mark("H0WZY_MCP_MAX_CALLS"),
		revisits,
		p.DeadlineMinutes, mark("H0WZY_MCP_DEADLINE_MINUTES"))
}

// Describe explains one override for humans.
func (o GuardOverride) Describe() string {
	switch {
	case o.Invalid:
		return fmt.Sprintf("%s=%s is not a whole number ≥ 1: the default is used", o.Var, o.Value)
	case o.Clamped:
		return fmt.Sprintf("%s=%s is above the hard cap %d: clamped", o.Var, o.Value, guardCap(o.Var))
	}
	return fmt.Sprintf("%s=%s", o.Var, o.Value)
}

func guardCap(name string) int {
	switch name {
	case "H0WZY_MCP_MAX_DEPTH":
		return GuardCapMaxDepth
	case "H0WZY_MCP_MAX_CALLS":
		return GuardCapMaxCalls
	case "H0WZY_MCP_DEADLINE_MINUTES":
		return GuardCapDeadlineMinutes
	}
	return 0
}

// CycleConfirmPrompt is the question `install --all` asks before installing
// bridges that form cycles.
func CycleConfirmPrompt() string {
	return fmt.Sprintf("Install bridges that form cycles? The loop guard limits them (depth %d, %d calls, no revisits). [y/N]",
		GuardDefaultMaxDepth, GuardDefaultMaxCalls)
}
