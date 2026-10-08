package cmd

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestInstallBinaryAliasesReplacesEveryAlias(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "download.tmp")
	if err := os.WriteFile(src, []byte("new"), 0o755); err != nil {
		t.Fatal(err)
	}
	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	// One alias already installed (the running one), one missing.
	existing := filepath.Join(dir, "hmcp"+ext)
	if err := os.WriteFile(existing, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}

	if err := installBinaryAliases(src, dir, []string{"hmcp", "h0wzy-mcp"}, runtime.GOOS); err != nil {
		t.Fatalf("installBinaryAliases: %v", err)
	}
	for _, alias := range []string{"hmcp", "h0wzy-mcp"} {
		got, err := os.ReadFile(filepath.Join(dir, alias+ext))
		if err != nil || string(got) != "new" {
			t.Errorf("%s = %q, %v; want the new binary", alias, got, err)
		}
		if _, err := os.Stat(filepath.Join(dir, alias+ext+".new")); !os.IsNotExist(err) {
			t.Errorf("%s: temporary .new file left behind", alias)
		}
	}
	if runtime.GOOS == "windows" {
		// The replaced binary is kept aside, since a running .exe can be renamed but not removed.
		if got, _ := os.ReadFile(existing + ".old"); string(got) != "old" {
			t.Errorf("hmcp.exe.old = %q, want the previous binary", got)
		}
	}
}

func TestInstallBinaryAliasesReportsFailures(t *testing.T) {
	dir := t.TempDir()
	if err := installBinaryAliases(filepath.Join(dir, "missing"), dir, []string{"hmcp"}, runtime.GOOS); err == nil {
		t.Fatal("a failed copy must be reported, not printed as a successful upgrade")
	}
}
