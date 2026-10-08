package cmd

import (
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/H0wZy/mcp/cli/config"
	"github.com/spf13/cobra"
)

var (
	regURL          string
	regClients      string
	regEnv          []string
	regNote         string
	regNoApply      bool
	regReplace      bool
	regCodexProject bool
)

var registryCmd = &cobra.Command{
	Use:     "registry",
	Aliases: []string{"reg"},
	Short:   "Register your own MCP servers once and sync them into every agent",
	Long: `Keep a private list of your own MCP servers (a name and a URL or launch command)
and write each one into Claude Code (user scope), Codex and Antigravity.

The registry lives in ~/.h0wzy-mcp/registry.json (or $H0WZY_MCP_REGISTRY), never in
a repository. add, update and remove apply the change right away (--no-apply skips
it); apply re-syncs everything; status reports drift without writing.

  hmcp registry add my-server --url http://<host>:<port>/my-server/mcp
  hmcp registry add my-server --env MY_TOKEN -- node <path>/server.js --stdio`,
}

func entryFromFlags(cmd *cobra.Command, args []string) *config.RegistryEntry {
	e := &config.RegistryEntry{URL: regURL, Clients: splitList(regClients), Env: splitList(strings.Join(regEnv, ",")), Note: regNote}
	if dash := cmd.ArgsLenAtDash(); dash >= 0 && dash < len(args) {
		e.Command, e.Args = args[dash], args[dash+1:]
	}
	return e
}

func splitList(s string) []string {
	var out []string
	for _, item := range strings.Split(s, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

var registryAddCmd = &cobra.Command{
	Use:   "add <name> (--url <url> | -- <command> [args...])",
	Short: "Register a server and write it into every client",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if d := cmd.ArgsLenAtDash(); d > 1 || (d < 0 && len(args) > 1) {
			return errors.New("put the server command after --")
		}
		e := entryFromFlags(cmd, args)
		return runRegistryAdd(cmd.OutOrStdout(), args[0], e, detectedAgents(), regNoApply, regReplace)
	},
}

var registryUpdateCmd = &cobra.Command{
	Use:   "update <name> [--url <url> | -- <command> [args...]]",
	Short: "Change a registered server and update every client entry",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		flags := entryFromFlags(cmd, args)
		patch := func(e *config.RegistryEntry) error {
			if flags.URL != "" && flags.Command != "" {
				return errors.New("give either --url or a command, not both")
			}
			if flags.URL != "" {
				e.URL, e.Command, e.Args = flags.URL, "", nil
			}
			if flags.Command != "" {
				e.URL, e.Command, e.Args = "", flags.Command, flags.Args
			}
			if cmd.Flags().Changed("clients") {
				e.Clients = flags.Clients
			}
			if cmd.Flags().Changed("env") {
				e.Env = flags.Env
			}
			if cmd.Flags().Changed("note") {
				e.Note = flags.Note
			}
			return nil
		}
		return runRegistryUpdate(cmd.OutOrStdout(), args[0], patch, detectedAgents(), regNoApply, regReplace)
	},
}

var registryRemoveCmd = &cobra.Command{
	Use:   "remove <name>",
	Short: "Remove a server and the client entries hmcp wrote for it",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runRegistryRemove(cmd.OutOrStdout(), args[0], regNoApply)
	},
}

var registryListCmd = &cobra.Command{
	Use:   "list",
	Short: "List registered servers",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runRegistryList(cmd.OutOrStdout())
	},
}

var registryApplyCmd = &cobra.Command{
	Use:   "apply [name...]",
	Short: "Write registered servers (all by default) into every client",
	RunE: func(cmd *cobra.Command, args []string) error {
		return runRegistryApply(cmd.OutOrStdout(), args, detectedAgents(), regReplace, regCodexProject)
	},
}

var registryStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show where every registered server stands, without changing anything",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runRegistryStatus(cmd.OutOrStdout(), detectedAgents())
	},
}

func init() {
	for _, c := range []*cobra.Command{registryAddCmd, registryUpdateCmd} {
		c.Flags().StringVar(&regURL, "url", "", "URL of the server (http or https)")
		c.Flags().StringVar(&regClients, "clients", "", "Comma list of clients: claude,codex,antigravity (default: all)")
		c.Flags().StringArrayVar(&regEnv, "env", nil, "Env var NAME the client forwards to the server (repeatable; names only)")
		c.Flags().StringVar(&regNote, "note", "", "Free-text note, kept in the registry only")
	}
	for _, c := range []*cobra.Command{registryAddCmd, registryUpdateCmd, registryRemoveCmd} {
		c.Flags().BoolVar(&regNoApply, "no-apply", false, "Change the registry only; leave client configs as they are")
	}
	for _, c := range []*cobra.Command{registryAddCmd, registryUpdateCmd, registryApplyCmd} {
		c.Flags().BoolVar(&regReplace, "replace", false, "Overwrite a client entry of the same name that points elsewhere")
	}
	registryApplyCmd.Flags().BoolVar(&regCodexProject, "codex-project", false, "Write into ./.codex/config.toml of the current folder too")
	registryCmd.AddCommand(registryAddCmd, registryUpdateCmd, registryRemoveCmd, registryListCmd, registryApplyCmd, registryStatusCmd)
	rootCmd.AddCommand(registryCmd)
}

// loadRegistry returns the registry and its path.
func loadRegistry() (*config.Registry, string, error) {
	path, err := config.RegistryPath()
	if err != nil {
		return nil, "", err
	}
	reg, err := config.LoadRegistry(path)
	return reg, path, err
}

func runRegistryAdd(out io.Writer, name string, e *config.RegistryEntry, installed map[string]bool, noApply, replace bool) error {
	if err := config.ValidateName(name); err != nil {
		return err
	}
	if err := config.ValidateEntry(e); err != nil {
		return err
	}
	reg, path, err := loadRegistry()
	if err != nil {
		return err
	}
	if reg.Servers[name] != nil {
		return fmt.Errorf("%s is already registered; use 'hmcp registry update %s'", name, name)
	}
	reg.Servers[name] = e
	var results []config.DestinationResult
	if !noApply {
		results = config.ApplyEntry(reg, name, config.ApplyOptions{Installed: installed, Replace: replace})
	}
	return finishRegistry(out, reg, path, map[string][]config.DestinationResult{name: results})
}

func runRegistryUpdate(out io.Writer, name string, patch func(*config.RegistryEntry) error, installed map[string]bool, noApply, replace bool) error {
	reg, path, err := loadRegistry()
	if err != nil {
		return err
	}
	e := reg.Servers[name]
	if e == nil {
		return fmt.Errorf("%s is not registered; use 'hmcp registry add'", name)
	}
	if err := patch(e); err != nil {
		return err
	}
	if err := config.ValidateEntry(e); err != nil {
		return err
	}
	var results []config.DestinationResult
	if !noApply {
		results = config.ApplyEntry(reg, name, config.ApplyOptions{Installed: installed, Replace: replace})
	}
	return finishRegistry(out, reg, path, map[string][]config.DestinationResult{name: results})
}

func runRegistryRemove(out io.Writer, name string, noApply bool) error {
	reg, path, err := loadRegistry()
	if err != nil {
		return err
	}
	if reg.Servers[name] == nil {
		return fmt.Errorf("%s is not registered", name)
	}
	var results []config.DestinationResult
	if noApply {
		delete(reg.Servers, name)
	} else {
		results = config.RemoveEntry(reg, name)
	}
	err = finishRegistry(out, reg, path, map[string][]config.DestinationResult{name: results})
	if !noApply && reg.Servers[name] != nil {
		err = fmt.Errorf("%s stays registered until every client entry is removed; fix the files above and re-run", name)
	}
	return err
}

func runRegistryApply(out io.Writer, names []string, installed map[string]bool, replace, codexProject bool) error {
	reg, path, err := loadRegistry()
	if err != nil {
		return err
	}
	if len(names) == 0 {
		names = reg.SortedNames()
	}
	opts := config.ApplyOptions{Installed: installed, Replace: replace}
	if codexProject {
		cwd, err := os.Getwd()
		if err != nil {
			return err
		}
		opts.Projects = []string{cwd}
	}
	all := map[string][]config.DestinationResult{}
	for _, name := range names {
		if reg.Servers[name] == nil {
			return fmt.Errorf("%s is not registered", name)
		}
		all[name] = config.ApplyEntry(reg, name, opts)
	}
	return finishRegistry(out, reg, path, all)
}

// finishRegistry saves the registry, prints the results and warnings, and
// fails when a destination needs attention.
func finishRegistry(out io.Writer, reg *config.Registry, path string, all map[string][]config.DestinationResult) error {
	if err := config.SaveRegistry(path, reg); err != nil {
		return fmt.Errorf("client configs were updated but the registry could not be saved (%v); re-run 'hmcp registry apply'", err)
	}
	failed := printRegistryResults(out, all)
	printRegistryWarnings(out, reg, path)
	if failed {
		return errors.New("some client entries need attention (see above)")
	}
	return nil
}

func destLabel(d config.Destination) string {
	if d.Project != "" {
		return fmt.Sprintf("%s (%s)", d.Client, d.Project)
	}
	return d.Client
}

func printRegistryResults(out io.Writer, all map[string][]config.DestinationResult) (failed bool) {
	names := make([]string, 0, len(all))
	for n := range all {
		names = append(names, n)
	}
	slices.Sort(names)
	for _, name := range names {
		fmt.Fprintln(out, agentStyle.Render(name))
		agy := false
		for _, r := range all[name] {
			failed = failed || r.Failed()
			fmt.Fprintf(out, "  %-14s %s\n", destLabel(r.Dest), describeResult(r))
			agy = agy || (r.Dest.Client == config.AgentAntigravity && r.State == config.StateInSync)
		}
		if agy {
			fmt.Fprintln(out, warnStyle.Render(fmt.Sprintf("  ! Antigravity can call %s's tools without asking.", name)))
			fmt.Fprintln(out, dimStyle.Render(fmt.Sprintf("    To leave it out: hmcp registry update %s --clients claude,codex", name)))
		}
	}
	return failed
}

func describeResult(r config.DestinationResult) string {
	switch {
	case r.Err != nil:
		return warnStyle.Render("✗ " + string(r.State) + ": " + r.Err.Error())
	case r.State == config.StateConflict:
		return warnStyle.Render("! conflict: an entry with this name points elsewhere; --replace overwrites it")
	case r.Action == "dropped":
		return dimStyle.Render("– " + r.Detail + "; record dropped")
	case r.Action != "":
		return successStyle.Render("✓ " + r.Action)
	case r.State == config.StateNotInstalled:
		return dimStyle.Render("– not installed, skipped")
	case r.State == config.StateInSync:
		return successStyle.Render("✓ in sync")
	case r.State == config.StateUnmanaged:
		return warnStyle.Render("not managed (same target; apply adopts it)")
	case r.Detail != "":
		return warnStyle.Render(fmt.Sprintf("%s (%s)", r.State, r.Detail))
	}
	return warnStyle.Render(string(r.State))
}

func printRegistryWarnings(out io.Writer, reg *config.Registry, path string) {
	for _, w := range config.RegistryWarnings(reg, path) {
		fmt.Fprintln(out, warnStyle.Render("⚠ "+w))
	}
}

func runRegistryList(out io.Writer) error {
	reg, path, err := loadRegistry()
	if err != nil {
		return err
	}
	if len(reg.Servers) == 0 {
		fmt.Fprintln(out, dimStyle.Render("No registered servers. Add one with 'hmcp registry add'."))
	}
	for _, name := range reg.SortedNames() {
		e := reg.Servers[name]
		fmt.Fprintf(out, "%s  %s\n", agentStyle.Render(name), e.Target())
		fmt.Fprintf(out, "  clients: %s\n", strings.Join(e.WantedClients(), ", "))
		if len(e.Env) > 0 {
			fmt.Fprintf(out, "  env: %s\n", strings.Join(e.Env, ", "))
		}
		if e.Note != "" {
			fmt.Fprintf(out, "  note: %s\n", e.Note)
		}
	}
	printRegistryWarnings(out, reg, path)
	return nil
}

func runRegistryStatus(out io.Writer, installed map[string]bool) error {
	reg, path, err := loadRegistry()
	if err != nil {
		return err
	}
	names := reg.SortedNames()
	answers := make([]string, len(names))
	var wg sync.WaitGroup
	for i, name := range names {
		if u := reg.Servers[name].URL; u != "" {
			wg.Go(func() {
				answers[i] = "unreachable"
				if config.ProbeURL(u, 3*time.Second) {
					answers[i] = "answers"
				}
			})
		}
	}
	wg.Wait()

	drift := false
	for i, name := range names {
		fmt.Fprintln(out, strings.TrimSpace(fmt.Sprintf("%s  %s  %s", agentStyle.Render(name), reg.Servers[name].Target(), answers[i])))
		for _, r := range config.EntryStatus(reg, name, installed) {
			drift = drift || (r.State != config.StateInSync && r.State != config.StateNotInstalled)
			fmt.Fprintf(out, "  %-14s %s\n", destLabel(r.Dest), describeResult(r))
		}
	}
	printRegistryWarnings(out, reg, path)
	if drift {
		return errors.New("some client entries are not in sync; run 'hmcp registry apply'")
	}
	return nil
}
