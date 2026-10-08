package config

import (
	"fmt"
	"strings"
)

// Agent names as they appear in bridge names, chain traces and the --host flag.
const (
	AgentClaude      = "claude"
	AgentCodex       = "codex"
	AgentAntigravity = "antigravity"
	AgentTeam        = "team"
)

// Bridge is one installable direction: the Host agent gets an MCP server that
// starts the Target agent. The server key in the host config is the target name.
type Bridge struct {
	Name   string
	Host   string
	Target string
}

// Bridges lists every direction in the fixed install order: claude-* first,
// then codex-*, then antigravity-*. `install --all` relies on this order to
// decide deterministically which cycle-closing directions it skips.
var Bridges = []Bridge{
	{Name: "claude-antigravity", Host: AgentClaude, Target: AgentAntigravity},
	{Name: "claude-codex", Host: AgentClaude, Target: AgentCodex},
	{Name: "codex-antigravity", Host: AgentCodex, Target: AgentAntigravity},
	{Name: "codex-claude", Host: AgentCodex, Target: AgentClaude},
	{Name: "antigravity-codex", Host: AgentAntigravity, Target: AgentCodex},
	{Name: "antigravity-claude", Host: AgentAntigravity, Target: AgentClaude},
}

// LookupBridge returns the direction with the given name ("codex-claude", …).
func LookupBridge(name string) (Bridge, bool) {
	for _, b := range Bridges {
		if b.Name == name {
			return b, true
		}
	}
	return Bridge{}, false
}

// BridgeNames returns the names of all directions in install order.
func BridgeNames() []string {
	names := make([]string, len(Bridges))
	for i, b := range Bridges {
		names[i] = b.Name
	}
	return names
}

// AgentDisplayName is the product name shown to users.
func AgentDisplayName(agent string) string {
	switch agent {
	case AgentClaude:
		return "Claude Code"
	case AgentCodex:
		return "OpenAI Codex"
	case AgentAntigravity:
		return "Google Antigravity"
	case AgentTeam:
		return "Agent Team"
	}
	return agent
}

// InstallBridge writes the bridge's MCP server entry into its host's config.
// scope only applies to Claude Code hosts ("user" or "project").
func InstallBridge(name, scope string) error {
	b, ok := LookupBridge(name)
	if !ok {
		return unknownBridgeError(name)
	}
	command, args := ResolveServerScript(b.Target)
	switch b.Host {
	case AgentClaude:
		return RegisterClaudeServerCommand(b.Target, command, args, scope)
	case AgentCodex:
		return RegisterCodexServerCommand(b.Target, command, args)
	case AgentAntigravity:
		return RegisterAntigravityServerCommand(b.Target, command, args)
	}
	return unknownBridgeError(name)
}

// RemoveBridge deletes the bridge's server entry from its host's config.
func RemoveBridge(name, scope string) error {
	b, ok := LookupBridge(name)
	if !ok {
		return unknownBridgeError(name)
	}
	switch b.Host {
	case AgentClaude:
		return UnregisterClaudeServer(b.Target, scope)
	case AgentCodex:
		return UnregisterCodexServer(b.Target)
	case AgentAntigravity:
		return UnregisterAntigravityServer(b.Target)
	}
	return unknownBridgeError(name)
}

func unknownBridgeError(name string) error {
	return fmt.Errorf("unknown bridge: %s (valid: %s)", name, strings.Join(BridgeNames(), ", "))
}

// withHostArg returns args with any previous --host value removed and
// "--host <host>" appended, so the bridge knows which agent runs it (research D1).
func withHostArg(args []string, host string) []string {
	out := make([]string, 0, len(args)+2)
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--host" {
			i++ // drop the value too
			continue
		}
		if strings.HasPrefix(a, "--host=") {
			continue
		}
		out = append(out, a)
	}
	return append(out, "--host", host)
}
