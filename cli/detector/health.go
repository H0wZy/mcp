package detector

import (
	"context"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var (
	reOpenAIKey   = regexp.MustCompile(`sk-[a-zA-Z0-9_-]{20,}`)
	reGoogleKey   = regexp.MustCompile(`AIza[0-9A-Za-z_-]{30,}`)
	reGitHubToken = regexp.MustCompile(`gh[pousr]_[a-zA-Z0-9]{36}`)
	reBearer      = regexp.MustCompile(`(?i)(Bearer\s+)[a-zA-Z0-9_.-]{20,}`)
)

func SanitizeHealthMessage(msg string) string {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return "Execution failed with no output"
	}
	msg = reOpenAIKey.ReplaceAllString(msg, "[REDACTED_OPENAI_KEY]")
	msg = reGoogleKey.ReplaceAllString(msg, "[REDACTED_GOOGLE_KEY]")
	msg = reGitHubToken.ReplaceAllString(msg, "[REDACTED_GITHUB_TOKEN]")
	msg = reBearer.ReplaceAllString(msg, "${1}[REDACTED_BEARER_TOKEN]")

	lines := strings.Split(msg, "\n")
	firstLine := strings.TrimSpace(lines[0])
	if len(firstLine) > 120 {
		return firstLine[:117] + "..."
	}
	return firstLine
}

type HealthCheckResult struct {
	ToolName    string        `json:"toolName"`
	DisplayName string        `json:"displayName"`
	Path        string        `json:"path"`
	Healthy     bool          `json:"healthy"`
	Latency     time.Duration `json:"latency"`
	Message     string        `json:"message"`
}

func CheckHealth(tool DetectedTool) HealthCheckResult {
	if !tool.Installed {
		return HealthCheckResult{
			ToolName:    tool.Name,
			DisplayName: tool.DisplayName,
			Path:        tool.Path,
			Healthy:     false,
			Message:     "Binary not found",
		}
	}

	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	switch tool.Name {
	case "agy":
		cmd = exec.CommandContext(ctx, tool.Path, "--version")
	case "codex":
		cmd = exec.CommandContext(ctx, tool.Path, "--version")
	case "claude":
		cmd = exec.CommandContext(ctx, tool.Path, "--version")
	default:
		cmd = exec.CommandContext(ctx, tool.Path, "--help")
	}

	out, err := cmd.CombinedOutput()
	latency := time.Since(start)

	if err != nil {
		return HealthCheckResult{
			ToolName:    tool.Name,
			DisplayName: tool.DisplayName,
			Path:        tool.Path,
			Healthy:     false,
			Latency:     latency,
			Message:     SanitizeHealthMessage(string(out)),
		}
	}

	return HealthCheckResult{
		ToolName:    tool.Name,
		DisplayName: tool.DisplayName,
		Path:        tool.Path,
		Healthy:     true,
		Latency:     latency,
		Message:     "CLI is functional and responsive",
	}
}
