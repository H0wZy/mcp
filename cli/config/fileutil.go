package config

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// readJSONObject loads a JSON object from path. A missing or blank file yields an
// empty object; a file that exists but does not parse is an error, so callers never
// overwrite (and lose) a config they could not read.
func readJSONObject(path string) (map[string]interface{}, error) {
	data := make(map[string]interface{})
	content, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return data, nil
	}
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(content)) == 0 {
		return data, nil
	}
	// UseNumber keeps large integers (timestamps, ids) byte-exact when the file is rewritten.
	dec := json.NewDecoder(bytes.NewReader(content))
	dec.UseNumber()
	if err := dec.Decode(&data); err != nil {
		return nil, &invalidJSONError{path: path, err: err}
	}
	return data, nil
}

// invalidJSONError marks a config file that exists but does not parse. Writers
// refuse to touch it; readers (doctor) report it and carry on.
type invalidJSONError struct {
	path string
	err  error
}

func (e *invalidJSONError) Error() string {
	return fmt.Sprintf("refusing to modify %s: it is not valid JSON (%v); fix or move it and retry", e.path, e.err)
}

func (e *invalidJSONError) Unwrap() error { return e.err }

func writeJSONObject(path string, data map[string]interface{}) error {
	out, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize %s: %w", path, err)
	}
	return writeFileAtomic(path, append(out, '\n'), 0600)
}

// writeFileAtomic writes to a temp file in the same directory and renames it over
// path, so a crash or a concurrent reader never sees a truncated config.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath) // no-op once the rename has succeeded

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(perm); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

// tomlHeader returns the table name of a TOML header line ("[a.b]" -> "a.b"),
// or "" when the line is not a table header. Array-of-tables headers count too,
// since they also end the previous table.
func tomlHeader(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if i := strings.Index(trimmed, "#"); i >= 0 {
		trimmed = strings.TrimSpace(trimmed[:i])
	}
	if !strings.HasPrefix(trimmed, "[") || !strings.HasSuffix(trimmed, "]") {
		return "", false
	}
	name := strings.Trim(trimmed, "[]")
	return strings.TrimSpace(name), true
}

// splitTOMLSection cuts content into the part before the [table] section, the
// section itself (header through the line before the next header), and the rest.
// Go's RE2 regexp has no lookahead, so the section is found line by line.
func splitTOMLSection(content, table string) (before, section, after []string, found bool) {
	lines := strings.Split(content, "\n")
	start := -1
	for i, line := range lines {
		if name, ok := tomlHeader(line); ok && name == table {
			start = i
			break
		}
	}
	if start < 0 {
		return lines, nil, nil, false
	}
	end := len(lines)
	for i := start + 1; i < len(lines); i++ {
		if _, ok := tomlHeader(lines[i]); ok {
			end = i
			break
		}
	}
	// Comments and blank lines just above the next header describe that next
	// table, not this one, so they stay with it.
	for end > start+1 {
		prev := strings.TrimSpace(lines[end-1])
		if prev != "" && !strings.HasPrefix(prev, "#") {
			break
		}
		end--
	}
	return lines[:start], lines[start:end], lines[end:], true
}

// upsertTOMLSection replaces the [table] section with block, or appends block when
// the section does not exist. Sub-tables such as [table.env] are left untouched.
func upsertTOMLSection(content, table, block string) string {
	block = strings.TrimRight(block, "\n")
	before, _, after, found := splitTOMLSection(content, table)
	if !found {
		trimmed := strings.TrimRight(content, "\r\n")
		if trimmed == "" {
			return block + "\n"
		}
		return trimmed + "\n\n" + block + "\n"
	}

	parts := append([]string{}, before...)
	parts = append(parts, strings.Split(block, "\n")...)
	if len(after) > 0 {
		parts = append(parts, "")
		parts = append(parts, after...)
	}
	return normalizeTOMLSpacing(strings.Join(parts, "\n"))
}

// removeTOMLSection drops the [table] section and all of its sub-tables ([table.*]).
func removeTOMLSection(content, table string) string {
	result := content
	for {
		before, _, after, found := splitTOMLSection(result, table)
		if !found {
			break
		}
		result = strings.Join(append(append([]string{}, before...), after...), "\n")
	}

	prefix := table + "."
	lines := strings.Split(result, "\n")
	kept := make([]string, 0, len(lines))
	skipping := false
	for _, line := range lines {
		if name, ok := tomlHeader(line); ok {
			skipping = strings.HasPrefix(name, prefix)
		}
		if !skipping {
			kept = append(kept, line)
		}
	}
	return normalizeTOMLSpacing(strings.Join(kept, "\n"))
}

// normalizeTOMLSpacing collapses runs of blank lines left behind by edits and
// ends the file with exactly one newline.
func normalizeTOMLSpacing(content string) string {
	lines := strings.Split(content, "\n")
	out := make([]string, 0, len(lines))
	blank := false
	for _, line := range lines {
		isBlank := strings.TrimSpace(line) == ""
		if isBlank && (blank || len(out) == 0) {
			continue
		}
		out = append(out, line)
		blank = isBlank
	}
	trimmed := strings.TrimRight(strings.Join(out, "\n"), "\r\n")
	if trimmed == "" {
		return ""
	}
	return trimmed + "\n"
}
