// Package skills holds the agent skills hmcp installs into each harness.
package skills

import _ "embed"

// AgentTeamName is the skill's name and the folder it is installed in.
const AgentTeamName = "agent-team"

// Marker identifies a skill copy written by hmcp. Only files that contain it are
// overwritten or deleted; anything else at the same path belongs to the user.
const Marker = "installed by hmcp"

// AgentTeam is agent-team/SKILL.md (spec 007), embedded at build time.
//
//go:embed agent-team/SKILL.md
var AgentTeam []byte
