package version

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

const (
	Current      = "1.0.2"
	NpmRegistry  = "https://registry.npmjs.org/@h0wzy/mcp/latest"
	GitHubLatest = "https://api.github.com/repos/H0wZy/mcp/releases/latest"
	CacheTTL     = 4 * time.Hour
)

type UpdateInfo struct {
	CurrentVersion  string `json:"current_version"`
	LatestVersion   string `json:"latest_version"`
	CheckedAt       int64  `json:"checked_at"`
	UpdateAvailable bool   `json:"update_available"`
	ReleaseURL      string `json:"release_url,omitempty"`
}

func getCachePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".h0wzy", "update-check.json"), nil
}

func readCache() (*UpdateInfo, error) {
	path, err := getCachePath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var info UpdateInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

func writeCache(info *UpdateInfo) {
	path, err := getCachePath()
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0755)
	data, _ := json.MarshalIndent(info, "", "  ")
	_ = os.WriteFile(path, data, 0644)
}

// CompareSemver returns true if remote is strictly greater than local
func IsNewer(remote, local string) bool {
	remote = strings.TrimPrefix(strings.TrimSpace(remote), "v")
	local = strings.TrimPrefix(strings.TrimSpace(local), "v")

	rParts := strings.Split(remote, ".")
	lParts := strings.Split(local, ".")

	for i := 0; i < len(rParts) && i < len(lParts); i++ {
		rNum, errR := strconv.Atoi(rParts[i])
		lNum, errL := strconv.Atoi(lParts[i])
		if errR == nil && errL == nil {
			if rNum > lNum {
				return true
			}
			if rNum < lNum {
				return false
			}
		} else {
			if rParts[i] > lParts[i] {
				return true
			}
			if rParts[i] < lParts[i] {
				return false
			}
		}
	}
	return len(rParts) > len(lParts)
}

// CheckForUpdate queries remote registry with 1.5s timeout, caching result
func CheckForUpdate(force bool) (*UpdateInfo, error) {
	if !force {
		cached, err := readCache()
		if err == nil && cached != nil {
			if time.Since(time.UnixMilli(cached.CheckedAt)) < CacheTTL {
				cached.CurrentVersion = Current
				cached.UpdateAvailable = IsNewer(cached.LatestVersion, Current)
				return cached, nil
			}
		}
	}

	client := &http.Client{Timeout: 1500 * time.Millisecond}

	// 1. Try npm registry (fast, no rate limits)
	latestVersion := ""
	releaseURL := "https://github.com/H0wZy/mcp/releases"

	req, err := http.NewRequest("GET", NpmRegistry, nil)
	if err == nil {
		req.Header.Set("User-Agent", "h0wzy-mcp/"+Current)
		resp, err := client.Do(req)
		if err == nil && resp.StatusCode == 200 {
			defer resp.Body.Close()
			var npmData struct {
				Version string `json:"version"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&npmData); err == nil && npmData.Version != "" {
				latestVersion = npmData.Version
				releaseURL = fmt.Sprintf("https://github.com/H0wZy/mcp/releases/tag/v%s", latestVersion)
			}
		}
	}

	// 2. Fallback to GitHub releases API
	if latestVersion == "" {
		reqGH, err := http.NewRequest("GET", GitHubLatest, nil)
		if err == nil {
			reqGH.Header.Set("User-Agent", "h0wzy-mcp/"+Current)
			respGH, err := client.Do(reqGH)
			if err == nil && respGH.StatusCode == 200 {
				defer respGH.Body.Close()
				var ghData struct {
					TagName string `json:"tag_name"`
					HTMLURL string `json:"html_url"`
				}
				if err := json.NewDecoder(respGH.Body).Decode(&ghData); err == nil && ghData.TagName != "" {
					latestVersion = strings.TrimPrefix(ghData.TagName, "v")
					if ghData.HTMLURL != "" {
						releaseURL = ghData.HTMLURL
					}
				}
			}
		}
	}

	if latestVersion == "" {
		// Return last known cached or current without error
		return &UpdateInfo{
			CurrentVersion:  Current,
			LatestVersion:   Current,
			CheckedAt:       time.Now().UnixMilli(),
			UpdateAvailable: false,
		}, nil
	}

	info := &UpdateInfo{
		CurrentVersion:  Current,
		LatestVersion:   latestVersion,
		CheckedAt:       time.Now().UnixMilli(),
		UpdateAvailable: IsNewer(latestVersion, Current),
		ReleaseURL:      releaseURL,
	}

	writeCache(info)
	return info, nil
}

// RenderNotice returns a stylized banner notification when an update is available
func RenderNotice(info *UpdateInfo) string {
	if info == nil || !info.UpdateAvailable {
		return ""
	}

	boxStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("#00ADD8")).
		Padding(0, 1).
		MarginBottom(1)

	msg := fmt.Sprintf("⚡ Update available: %s → %s\nRun 'hmcp upgrade' to install latest release",
		lipgloss.NewStyle().Foreground(lipgloss.Color("#888888")).Render(info.CurrentVersion),
		lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#04B575")).Render(info.LatestVersion),
	)

	return boxStyle.Render(msg)
}
