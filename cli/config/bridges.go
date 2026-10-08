package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
)

// BridgeEdge is an installed "host → target" bridge found in a host config.
type BridgeEdge struct {
	Host   string `json:"host"`   // claude | codex | antigravity: owner of the config file
	Target string `json:"target"` // claude | codex | antigravity | team: from the launch args
	Name   string `json:"name"`   // server key in the host config
	Scope  string `json:"scope"`  // user | project | local (Claude); user for the other hosts
	// GuardReady is false when the host can't pass the chain context to the
	// bridge: a Codex entry whose env_vars allow-list lacks H0WZY_MCP_CHAIN.
	GuardReady bool   `json:"guardReady"`
	Path       string `json:"path"` // config file the entry was read from
}

// bridgeTargets are the agents a bridge server can start.
var bridgeTargets = []string{AgentClaude, AgentCodex, AgentAntigravity, AgentTeam}

// BridgeTarget reports which agent a launch command starts, or "" when it is
// not one of our bridge servers. A bridge is recognized by an argument (or the
// command) containing `@h0wzy/mcp-server-<target>` or `servers/<target>/bin/cli.js`.
func BridgeTarget(command string, args []string) string {
	for _, raw := range append([]string{command}, args...) {
		a := strings.ToLower(strings.ReplaceAll(raw, `\`, "/"))
		for _, t := range bridgeTargets {
			if strings.Contains(a, "servers/"+t+"/bin/cli.js") || containsPackage(a, "@h0wzy/mcp-server-"+t) {
				return t
			}
		}
	}
	return ""
}

// containsPackage reports whether s contains pkg as a whole package name, so
// "@h0wzy/mcp-server-team" does not match "@h0wzy/mcp-server-teamwork". A version
// suffix ("@1.0.6") or a path continuation is fine.
func containsPackage(s, pkg string) bool {
	for from := 0; ; {
		i := strings.Index(s[from:], pkg)
		if i < 0 {
			return false
		}
		end := from + i + len(pkg)
		if end == len(s) {
			return true
		}
		c := s[end]
		if !(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '-' && c != '_' && c != '.' {
			return true
		}
		from = end
	}
}

// InstalledBridges reads the bridges installed in every host config:
// ~/.claude.json (user scope, plus the local scope of the current directory),
// ./.mcp.json (project scope), ~/.codex/config.toml and
// ~/.gemini/config/mcp_config.json. Missing files are skipped. A file that can't
// be read or parsed is reported in the returned error while the edges found in
// the other files are still returned, so callers can show both.
func InstalledBridges() ([]BridgeEdge, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	var edges []BridgeEdge
	var problems []error

	// Claude Code, user and local scope.
	claudeUser := filepath.Join(home, ".claude.json")
	if data, err := readJSONObject(claudeUser); err != nil {
		problems = append(problems, readProblem(claudeUser, err))
	} else {
		edges = append(edges, jsonBridgeEdges(AgentClaude, "user", claudeUser, data["mcpServers"])...)
		if cwd, err := os.Getwd(); err == nil {
			if servers := claudeLocalServers(data, claudeProjectDir(cwd)); servers != nil {
				edges = append(edges, jsonBridgeEdges(AgentClaude, "local", claudeUser, servers)...)
			}
		}
	}

	// Claude Code, project scope.
	if cwd, err := os.Getwd(); err == nil {
		project := filepath.Join(cwd, ".mcp.json")
		if data, err := readJSONObject(project); err != nil {
			problems = append(problems, readProblem(project, err))
		} else {
			edges = append(edges, jsonBridgeEdges(AgentClaude, "project", project, data["mcpServers"])...)
		}
	}

	// Codex.
	codexPath := filepath.Join(home, ".codex", "config.toml")
	if b, err := os.ReadFile(codexPath); err == nil {
		found, err := codexBridgeEdges(string(b), codexPath)
		if err != nil {
			problems = append(problems, readProblem(codexPath, err))
		}
		edges = append(edges, found...)
	} else if !os.IsNotExist(err) {
		problems = append(problems, readProblem(codexPath, err))
	}

	// Antigravity.
	agyPath := filepath.Join(home, ".gemini", "config", "mcp_config.json")
	if data, err := readJSONObject(agyPath); err != nil {
		problems = append(problems, readProblem(agyPath, err))
	} else {
		edges = append(edges, jsonBridgeEdges(AgentAntigravity, "user", agyPath, data["mcpServers"])...)
	}

	return edges, errors.Join(problems...)
}

func readProblem(path string, err error) error {
	var invalid *invalidJSONError
	if errors.As(err, &invalid) {
		return fmt.Errorf("%s is not valid JSON (%v); bridges in it are not shown", path, invalid.err)
	}
	if strings.Contains(err.Error(), path) {
		return err
	}
	return fmt.Errorf("%s: %w", path, err)
}

// claudeLocalServers returns projects[<cwd>].mcpServers from ~/.claude.json,
// where `claude mcp add` stores local-scope servers.
func claudeLocalServers(data map[string]interface{}, cwd string) interface{} {
	projects, ok := data["projects"].(map[string]interface{})
	if !ok {
		return nil
	}
	want := projectPathKeys(cwd)
	for key, value := range projects {
		if !want[normalizeProjectPath(key)] && !anyKey(projectPathKeys(key), want) {
			continue
		}
		if project, ok := value.(map[string]interface{}); ok {
			return project["mcpServers"]
		}
	}
	return nil
}

// claudeProjectDir is the folder Claude Code keys local scope by: the git root
// above cwd, or cwd itself outside a repository (`claude mcp add -s local` run
// in <repo>/sub writes <repo>; checked with Claude Code 2.1.293).
func claudeProjectDir(cwd string) string {
	for dir := filepath.Clean(cwd); ; {
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return cwd
		}
		dir = parent
	}
}

// projectPathKeys is the path as written and as the OS resolves it (symlinks,
// /private/var on macOS, 8.3 names on Windows), so either spelling finds the project.
func projectPathKeys(p string) map[string]bool {
	keys := map[string]bool{normalizeProjectPath(p): true}
	if real, err := filepath.EvalSymlinks(p); err == nil {
		keys[normalizeProjectPath(real)] = true
	}
	return keys
}

func anyKey(keys, want map[string]bool) bool {
	for k := range keys {
		if want[k] {
			return true
		}
	}
	return false
}

func normalizeProjectPath(p string) string {
	p = filepath.ToSlash(filepath.Clean(p))
	if runtime.GOOS == "windows" {
		p = strings.ToLower(p)
	}
	return p
}

// jsonBridgeEdges extracts bridge entries from an "mcpServers" JSON object.
func jsonBridgeEdges(host, scope, path string, servers interface{}) []BridgeEdge {
	m, ok := servers.(map[string]interface{})
	if !ok {
		return nil
	}
	var edges []BridgeEdge
	for _, name := range sortedKeys(m) {
		entry, ok := m[name].(map[string]interface{})
		if !ok {
			continue
		}
		command, _ := entry["command"].(string)
		var args []string
		if list, ok := entry["args"].([]interface{}); ok {
			for _, a := range list {
				if s, ok := a.(string); ok {
					args = append(args, s)
				}
			}
		}
		if target := BridgeTarget(command, args); target != "" {
			edges = append(edges, BridgeEdge{Host: host, Target: target, Name: name, Scope: scope, GuardReady: true, Path: path})
		}
	}
	return edges
}

func sortedKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// codexServer collects the keys of one [mcp_servers.<name>] section.
type codexServer struct {
	name       string
	command    string
	args       []string
	envVars    []string
	hasEnvVars bool
}

// codexBridgeEdges finds bridges in a Codex config.toml. Go's RE2 regexp can't
// express TOML, so the file is read line by line: each [mcp_servers.<name>]
// section contributes its command, args and env_vars. Sub-tables such as
// [mcp_servers.<name>.env] are their own sections and are ignored. Servers
// written as inline tables are not recognized (hmcp never writes them).
func codexBridgeEdges(content, path string) ([]BridgeEdge, error) {
	var servers []*codexServer
	var current *codexServer
	var problems []error

	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	for i := 0; i < len(lines); i++ {
		if table, ok := tomlHeader(lines[i]); ok {
			current = nil
			if keys := splitTOMLKey(table); len(keys) == 2 && keys[0] == "mcp_servers" {
				current = &codexServer{name: keys[1]}
				servers = append(servers, current)
			}
			continue
		}
		if current == nil {
			continue
		}
		key, value, ok := splitTOMLKeyValue(lines[i])
		if !ok {
			continue
		}
		switch key {
		case "command":
			if s, _, err := parseTOMLString(value); err == nil {
				current.command = s
			}
		case "args", "env_vars":
			// Arrays may span several lines: keep adding lines until it closes.
			start := i
			list, err := parseTOMLStringArray(value)
			for errors.Is(err, errIncomplete) && i+1 < len(lines) {
				i++
				value += "\n" + lines[i]
				list, err = parseTOMLStringArray(value)
			}
			if err != nil {
				problems = append(problems, fmt.Errorf("line %d: [mcp_servers.%s] %s: %w", start+1, current.name, key, err))
				continue
			}
			if key == "args" {
				current.args = list
			} else {
				current.envVars = list
				current.hasEnvVars = true
			}
		}
	}

	var edges []BridgeEdge
	for _, s := range servers {
		target := BridgeTarget(s.command, s.args)
		if target == "" {
			continue
		}
		ready := false
		for _, v := range s.envVars {
			if v == "H0WZY_MCP_CHAIN" {
				ready = true
			}
		}
		edges = append(edges, BridgeEdge{Host: AgentCodex, Target: target, Name: s.name, Scope: "user", GuardReady: ready, Path: path})
	}
	return edges, errors.Join(problems...)
}

// splitTOMLKey splits a dotted TOML key ("mcp_servers.\"my.server\"") into its
// parts, honoring quotes.
func splitTOMLKey(key string) []string {
	var parts []string
	var cur strings.Builder
	quote := byte(0)
	for i := 0; i < len(key); i++ {
		c := key[i]
		switch {
		case quote != 0:
			if c == quote {
				quote = 0
			} else {
				cur.WriteByte(c)
			}
		case c == '"' || c == '\'':
			quote = c
		case c == '.':
			parts = append(parts, strings.TrimSpace(cur.String()))
			cur.Reset()
		case c == ' ' || c == '\t':
			// whitespace around dots is allowed in TOML keys
		default:
			cur.WriteByte(c)
		}
	}
	return append(parts, strings.TrimSpace(cur.String()))
}

// splitTOMLKeyValue splits `key = value` and unquotes a quoted key.
func splitTOMLKeyValue(line string) (key, value string, ok bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return "", "", false
	}
	eq := strings.Index(trimmed, "=")
	if eq <= 0 {
		return "", "", false
	}
	key = strings.TrimSpace(trimmed[:eq])
	if len(key) >= 2 && (key[0] == '"' || key[0] == '\'') && key[len(key)-1] == key[0] {
		key = key[1 : len(key)-1]
	}
	return key, strings.TrimSpace(trimmed[eq+1:]), true
}

var errIncomplete = errors.New("unterminated value")

// parseTOMLString reads one basic ("…") or literal ('…') string at the start of s
// and returns it with the rest of s.
func parseTOMLString(s string) (string, string, error) {
	if s == "" {
		return "", "", errIncomplete
	}
	switch s[0] {
	case '\'':
		if strings.HasPrefix(s, "'''") {
			return "", "", errors.New("multi-line strings are not supported here")
		}
		end := strings.IndexAny(s[1:], "'\n")
		if end < 0 || s[1+end] != '\'' {
			return "", "", errIncomplete
		}
		return s[1 : 1+end], s[end+2:], nil
	case '"':
		if strings.HasPrefix(s, `"""`) {
			return "", "", errors.New("multi-line strings are not supported here")
		}
		for i := 1; i < len(s); i++ {
			switch s[i] {
			case '\\':
				i++
			case '\n':
				return "", "", errIncomplete
			case '"':
				raw := s[:i+1]
				unquoted, err := strconv.Unquote(raw)
				if err != nil {
					unquoted = raw[1 : len(raw)-1]
				}
				return unquoted, s[i+1:], nil
			}
		}
		return "", "", errIncomplete
	}
	return "", "", fmt.Errorf("expected a string, found %q", firstToken(s))
}

// parseTOMLStringArray parses a TOML array of strings that may span lines and
// contain comments. It returns errIncomplete when the closing bracket is missing.
func parseTOMLStringArray(s string) ([]string, error) {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "[") {
		return nil, fmt.Errorf("expected an array, found %q", firstToken(s))
	}
	rest := s[1:]
	values := []string{}
	expectValue := true
	for {
		rest = skipTOMLSpaceAndComments(rest)
		if rest == "" {
			return nil, errIncomplete
		}
		switch {
		case rest[0] == ']':
			return values, nil
		case rest[0] == ',':
			if expectValue {
				return nil, errors.New("unexpected comma")
			}
			expectValue = true
			rest = rest[1:]
		case expectValue:
			v, after, err := parseTOMLString(rest)
			if err != nil {
				return nil, err
			}
			values = append(values, v)
			rest = after
			expectValue = false
		default:
			return nil, fmt.Errorf("expected a comma, found %q", firstToken(rest))
		}
	}
}

func skipTOMLSpaceAndComments(s string) string {
	for {
		s = strings.TrimLeft(s, " \t\r\n")
		if !strings.HasPrefix(s, "#") {
			return s
		}
		if nl := strings.Index(s, "\n"); nl >= 0 {
			s = s[nl+1:]
		} else {
			return ""
		}
	}
}

func firstToken(s string) string {
	if i := strings.IndexAny(s, " \t\r\n,]"); i > 0 {
		return s[:i]
	}
	return s
}

// agentOrder fixes the node order used to rotate and sort cycles, so a cycle
// always starts at its first agent in this order (claude, codex, antigravity, team).
var agentOrder = map[string]int{AgentClaude: 0, AgentCodex: 1, AgentAntigravity: 2, AgentTeam: 3}

func lessAgent(a, b string) bool {
	ra, oka := agentOrder[a]
	rb, okb := agentOrder[b]
	switch {
	case oka && okb:
		return ra < rb
	case oka != okb:
		return oka
	}
	return a < b
}

// adjacency builds the deduplicated host → target graph and its sorted nodes.
func adjacency(edges []BridgeEdge) (map[string][]string, []string) {
	seen := make(map[[2]string]bool)
	adj := make(map[string][]string)
	nodes := make(map[string]bool)
	for _, e := range edges {
		k := [2]string{e.Host, e.Target}
		if seen[k] {
			continue
		}
		seen[k] = true
		adj[e.Host] = append(adj[e.Host], e.Target)
		nodes[e.Host], nodes[e.Target] = true, true
	}
	sorted := make([]string, 0, len(nodes))
	for n := range nodes {
		sorted = append(sorted, n)
	}
	sort.Slice(sorted, func(i, j int) bool { return lessAgent(sorted[i], sorted[j]) })
	for n := range adj {
		sort.Slice(adj[n], func(i, j int) bool { return lessAgent(adj[n][i], adj[n][j]) })
	}
	return adj, sorted
}

// Cycles returns every simple directed cycle in the host → target graph, each
// once, as the list of agents in call order starting at its first agent in the
// fixed order (["claude", "codex"] means claude → codex → claude). A bridge from
// an agent to itself is a cycle of one. Cycles are sorted by length, then by agent.
func Cycles(edges []BridgeEdge) [][]string {
	adj, nodes := adjacency(edges)
	rank := make(map[string]int, len(nodes))
	for i, n := range nodes {
		rank[n] = i
	}

	var cycles [][]string
	// Each cycle is found once, from its lowest-ranked node: the DFS from start
	// only walks through nodes ranked above it.
	for _, start := range nodes {
		path := []string{start}
		onPath := map[string]bool{start: true}
		var walk func(n string)
		walk = func(n string) {
			for _, next := range adj[n] {
				switch {
				case next == start:
					cycles = append(cycles, append([]string(nil), path...))
				case !onPath[next] && rank[next] > rank[start]:
					onPath[next] = true
					path = append(path, next)
					walk(next)
					path = path[:len(path)-1]
					onPath[next] = false
				}
			}
		}
		walk(start)
	}

	sort.SliceStable(cycles, func(i, j int) bool {
		a, b := cycles[i], cycles[j]
		if len(a) != len(b) {
			return len(a) < len(b)
		}
		for k := range a {
			if a[k] != b[k] {
				return lessAgent(a[k], b[k])
			}
		}
		return false
	})
	return cycles
}

// HasPath reports whether the graph has a directed path (of at least one edge)
// from one agent to another.
func HasPath(edges []BridgeEdge, from, to string) bool {
	adj, _ := adjacency(edges)
	seen := map[string]bool{}
	stack := append([]string(nil), adj[from]...)
	for len(stack) > 0 {
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if n == to {
			return true
		}
		if seen[n] {
			continue
		}
		seen[n] = true
		stack = append(stack, adj[n]...)
	}
	return false
}

// FormatCycle renders a cycle from Cycles as "claude → codex → claude".
func FormatCycle(cycle []string) string {
	if len(cycle) == 0 {
		return ""
	}
	return strings.Join(append(append([]string(nil), cycle...), cycle[0]), " → ")
}
