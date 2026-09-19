package detector

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

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
			Message:     strings.TrimSpace(string(out)),
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
