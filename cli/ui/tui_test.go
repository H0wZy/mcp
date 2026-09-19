package ui

import (
	"errors"
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
