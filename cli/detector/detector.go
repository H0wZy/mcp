package detector

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type DetectedTool struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Path        string `json:"path"`
	Version     string `json:"version"`
	Installed   bool   `json:"installed"`
	Healthy     bool   `json:"healthy"`
	Message     string `json:"message"`
}

func getCandidateNames(name string) []string {
	if runtime.GOOS != "windows" {
		return []string{name}
	}
	pathext := os.Getenv("PATHEXT")
	if pathext == "" {
		pathext = ".EXE;.CMD;.BAT;.COM"
	}
	exts := strings.Split(pathext, ";")
	var candidates []string
	for _, ext := range exts {
		if ext == "" {
			continue
		}
		if !strings.HasPrefix(ext, ".") {
			ext = "." + ext
		}
		candidates = append(candidates, name+strings.ToLower(ext))
	}
	return append(candidates, name)
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	if runtime.GOOS == "windows" {
		lower := strings.ToLower(path)
		pathext := os.Getenv("PATHEXT")
		if pathext == "" {
			pathext = ".EXE;.CMD;.BAT;.COM"
		}
		for _, ext := range strings.Split(pathext, ";") {
			if ext != "" && strings.HasSuffix(lower, strings.ToLower(ext)) {
				return true
			}
		}
		return false
	}
	return info.Mode()&0111 != 0
}

func resolveExecutable(name string) string {
	home, _ := os.UserHomeDir()
	var searchDirs []string

	if runtime.GOOS == "windows" {
		localAppData := os.Getenv("LOCALAPPDATA")
		appData := os.Getenv("APPDATA")

		if name == "agy" {
			if localAppData != "" {
				searchDirs = append(searchDirs, filepath.Join(localAppData, "agy", "bin"))
			}
			searchDirs = append(searchDirs, filepath.Join(home, ".local", "bin"))
		} else if name == "codex" {
			if appData != "" {
				searchDirs = append(searchDirs, filepath.Join(appData, "npm"))
			}
			searchDirs = append(searchDirs, filepath.Join(home, ".local", "bin"))
		} else if name == "claude" {
			searchDirs = append(searchDirs, filepath.Join(home, ".local", "bin"))
			if appData != "" {
				searchDirs = append(searchDirs, filepath.Join(appData, "npm"))
			}
		}
	} else {
		searchDirs = append(searchDirs,
			filepath.Join(home, ".local", "bin"),
			"/opt/homebrew/bin",
			"/usr/local/bin",
			"/usr/bin",
			"/bin",
			filepath.Join(home, ".npm-global", "bin"),
		)
	}

	pathEnv := os.Getenv("PATH")
	searchDirs = append(searchDirs, filepath.SplitList(pathEnv)...)

	candidates := getCandidateNames(name)
	seen := make(map[string]bool)

	for _, dir := range searchDirs {
		if dir == "" || seen[dir] {
			continue
		}
		seen[dir] = true
		for _, cand := range candidates {
			fullPath := filepath.Join(dir, cand)
			if isExecutable(fullPath) {
				return fullPath
			}
		}
	}
	return ""
}

func probeVersion(path string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, path, "--version")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) > 0 {
		return strings.TrimSpace(lines[0])
	}
	return ""
}

func DetectTools() []DetectedTool {
	targets := []struct {
		name        string
		displayName string
	}{
		{"claude", "Claude Code"},
		{"codex", "OpenAI Codex CLI"},
		{"agy", "Google Antigravity"},
	}

	var results []DetectedTool
	for _, t := range targets {
		path := resolveExecutable(t.name)
		tool := DetectedTool{
			Name:        t.name,
			DisplayName: t.displayName,
			Path:        path,
			Installed:   path != "",
		}

		if tool.Installed {
			tool.Version = probeVersion(path)
			tool.Healthy = true
			tool.Message = "Ready"
		} else {
			tool.Message = "Not installed or not found on PATH"
		}
		results = append(results, tool)
	}

	return results
}
