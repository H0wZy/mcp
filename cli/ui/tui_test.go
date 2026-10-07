package ui

import (
	"errors"
	"strings"
	"testing"

	"github.com/charmbracelet/huh"
)

func TestCustomThemeAndKeyMap(t *testing.T) {
	theme := newHubTheme()
	if theme == nil {
		t.Fatalf("Expected non-nil theme")
	}

	km := newHubKeyMap()
	if km == nil {
		t.Fatalf("Expected non-nil keymap")
	}

	// Verify Quit binding contains esc
	keys := km.Quit.Keys()
	hasEsc := false
	for _, k := range keys {
		if k == "esc" {
			hasEsc = true
			break
		}
	}
	if !hasEsc {
		t.Errorf("Expected km.Quit to include 'esc', got: %v", keys)
	}

	helpKey := km.Quit.Help().Key
	if helpKey != "esc" {
		t.Errorf("Expected km.Quit help key to be 'esc', got: %s", helpKey)
	}
	helpDesc := km.Quit.Help().Desc
	if helpDesc != "quit" {
		t.Errorf("Expected km.Quit help desc to be 'quit', got: %s", helpDesc)
	}

	// Test ErrUserAborted check
	err := huh.ErrUserAborted
	if !errors.Is(err, huh.ErrUserAborted) {
		t.Errorf("Expected errors.Is to match ErrUserAborted")
	}
}

func TestBridgeOptionsCoverEveryDirection(t *testing.T) {
	all := bridgeOptionsFor(map[string]bool{"claude": true, "codex": true, "antigravity": true})
	var got []string
	for _, o := range all {
		if o.Key == "" {
			t.Errorf("option %q has no label", o.Value)
		}
		got = append(got, o.Value)
	}
	want := "claude-antigravity claude-codex codex-antigravity codex-claude antigravity-codex antigravity-claude"
	if strings.Join(got, " ") != want {
		t.Fatalf("options = %v, want %s", got, want)
	}

	two := bridgeOptionsFor(map[string]bool{"codex": true, "antigravity": true})
	if len(two) != 2 || two[0].Value != "codex-antigravity" || two[1].Value != "antigravity-codex" {
		t.Fatalf("codex + antigravity options = %+v", two)
	}
}
