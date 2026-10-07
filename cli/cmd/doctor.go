package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/H0wZy/mcp/cli/config"
	"github.com/H0wZy/mcp/cli/detector"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
)

var doctorJsonFlag bool

var doctorCmd = &cobra.Command{
	Use:   "doctor",
	Short: "Diagnose local CLI installations, paths, and communication health",
	RunE: func(cmd *cobra.Command, args []string) error {
		tools := detector.DetectTools()
		var results []detector.HealthCheckResult

		for _, t := range tools {
			res := detector.CheckHealth(t)
			results = append(results, res)
		}

		graph := inspectBridges(os.Getenv)
		detected := make(map[string]bool)
		for _, t := range tools {
			detected[agentForTool(t.Name)] = t.Installed
		}
		team := config.TeamStatus(doctorTeamHosts(detected, graph.Bridges), graph.Bridges)

		if doctorJsonFlag {
			report := doctorReport{
				Tools:    results,
				Bridges:  graph.Bridges,
				Cycles:   graph.closedCycles(),
				Guard:    graph.Guard,
				Team:     team,
				Warnings: graph.Warnings,
			}
			data, err := json.MarshalIndent(report, "", "  ")
			if err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), string(data))
			return nil
		}

		titleStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#C084FC"))
		dividerStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#7E22CE"))
		checkStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#04B575"))
		crossStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#EF4444"))
		nameStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FFFFFF"))
		pathStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#737373"))
		branchStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#525252"))
		labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#888888"))
		latencyStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#A855F7"))
		okStatusStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#04B575"))
		failStatusStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#EF4444"))
		successBannerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#04B575"))

		fmt.Println(titleStyle.Render("🏥 H0wZy/mcp Environment Diagnostics"))
		fmt.Println(dividerStyle.Render(strings.Repeat("─", 45)))

		allOk := true
		for _, r := range results {
			if r.Healthy {
				latencyStr := fmt.Sprintf("%.1fms", float64(r.Latency.Microseconds())/1000.0)
				if r.Latency >= time.Second {
					latencyStr = fmt.Sprintf("%.2fs", r.Latency.Seconds())
				}

				fmt.Printf("%s %-22s %s %s\n",
					checkStyle.Render("✓"),
					nameStyle.Render(r.DisplayName),
					pathStyle.Render(":"),
					pathStyle.Render(r.Path),
				)
				fmt.Printf("  %s %s %s %s %s %s\n",
					branchStyle.Render("└─"),
					labelStyle.Render("Latency:"),
					latencyStyle.Render(latencyStr),
					branchStyle.Render("|"),
					labelStyle.Render("Status:"),
					okStatusStyle.Render(r.Message),
				)
			} else {
				allOk = false
				fmt.Printf("%s %-22s %s %s\n",
					crossStyle.Render("✗"),
					nameStyle.Render(r.DisplayName),
					pathStyle.Render(":"),
					failStatusStyle.Render("Not Found / Unreachable"),
				)
				fmt.Printf("  %s %s\n",
					branchStyle.Render("└─"),
					failStatusStyle.Render(r.Message),
				)
			}
		}

		fmt.Println()
		if allOk {
			fmt.Println(successBannerStyle.Render("✅ All detected CLIs are healthy and ready for multi-agent bridges!"))
		} else {
			fmt.Println(warnStyle.Render("⚠️  Some CLIs are missing or unreachable. Check paths above."))
		}

		fmt.Println()
		renderBridgeGraph(cmd.OutOrStdout(), graph)
		renderTeam(cmd.OutOrStdout(), team)
		return nil
	},
}

// doctorReport is the `doctor --json` output.
type doctorReport struct {
	Tools    []detector.HealthCheckResult `json:"tools"`
	Bridges  []config.BridgeEdge          `json:"bridges"`
	Cycles   [][]string                   `json:"cycles"`
	Guard    config.GuardPolicy           `json:"guard"`
	Team     []config.TeamHostStatus      `json:"team"`
	Warnings []string                     `json:"warnings,omitempty"`
}

// doctorTeamHosts lists, in install order, the hosts doctor reports the team
// for: every detected CLI, plus any host that has a team server registered.
func doctorTeamHosts(detected map[string]bool, edges []config.BridgeEdge) []string {
	var hosts []string
	for _, h := range config.TeamHosts {
		include := detected[h]
		for _, e := range edges {
			if e.Host == h && e.Target == config.AgentTeam {
				include = true
			}
		}
		if include {
			hosts = append(hosts, h)
		}
	}
	return hosts
}

func renderTeam(out io.Writer, team []config.TeamHostStatus) {
	fmt.Fprintln(out, headingStyle.Render("👥 Agent team"))
	if len(team) == 0 {
		fmt.Fprintf(out, "  %s\n", dimStyle.Render("no supported CLI detected"))
		return
	}
	for _, s := range team {
		server := successStyle.Render("server ✓")
		if !s.Server {
			server = warnStyle.Render("server ✗ (run hmcp install team)")
		}
		var lines []string
		present := false
		for _, c := range s.Skills {
			if c.State != config.SkillMissing {
				present = true
			}
		}
		if !present {
			lines = []string{warnStyle.Render("skill ✗ missing (run hmcp install team)")}
		} else {
			for _, c := range s.Skills {
				lines = append(lines, skillCopyLine(c))
			}
		}
		prefix := fmt.Sprintf("  %s: ", s.Host)
		fmt.Fprintf(out, "%s%s · %s\n", prefix, server, lines[0])
		for _, l := range lines[1:] {
			fmt.Fprintf(out, "%s%s\n", strings.Repeat(" ", len(prefix)), l)
		}
	}
}

func skillCopyLine(c config.SkillCopy) string {
	dir := displayPath(filepath.Dir(c.Path))
	switch c.State {
	case config.SkillCurrent:
		return successStyle.Render("skill ✓") + " " + dir + dimStyle.Render(" (current)")
	case config.SkillOutdated:
		return warnStyle.Render("skill ⚠ outdated") + " " + dir
	case config.SkillForeign:
		return warnStyle.Render("skill ⚠ foreign") + " " + dir + dimStyle.Render(" (not installed by hmcp, left alone)")
	case config.SkillMissing:
		return warnStyle.Render("skill ✗ missing") + " " + dir + dimStyle.Render(" (run hmcp install team)")
	}
	return warnStyle.Render("skill ⚠ "+c.State) + " " + dir
}

// displayPath shortens a path under the home directory to ~/… with forward slashes.
func displayPath(p string) string {
	if home, err := os.UserHomeDir(); err == nil {
		if rel, err := filepath.Rel(home, p); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return "~/" + filepath.ToSlash(rel)
		}
	}
	return filepath.ToSlash(p)
}

// bridgeGraph is what doctor knows about the installed bridges.
type bridgeGraph struct {
	Bridges  []config.BridgeEdge
	Cycles   [][]string
	Guard    config.GuardPolicy
	Warnings []string
}

// inspectBridges reads the installed bridges, their cycles and the loop-guard
// limits for bridges started from this environment. Unreadable configs become
// warnings, never failures.
func inspectBridges(getenv func(string) string) bridgeGraph {
	edges, err := config.InstalledBridges()
	g := bridgeGraph{
		Bridges: edges,
		Cycles:  config.Cycles(edges),
		Guard:   config.LoadGuardPolicy(getenv),
	}
	if g.Bridges == nil {
		g.Bridges = []config.BridgeEdge{}
	}
	if err != nil {
		g.Warnings = strings.Split(err.Error(), "\n")
	}
	return g
}

// closedCycles returns the cycles in the printed form, start agent repeated at
// the end: ["claude", "codex", "claude"].
func (g bridgeGraph) closedCycles() [][]string {
	out := make([][]string, 0, len(g.Cycles))
	for _, c := range g.Cycles {
		out = append(out, append(append([]string(nil), c...), c[0]))
	}
	return out
}

func renderBridgeGraph(out io.Writer, g bridgeGraph) {
	fmt.Fprintln(out, headingStyle.Render("🔗 Bridges (host → target)"))
	if len(g.Bridges) == 0 {
		fmt.Fprintf(out, "  %s\n", dimStyle.Render("none installed (run 'hmcp install --all' or 'hmcp list')"))
	}
	for _, e := range g.Bridges {
		pair := fmt.Sprintf("%s → %s", e.Host, e.Target)
		if e.Name != e.Target {
			pair += fmt.Sprintf(" [%s]", e.Name)
		}
		fmt.Fprintf(out, "  %-24s %s\n", pair, bridgeNote(e))
	}
	for _, w := range g.Warnings {
		fmt.Fprintf(out, "  %s\n", warnStyle.Render("⚠ "+w))
	}

	fmt.Fprintln(out, headingStyle.Render("🔁 Cycles"))
	if len(g.Cycles) == 0 {
		fmt.Fprintf(out, "  %s\n", dimStyle.Render("none"))
	}
	for _, c := range g.Cycles {
		fmt.Fprintf(out, "  %s\n", config.FormatCycle(c))
	}

	fmt.Fprintf(out, "%s %s\n", headingStyle.Render("🛡  Loop guard:"), g.Guard.Summary())
	if len(g.Guard.Overrides) > 0 {
		fmt.Fprintf(out, "  %s\n", dimStyle.Render("set in this shell (bridges use their host's environment):"))
	}
	for _, o := range g.Guard.Overrides {
		line := "  └─ " + o.Describe()
		if o.Clamped || o.Invalid {
			fmt.Fprintln(out, warnStyle.Render(line))
		} else {
			fmt.Fprintln(out, dimStyle.Render(line))
		}
	}
}

func bridgeNote(e config.BridgeEdge) string {
	switch {
	case e.Host == config.AgentCodex && !e.GuardReady:
		note := "⚠ env_vars missing: chain context only via the ancestry fallback"
		if b, ok := config.LookupBridge(e.Host + "-" + e.Target); ok {
			note += " (fix: hmcp install " + b.Name + ")"
		} else if e.Target == config.AgentTeam {
			note += " (fix: hmcp install team)"
		}
		return warnStyle.Render(note)
	case e.Host == config.AgentClaude:
		return dimStyle.Render(e.Scope + " scope")
	case e.Host == config.AgentCodex:
		return dimStyle.Render("env_vars forwarded")
	}
	return dimStyle.Render("user config")
}

func init() {
	doctorCmd.Flags().BoolVar(&doctorJsonFlag, "json", false, "Output report as JSON")
	rootCmd.AddCommand(doctorCmd)
}
