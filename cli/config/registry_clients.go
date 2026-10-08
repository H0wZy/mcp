package config

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// DestinationState is where one registered server stands in one client config.
type DestinationState string

const (
	StateInSync       DestinationState = "in sync"
	StateDiffers      DestinationState = "differs"     // managed, but its target fields changed
	StateMissing      DestinationState = "missing"     // no entry with that name
	StateUnmanaged    DestinationState = "not managed" // same target, hmcp did not write it: apply adopts it
	StateConflict     DestinationState = "conflict"    // another target under the same name
	StateUnreadable   DestinationState = "unreadable"  // the config file can't be parsed or written
	StateNotInstalled DestinationState = "not installed"
)

// DestinationResult is the outcome for one destination.
type DestinationResult struct {
	Dest   Destination
	State  DestinationState
	Action string // written, adopted, removed, dropped, or empty
	Detail string // differing fields, or why a record was dropped
	Err    error
}

// Failed reports whether the destination needs the developer's attention.
func (r DestinationResult) Failed() bool {
	return r.Err != nil || r.State == StateConflict || r.State == StateUnreadable
}

// ApplyOptions tune ApplyEntry.
type ApplyOptions struct {
	Installed map[string]bool // detected clients
	Replace   bool            // overwrite a conflicting entry (FR-007)
	Projects  []string        // Codex project folders to add (FR-005)
}

// ownedFields are the parts of a client entry hmcp owns (research D4). Every
// other key the developer put in the entry is kept on writes.
type ownedFields struct {
	Command string
	Args    []string
	URL     string
	EnvVars []string
}

var jsonOwnedKeys = map[string][]string{
	AgentClaude:      {"type", "command", "args", "url"},
	AgentAntigravity: {"command", "args", "serverUrl"},
}

var codexOwnedKeys = []string{"command", "args", "url", "env_vars"}

func destinationPath(d Destination) (string, error) {
	switch {
	case d.Client == AgentCodex && d.Project != "":
		return filepath.Join(d.Project, ".codex", "config.toml"), nil
	case d.Client == AgentCodex:
		return getCodexConfigPath()
	case d.Client == AgentClaude:
		return getClaudeConfigPath("user")
	case d.Client == AgentAntigravity:
		return getAntigravityConfigPath()
	}
	return "", fmt.Errorf("unknown client %q", d.Client)
}

func renderOwned(client string, e *RegistryEntry) ownedFields {
	if e.URL != "" {
		return ownedFields{URL: e.URL}
	}
	o := ownedFields{Command: e.Command, Args: e.Args}
	if client == AgentCodex {
		o.EnvVars = e.Env
	}
	return o
}

func slashed(args []string) []string {
	out := make([]string, len(args))
	for i, a := range args {
		out[i] = filepath.ToSlash(a)
	}
	return out
}

// sameTarget is the adoption test of FR-007: same URL, or same command and args.
func sameTarget(a, b ownedFields) bool {
	if a.URL != "" || b.URL != "" {
		return strings.TrimSuffix(a.URL, "/") == strings.TrimSuffix(b.URL, "/")
	}
	return a.Command == b.Command && slices.Equal(slashed(a.Args), slashed(b.Args))
}

// ownedDiff names the owned fields that differ.
func ownedDiff(cur, want ownedFields) []string {
	var diff []string
	if cur.Command != want.Command {
		diff = append(diff, "command")
	}
	if !slices.Equal(slashed(cur.Args), slashed(want.Args)) {
		diff = append(diff, "args")
	}
	if strings.TrimSuffix(cur.URL, "/") != strings.TrimSuffix(want.URL, "/") {
		diff = append(diff, "url")
	}
	if !slices.Equal(cur.EnvVars, want.EnvVars) && (len(cur.EnvVars) > 0 || len(want.EnvVars) > 0) {
		diff = append(diff, "env_vars")
	}
	return diff
}

func jsonString(v interface{}) string {
	s, _ := v.(string)
	return s
}

func jsonStrings(v interface{}) []string {
	list, _ := v.([]interface{})
	out := make([]string, 0, len(list))
	for _, item := range list {
		out = append(out, jsonString(item))
	}
	return out
}

// readCodexForServer loads a Codex config and refuses it when hmcp could not
// edit `name` safely: an array it can't parse, or the server defined outside a
// plain [mcp_servers.<name>] section (inline table, dotted key, quoted header),
// where appending a section would make the file invalid.
func readCodexForServer(path, name string) (string, []*codexServer, error) {
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	content := string(b)
	servers, err := parseCodexServers(content)
	if err != nil {
		return "", nil, fmt.Errorf("refusing to modify %s: %w", path, err)
	}
	_, _, _, plain := splitTOMLSection(content, "mcp_servers."+name)
	if codexServerOutsideSection(content, name) || (!plain && findCodexServer(servers, name) != nil) {
		return "", nil, fmt.Errorf("refusing to modify %s: %s is not defined as a plain [mcp_servers.%s] section; edit it by hand", path, name, name)
	}
	return content, servers, nil
}

func findCodexServer(servers []*codexServer, name string) *codexServer {
	for _, s := range servers {
		if s.name == name {
			return s
		}
	}
	return nil
}

// codexServerOutsideSection finds `name` written as an inline table under
// [mcp_servers] or as a dotted key (mcp_servers.<name>.command = …).
func codexServerOutsideSection(content, name string) bool {
	var table []string
	for _, line := range strings.Split(content, "\n") {
		if h, ok := tomlHeader(line); ok {
			table = splitTOMLKey(h)
			continue
		}
		key, _, ok := splitTOMLKeyValue(line)
		if !ok || len(table) >= 2 {
			continue
		}
		parts := append(slices.Clone(table), splitTOMLKey(key)...)
		if len(parts) >= 2 && parts[0] == "mcp_servers" && parts[1] == name {
			return true
		}
	}
	return false
}

// readDestination returns the owned fields of `name` in a client config.
func readDestination(d Destination, name string) (ownedFields, bool, error) {
	path, err := destinationPath(d)
	if err != nil {
		return ownedFields{}, false, err
	}
	if d.Client == AgentCodex {
		_, servers, err := readCodexForServer(path, name)
		if err != nil {
			return ownedFields{}, false, err
		}
		s := findCodexServer(servers, name)
		if s == nil {
			return ownedFields{}, false, nil
		}
		return ownedFields{Command: s.command, Args: s.args, URL: s.url, EnvVars: s.envVars}, true, nil
	}
	data, err := readJSONObject(path)
	if err != nil {
		return ownedFields{}, false, err
	}
	servers, _ := data["mcpServers"].(map[string]interface{})
	raw, exists := servers[name]
	if !exists {
		return ownedFields{}, false, nil
	}
	entry, _ := raw.(map[string]interface{})
	o := ownedFields{Command: jsonString(entry["command"]), Args: jsonStrings(entry["args"]), URL: jsonString(entry["url"])}
	if d.Client == AgentAntigravity {
		o.URL = jsonString(entry["serverUrl"])
	}
	return o, true, nil
}

// writeDestination sets the owned fields of `name` and keeps everything else.
func writeDestination(d Destination, name string, e *RegistryEntry) error {
	path, err := destinationPath(d)
	if err != nil {
		return err
	}
	o := renderOwned(d.Client, e)
	if d.Client == AgentCodex {
		content, _, err := readCodexForServer(path, name)
		if err != nil {
			return err
		}
		var block []string
		if o.URL != "" {
			block = append(block, fmt.Sprintf("url = %q", o.URL))
		} else {
			block = append(block, fmt.Sprintf("command = %q", o.Command), "args = "+tomlStringArray(o.Args))
			if len(o.EnvVars) > 0 {
				block = append(block, "env_vars = "+tomlStringArray(o.EnvVars))
			}
		}
		return writeFileAtomic(path, []byte(rewriteCodexSection(content, name, block)), 0600)
	}

	data, err := readJSONObject(path)
	if err != nil {
		return err
	}
	servers, ok := data["mcpServers"].(map[string]interface{})
	if !ok {
		servers = map[string]interface{}{}
		data["mcpServers"] = servers
	}
	entry, _ := servers[name].(map[string]interface{})
	if entry == nil {
		entry = map[string]interface{}{}
	}
	for _, k := range jsonOwnedKeys[d.Client] {
		delete(entry, k)
	}
	switch {
	case o.URL != "" && d.Client == AgentClaude:
		entry["type"], entry["url"] = "http", o.URL
	case o.URL != "":
		entry["serverUrl"] = o.URL
	default:
		if d.Client == AgentClaude {
			entry["type"] = "stdio"
		}
		entry["command"], entry["args"] = o.Command, append([]string{}, o.Args...)
	}
	servers[name] = entry
	return writeJSONObject(path, data)
}

// rewriteCodexSection replaces the owned keys of [mcp_servers.<name>] with
// block and keeps the section's other keys, comments and sub-tables.
func rewriteCodexSection(content, name string, block []string) string {
	table := "mcp_servers." + name
	before, section, after, found := splitTOMLSection(content, table)
	if !found {
		return upsertTOMLSection(content, table, "["+table+"]\n"+strings.Join(block, "\n"))
	}
	kept := append([]string{section[0]}, block...)
	for i := 1; i < len(section); i++ {
		key, value, ok := splitTOMLKeyValue(section[i])
		if !ok || !slices.Contains(codexOwnedKeys, key) {
			kept = append(kept, section[i])
			continue
		}
		// Skip the continuation lines of a multi-line array too.
		if strings.HasPrefix(value, "[") {
			_, err := parseTOMLStringArray(value)
			for errors.Is(err, errIncomplete) && i+1 < len(section) {
				i++
				value += "\n" + section[i]
				_, err = parseTOMLStringArray(value)
			}
		}
	}
	lines := append(append(append([]string{}, before...), kept...), "")
	return normalizeTOMLSpacing(strings.Join(append(lines, after...), "\n"))
}

// removeDestination deletes `name` from a client config. A missing file or
// entry is not an error.
func removeDestination(d Destination, name string) error {
	path, err := destinationPath(d)
	if err != nil {
		return err
	}
	if d.Client == AgentCodex {
		content, servers, err := readCodexForServer(path, name)
		if err != nil || findCodexServer(servers, name) == nil {
			return err
		}
		return writeFileAtomic(path, []byte(removeTOMLSection(content, "mcp_servers."+name)), 0600)
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil
	}
	data, err := readJSONObject(path)
	if err != nil {
		return err
	}
	servers, _ := data["mcpServers"].(map[string]interface{})
	if _, ok := servers[name]; !ok {
		return nil
	}
	delete(servers, name)
	return writeJSONObject(path, data)
}

func (e *RegistryEntry) isApplied(d Destination) bool {
	return slices.Contains(e.Applied, d)
}

func (e *RegistryEntry) markApplied(d Destination) {
	if !e.isApplied(d) {
		e.Applied = append(e.Applied, d)
	}
}

func (e *RegistryEntry) unapply(d Destination) {
	e.Applied = slices.DeleteFunc(e.Applied, func(x Destination) bool { return x == d })
}

// destinationState compares a client entry with the registry (research D5).
// It never writes; status and apply share it so they can't disagree.
func destinationState(e *RegistryEntry, name string, d Destination) DestinationResult {
	r := DestinationResult{Dest: d}
	cur, exists, err := readDestination(d, name)
	want := renderOwned(d.Client, e)
	switch {
	case err != nil:
		r.State, r.Err = StateUnreadable, err
	case !exists:
		r.State = StateMissing
	case !e.isApplied(d) && !sameTarget(cur, want):
		r.State = StateConflict
	default:
		r.Detail = strings.Join(ownedDiff(cur, want), ", ")
		switch {
		case !e.isApplied(d):
			r.State = StateUnmanaged
		case r.Detail != "":
			r.State = StateDiffers
		default:
			r.State = StateInSync
		}
	}
	return r
}

// wantedDestinations: the entry's clients (user scope) plus every Codex project
// on record, plus the projects asked for now.
func wantedDestinations(e *RegistryEntry, projects []string) []Destination {
	var wanted []Destination
	for _, c := range e.WantedClients() {
		wanted = append(wanted, Destination{Client: c})
	}
	for _, d := range e.Applied {
		if d.Project != "" {
			wanted = append(wanted, d)
		}
	}
	for _, p := range projects {
		if abs, err := filepath.Abs(p); err == nil {
			if d := (Destination{Client: AgentCodex, Project: filepath.Clean(abs)}); !slices.Contains(wanted, d) {
				wanted = append(wanted, d)
			}
		}
	}
	return wanted
}

// ApplyEntry writes one registered server into every wanted destination and
// records what it now manages in e.Applied. Destinations the entry no longer
// wants (clients dropped from its list) are cleaned.
func ApplyEntry(reg *Registry, name string, opts ApplyOptions) []DestinationResult {
	e := reg.Servers[name]
	wanted := wantedDestinations(e, opts.Projects)
	var results []DestinationResult
	for _, d := range wanted {
		if d.Project == "" && !opts.Installed[d.Client] {
			results = append(results, DestinationResult{Dest: d, State: StateNotInstalled})
			continue
		}
		if d.Project != "" {
			if _, err := os.Stat(d.Project); os.IsNotExist(err) {
				e.unapply(d)
				results = append(results, DestinationResult{Dest: d, State: StateMissing, Action: "dropped", Detail: "the project folder is gone"})
				continue
			}
		}
		results = append(results, applyOne(e, name, d, opts.Replace))
	}
	for _, d := range slices.Clone(e.Applied) {
		if !slices.Contains(wanted, d) {
			results = append(results, removeOne(e, name, d))
		}
	}
	return results
}

func applyOne(e *RegistryEntry, name string, d Destination, replace bool) DestinationResult {
	r := destinationState(e, name, d)
	switch {
	case r.State == StateUnreadable, r.State == StateInSync, r.State == StateConflict && !replace:
		return r
	}
	if r.State != StateUnmanaged || r.Detail != "" {
		if err := writeDestination(d, name, e); err != nil {
			r.State, r.Err = StateUnreadable, err
			return r
		}
		r.Action = "written"
	}
	if r.State == StateUnmanaged {
		r.Action = "adopted"
	}
	e.markApplied(d)
	r.State, r.Detail = StateInSync, ""
	return r
}

func removeOne(e *RegistryEntry, name string, d Destination) DestinationResult {
	if err := removeDestination(d, name); err != nil {
		return DestinationResult{Dest: d, State: StateUnreadable, Err: err}
	}
	e.unapply(d)
	return DestinationResult{Dest: d, Action: "removed"}
}

// RemoveEntry removes every client entry hmcp manages for `name`, then the
// registry entry. If any removal fails, the entry stays with the destinations
// still on record, so a re-run finishes the job (research D11).
func RemoveEntry(reg *Registry, name string) []DestinationResult {
	e := reg.Servers[name]
	var results []DestinationResult
	failed := false
	for _, d := range slices.Clone(e.Applied) {
		r := removeOne(e, name, d)
		failed = failed || r.Failed()
		results = append(results, r)
	}
	if !failed {
		delete(reg.Servers, name)
	}
	return results
}

// EntryStatus reports every destination of `name` without writing anything (FR-009).
func EntryStatus(reg *Registry, name string, installed map[string]bool) []DestinationResult {
	e := reg.Servers[name]
	wanted := wantedDestinations(e, nil)
	for _, d := range e.Applied {
		if !slices.Contains(wanted, d) {
			wanted = append(wanted, d)
		}
	}
	var results []DestinationResult
	for _, d := range wanted {
		if d.Project == "" && !installed[d.Client] {
			results = append(results, DestinationResult{Dest: d, State: StateNotInstalled})
			continue
		}
		results = append(results, destinationState(e, name, d))
	}
	return results
}

// ProbeURL reports whether anything answers HTTP at u. Any response counts,
// whatever its status: an MCP endpoint often answers GET with 405 (research D6).
func ProbeURL(u string, timeout time.Duration) bool {
	resp, err := (&http.Client{Timeout: timeout}).Get(u)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return true
}
