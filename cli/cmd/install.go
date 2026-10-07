package cmd

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/H0wZy/mcp/cli/config"
	"github.com/H0wZy/mcp/cli/detector"
	"github.com/mattn/go-isatty"
	"github.com/spf13/cobra"
)

var (
	installAll         bool
	installScope       string
	installAllowCycles bool
)

// stdinIsTerminal reports whether hmcp can ask the user a question.
var stdinIsTerminal = func() bool {
	fd := os.Stdin.Fd()
	return isatty.IsTerminal(fd) || isatty.IsCygwinTerminal(fd)
}

var installCmd = &cobra.Command{
	Use:   "install [bridge-name]",
	Short: "Install and register MCP bridges into host agent configs",
	Long: `Install bridges between AI developer CLIs. A bridge "host-target" lets the
host agent call the target agent. Supported bridge names:
  claude-antigravity  (Claude Code → Google Antigravity)
  claude-codex        (Claude Code → OpenAI Codex)
  codex-antigravity   (OpenAI Codex → Google Antigravity)
  codex-claude        (OpenAI Codex → Claude Code)
  antigravity-codex   (Google Antigravity → OpenAI Codex)
  antigravity-claude  (Google Antigravity → Claude Code)

Bridges in both directions form cycles (claude → codex → claude). The loop guard
limits every chain (depth 2, 8 calls, no revisits by default). With --all, hmcp asks
before installing bridges that form cycles; without a terminal it skips them unless
--allow-cycles is given.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		out := cmd.OutOrStdout()
		if installAll {
			return runInstallAll(out, cmd.InOrStdin(), detectedAgents(), installScope, installAllowCycles, stdinIsTerminal())
		}
		if len(args) == 0 {
			return fmt.Errorf("please specify a bridge name or use --all (run 'hmcp' for interactive mode)")
		}
		return runInstallOne(out, args[0], installScope)
	},
}

func init() {
	installCmd.Flags().BoolVar(&installAll, "all", false, "Install all bridges supported by detected local CLIs")
	installCmd.Flags().StringVarP(&installScope, "scope", "s", "user", "Scope to install into ('user' or 'project')")
	installCmd.Flags().BoolVar(&installAllowCycles, "allow-cycles", false, "With --all, also install bridges that form cycles without asking")
	rootCmd.AddCommand(installCmd)
}

// detectedAgents maps agent names (claude, codex, antigravity) to whether the CLI is installed.
func detectedAgents() map[string]bool {
	agents := make(map[string]bool)
	for _, t := range detector.DetectTools() {
		agents[agentForTool(t.Name)] = t.Installed
	}
	return agents
}

// agentForTool maps a detector binary name to its agent name.
func agentForTool(tool string) string {
	if tool == "agy" {
		return config.AgentAntigravity
	}
	return tool
}

// supportedBridges returns, in install order, the directions whose host and target are both installed.
func supportedBridges(agents map[string]bool) []config.Bridge {
	var supported []config.Bridge
	for _, b := range config.Bridges {
		if agents[b.Host] && agents[b.Target] {
			supported = append(supported, b)
		}
	}
	return supported
}

// planInstall decides which supported directions `install --all` writes.
//
// With allowCycles every supported direction is installed. Otherwise the
// directions are taken in their fixed order (claude-*, codex-*, antigravity-*)
// and a direction that would close a cycle in the graph of the installed
// bridges plus the ones planned so far is skipped. A direction that is already
// installed is always rewritten: it doesn't change the graph, and the rewrite
// brings its entry up to date (--host, Codex env_vars and timeouts).
func planInstall(supported []config.Bridge, installed []config.BridgeEdge, allowCycles bool) (install, skipped []string) {
	graph := append([]config.BridgeEdge(nil), installed...)
	isInstalled := func(b config.Bridge) bool {
		for _, e := range installed {
			if e.Host == b.Host && e.Target == b.Target {
				return true
			}
		}
		return false
	}
	for _, b := range supported {
		closesCycle := b.Host == b.Target || config.HasPath(graph, b.Target, b.Host)
		if !allowCycles && !isInstalled(b) && closesCycle {
			skipped = append(skipped, b.Name)
			continue
		}
		install = append(install, b.Name)
		graph = append(graph, config.BridgeEdge{Host: b.Host, Target: b.Target})
	}
	return install, skipped
}

func bridgeEdges(bridges []config.Bridge) []config.BridgeEdge {
	edges := make([]config.BridgeEdge, len(bridges))
	for i, b := range bridges {
		edges[i] = config.BridgeEdge{Host: b.Host, Target: b.Target, Name: b.Target}
	}
	return edges
}

// runInstallAll implements `install --all`.
func runInstallAll(out io.Writer, in io.Reader, agents map[string]bool, scope string, allowCycles, interactive bool) error {
	supported := supportedBridges(agents)
	if len(supported) == 0 {
		fmt.Fprintln(out, warnStyle.Render("⚠️  No supported bridges detected to install."))
		return nil
	}

	installed, readErr := config.InstalledBridges()
	if readErr != nil {
		fmt.Fprintln(out, warnStyle.Render("⚠️  Some host configs could not be read; the cycle check only sees the others:"))
		for _, line := range strings.Split(readErr.Error(), "\n") {
			fmt.Fprintf(out, "   %s\n", dimStyle.Render(line))
		}
	}

	all := make([]string, len(supported))
	for i, b := range supported {
		all[i] = b.Name
	}
	toInstall := all
	var skipped []string

	cycles := config.Cycles(append(append([]config.BridgeEdge(nil), installed...), bridgeEdges(supported)...))
	if len(cycles) > 0 {
		printCycles(out, "🔁 With these bridges your agents can call each other in cycles:", cycles)
		fmt.Fprintf(out, "%s\n\n", dimStyle.Render("🛡  Loop guard defaults: "+defaultGuardSummary()))

		planned, refused := planInstall(supported, installed, allowCycles)
		if len(refused) > 0 {
			allow := allowCycles
			if interactive {
				allow = confirm(in, out, config.CycleConfirmPrompt())
				fmt.Fprintln(out)
			}
			if !allow {
				toInstall, skipped = planned, refused
			}
		}
	}

	for _, name := range toInstall {
		if err := config.InstallBridge(name, scope); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		printConnected(out, name, scope)
	}

	if len(skipped) > 0 {
		fmt.Fprintln(out)
		fmt.Fprintln(out, warnStyle.Render("⏭  Skipped because they would close a cycle:"))
		for _, name := range skipped {
			fmt.Fprintf(out, "  • %s\n", agentStyle.Render(name))
		}
		fmt.Fprintln(out, dimStyle.Render("   Install them with 'hmcp install --all --allow-cycles' or 'hmcp install <bridge>'."))
	}

	fmt.Fprintln(out)
	fmt.Fprintln(out, successStyle.Render("✅ Configuration complete!"))
	fmt.Fprintln(out, dimStyle.Render("💡 Restart your host agent CLI to activate the newly connected tools."))
	return nil
}

// runInstallOne installs a single named bridge and says which cycles it closes.
func runInstallOne(out io.Writer, name, scope string) error {
	b, ok := config.LookupBridge(name)
	if !ok {
		return fmt.Errorf("unknown bridge: %s (valid: %s)", name, strings.Join(config.BridgeNames(), ", "))
	}
	if err := config.InstallBridge(name, scope); err != nil {
		return err
	}
	printConnected(out, name, scope)

	if installed, err := config.InstalledBridges(); err == nil {
		var closed [][]string
		for _, c := range config.Cycles(installed) {
			if cycleUsesEdge(c, b.Host, b.Target) {
				closed = append(closed, c)
			}
		}
		if len(closed) > 0 {
			fmt.Fprintln(out)
			printCycles(out, "🔁 This bridge closes cycles between your agents:", closed)
			fmt.Fprintln(out, dimStyle.Render("🛡  The loop guard limits them ("+defaultGuardSummary()+"). Run 'hmcp doctor' to review."))
		}
	}

	fmt.Fprintln(out)
	fmt.Fprintln(out, successStyle.Render("✅ Configuration complete!"))
	fmt.Fprintln(out, dimStyle.Render("💡 Restart your host agent CLI to activate the newly connected tools."))
	return nil
}

func cycleUsesEdge(cycle []string, host, target string) bool {
	for i, n := range cycle {
		if n == host && cycle[(i+1)%len(cycle)] == target {
			return true
		}
	}
	return false
}

func printCycles(out io.Writer, title string, cycles [][]string) {
	fmt.Fprintln(out, headingStyle.Render(title))
	for _, c := range cycles {
		fmt.Fprintf(out, "  %s\n", config.FormatCycle(c))
	}
}

func printConnected(out io.Writer, name, scope string) {
	b, _ := config.LookupBridge(name)
	suffix := ""
	switch b.Host {
	case config.AgentClaude:
		suffix = " " + dimStyle.Render("("+scope+" scope)")
	case config.AgentCodex:
		suffix = " " + dimStyle.Render("(env_vars and timeouts set)")
	}
	fmt.Fprintf(out, "  %s Connected: %s %s %s%s\n",
		successStyle.Render("✓"),
		agentStyle.Render(config.AgentDisplayName(b.Host)),
		arrowStyle.Render("→"),
		agentStyle.Render(config.AgentDisplayName(b.Target)),
		suffix,
	)
}

func defaultGuardSummary() string {
	return config.LoadGuardPolicy(func(string) string { return "" }).Summary()
}

// confirm asks a yes/no question; anything but y/yes is no.
func confirm(in io.Reader, out io.Writer, question string) bool {
	fmt.Fprint(out, question+" ")
	line, _ := bufio.NewReader(in).ReadString('\n')
	answer := strings.ToLower(strings.TrimSpace(line))
	return answer == "y" || answer == "yes"
}
