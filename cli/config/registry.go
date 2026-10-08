package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
)

// Registry is the developer's private list of their own MCP servers (spec 008).
// It lives on their machine, never in this repository: names, commands, URLs and
// paths of private servers are private data even when they are not secrets.
type Registry struct {
	Version int                       `json:"version"`
	Servers map[string]*RegistryEntry `json:"servers"`
}

// RegistryEntry is one server: exactly one of URL or Command is set.
type RegistryEntry struct {
	URL     string   `json:"url,omitempty"`
	Command string   `json:"command,omitempty"`
	Args    []string `json:"args,omitempty"`
	Clients []string `json:"clients,omitempty"` // empty means every client
	Env     []string `json:"env,omitempty"`     // env var names to forward, never values
	Note    string   `json:"note,omitempty"`
	// Applied lists the client entries hmcp wrote or adopted for this server.
	// Only these are ever updated or removed (FR-006).
	Applied []Destination `json:"applied,omitempty"`
}

// Destination is one client config that can hold a registered server.
type Destination struct {
	Client  string `json:"client"`
	Project string `json:"project,omitempty"` // Codex project folder; empty for user scope
}

// RegistryClients are the clients a registry entry can be applied to.
var RegistryClients = []string{AgentClaude, AgentCodex, AgentAntigravity}

// Bridge names belong to `hmcp install` (FR-010).
var reservedRegistryNames = []string{AgentCodex, AgentAntigravity, AgentClaude, AgentTeam}

var (
	registryNameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
	envNameRe      = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	mcpPathRe      = regexp.MustCompile(`^/[^/]+/mcp/?$`)
)

// RegistryPath is $H0WZY_MCP_REGISTRY, or ~/.h0wzy-mcp/registry.json.
func RegistryPath() (string, error) {
	if p := strings.TrimSpace(os.Getenv("H0WZY_MCP_REGISTRY")); p != "" {
		return p, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".h0wzy-mcp", "registry.json"), nil
}

// LoadRegistry reads the registry. A missing or blank file is an empty registry;
// a file that does not parse, or has unknown fields, is refused.
func LoadRegistry(path string) (*Registry, error) {
	reg := &Registry{Version: 1, Servers: map[string]*RegistryEntry{}}
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return reg, nil
	}
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(b)) == 0 {
		return reg, nil
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(reg); err != nil {
		return nil, &invalidJSONError{path: path, err: err}
	}
	if reg.Version > 1 {
		return nil, fmt.Errorf("%s was written by a newer hmcp (version %d); upgrade hmcp", path, reg.Version)
	}
	if reg.Servers == nil {
		reg.Servers = map[string]*RegistryEntry{}
	}
	return reg, nil
}

// SaveRegistry writes the registry atomically with 0600 permissions.
func SaveRegistry(path string, reg *Registry) error {
	reg.Version = 1
	out, err := json.MarshalIndent(reg, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(path, append(out, '\n'), 0600)
}

// SortedNames returns the registered names in order.
func (r *Registry) SortedNames() []string {
	names := make([]string, 0, len(r.Servers))
	for n := range r.Servers {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// ValidateName checks a registry name: a safe TOML/JSON key, not a bridge name.
func ValidateName(name string) error {
	if slices.Contains(reservedRegistryNames, name) {
		return fmt.Errorf("%q is reserved for the H0wZy/mcp bridges managed by 'hmcp install'", name)
	}
	if !registryNameRe.MatchString(name) {
		return fmt.Errorf("invalid name %q: use letters, digits, '-' and '_' (max 64, starting with a letter or digit)", name)
	}
	return nil
}

// ValidateEntry checks an entry before it is saved or applied.
func ValidateEntry(e *RegistryEntry) error {
	switch {
	case e.URL != "" && e.Command != "":
		return errors.New("give either a URL or a command, not both")
	case e.URL == "" && e.Command == "":
		return errors.New("give a URL (--url) or a command (after --)")
	}
	if e.URL != "" {
		u, err := url.Parse(e.URL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return fmt.Errorf("invalid URL %q: expected http(s)://<host>[:<port>]/<path>", e.URL)
		}
		if u.User != nil {
			return errors.New("the URL contains credentials; the registry never stores secrets")
		}
		if len(e.Args) > 0 {
			return errors.New("arguments only apply to a command")
		}
		if len(e.Env) > 0 {
			return errors.New("env names only apply to a command: a URL server does not get the client's environment")
		}
	}
	for _, name := range e.Env {
		if strings.Contains(name, "=") {
			return fmt.Errorf("--env takes names only, never values: %q", strings.SplitN(name, "=", 2)[0]+"=…")
		}
		if !envNameRe.MatchString(name) {
			return fmt.Errorf("invalid env var name %q", name)
		}
	}
	for _, c := range e.Clients {
		if !slices.Contains(RegistryClients, c) {
			return fmt.Errorf("unknown client %q: use claude, codex or antigravity", c)
		}
	}
	return nil
}

// WantedClients are the clients the entry goes to: its list, or all of them.
func (e *RegistryEntry) WantedClients() []string {
	if len(e.Clients) == 0 {
		return RegistryClients
	}
	return e.Clients
}

// Target is the URL or the command line, for display.
func (e *RegistryEntry) Target() string {
	if e.URL != "" {
		return e.URL
	}
	return strings.Join(append([]string{e.Command}, e.Args...), " ")
}

// RegistryWarnings lists problems that don't block anything (FR-011, research D1).
func RegistryWarnings(reg *Registry, path string) []string {
	var warnings []string
	endpoints := map[string]string{}
	for _, name := range reg.SortedNames() {
		u, err := url.Parse(reg.Servers[name].URL)
		if reg.Servers[name].URL == "" || err != nil {
			continue
		}
		if !mcpPathRe.MatchString(u.Path) {
			warnings = append(warnings, fmt.Sprintf("%s: the URL path %q does not follow the /<tool>/mcp convention", name, u.Path))
		}
		if u.RawQuery != "" {
			warnings = append(warnings, fmt.Sprintf("%s: the URL has a query string; make sure it carries no token", name))
		}
		key := u.Scheme + "://" + strings.ToLower(u.Host) + strings.TrimSuffix(u.Path, "/")
		if other, ok := endpoints[key]; ok {
			warnings = append(warnings, fmt.Sprintf("%s and %s use the same host and path; only one of them can answer there", other, name))
		} else {
			endpoints[key] = name
		}
	}
	if root := gitWorkTree(path); root != "" {
		warnings = append(warnings, fmt.Sprintf("the registry %s is inside the git work tree %s; keep it out of public repositories", path, root))
	}
	return warnings
}

// gitWorkTree returns the closest folder above path that holds a .git entry.
func gitWorkTree(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		return ""
	}
	for dir := filepath.Dir(abs); ; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			return dir
		}
		if filepath.Dir(dir) == dir {
			return ""
		}
	}
}
