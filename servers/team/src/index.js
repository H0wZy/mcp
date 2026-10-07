// H0wZy/mcp — Agent Team MCP Server (spec 007)
// Lets any host agent lead a team of Claude Code, Codex and Antigravity teammates.
// Contract: specs/007-agent-team-orchestrator/contracts/team-tools.md

// Installed from npm, @h0wzy/mcp-shared is a real dependency. Run straight from a
// clone without `npm install`, fall back to the workspace copy of shared/.
const shared = await import('@h0wzy/mcp-shared').catch((err) => {
  if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
  return import('../../../shared/index.js');
});
const { createMcpServer, resolveHost, createAgentConfig, resolveChain, validateCwd, Team, TEAM_AGENTS } = shared;

const NESTED_REFUSAL = "⛔ Teammates can't create teams or spawn teammates (FR-017). Message the lead instead.";
const WAIT_DEFAULT_SECONDS = 300;
const WAIT_MAX_SECONDS = 1800;
const RESULT_PAGE_DEFAULT = 20000;
const RESULT_PAGE_MAX = 50000;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const host = resolveHost();
const teams = new Map();
let currentTeam = null;

// One spec-005 config per vendor: validates model / effort / tier and applies the
// developer ceilings (AGY_*, CODEX_*, CLAUDE_BRIDGE_*) to every teammate.
const agentConfigs = {
  claude: createAgentConfig({ provider: 'claude' }),
  codex: createAgentConfig({ provider: 'codex' }),
  antigravity: createAgentConfig({ provider: 'antigravity' }),
};

process.on('exit', () => {
  for (const team of teams.values()) team.store.releaseOwner();
});

/** True when this server runs under a teammate or another bridge-started agent. */
function isNested() {
  return resolveChain({ env: process.env, host }).kind !== 'new';
}

function getTeam(name) {
  const wanted = name || currentTeam;
  if (!wanted) throw new Error('No team yet. Call team_create first.');
  let team = teams.get(wanted);
  if (!team) {
    team = Team.load({ cwd: process.cwd(), name: wanted });
    teams.set(wanted, team);
  }
  currentTeam = wanted;
  return team;
}

function ok(text) {
  return { text, isError: false };
}

function fail(err) {
  return { text: `❌ ${err?.message || err}`, isError: true };
}

function tool(name, description, properties, required, handler, annotations = { readOnlyHint: false, openWorldHint: false }) {
  return {
    name,
    description,
    annotations,
    inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) },
    handler: async (args = {}, ctx) => {
      try {
        return await handler(args, ctx);
      } catch (err) {
        return fail(err);
      }
    },
  };
}

const TEAM_PROP = { type: 'string', description: 'Team name (default: the team used last).' };

function resolveSettings(agent, { tier, model, effort }) {
  const config = agentConfigs[agent];
  let m = model;
  let e = effort;
  if (tier) {
    const preset = config.get().tiers[String(tier).toLowerCase()];
    if (!preset) throw new Error(`tier must be one of light, balanced, deep.`);
    m = m || preset.model;
    e = e || preset.effort;
  }
  return config.resolveCall({ model: m, effort: e });
}

export const teamCreateTool = tool(
  'team_create',
  'Create an agent team that you (the lead) run: teammates are Claude Code, OpenAI Codex or Google Antigravity agents working in the background. ' +
    'Limits come from the developer; you can only lower them. Next: task_create, team_spawn, then team_wait.',
  {
    name: { type: 'string', description: 'Short team name (lowercase, digits, dashes).' },
    cwd: { type: 'string', description: 'Absolute project folder (default: this server\'s folder).' },
    limits: {
      type: 'object',
      description: 'Optional lower limits: max_teammates, max_turns_per_teammate, max_total_turns, deadline_minutes, result_cap_chars.',
      properties: {
        max_teammates: { type: 'number' },
        max_turns_per_teammate: { type: 'number' },
        max_total_turns: { type: 'number' },
        deadline_minutes: { type: 'number' },
        result_cap_chars: { type: 'number' },
      },
    },
    self_claim: { type: 'boolean', description: 'Idle teammates take the next available task themselves (default true).' },
  },
  ['name'],
  ({ name, cwd, limits, self_claim }) => {
    if (isNested()) return { text: NESTED_REFUSAL, isError: true };
    const dir = cwd ? validateCwd(cwd) : process.cwd();
    const existing = teams.get(name);
    if (existing) {
      currentTeam = name;
      return ok(`Team "${name}" already exists in this session; using it.\n\n${existing.status()}`);
    }
    const { team, resumed, notes } = Team.create({ name, cwd: dir, host, limits, selfClaim: self_claim });
    teams.set(team.name, team);
    currentTeam = team.name;
    const l = team.data.limits;
    return ok(
      `${resumed ? 'Resumed saved' : 'Created'} team "${team.name}" in ${team.data.cwd}.\n` +
        `Limits: ${l.maxTeammates} teammates · ${l.maxTurnsPerTeammate} turns each · ${l.maxTotalTurns} turns total · ${l.deadlineMinutes} min · results capped at ${l.resultCap} chars.` +
        (notes.length ? `\n⚠️ ${notes.join('\n⚠️ ')}` : '') +
        (resumed ? `\n\n${team.status()}` : '\nNext: task_create (optional), team_spawn, then team_wait.')
    );
  }
);

export const teamSpawnTool = tool(
  'team_spawn',
  'Start a teammate in the background (returns at once). Pick the agent and tier per role: light for scouting, balanced for routine work, deep for security/architecture. ' +
    'Teammates are read-only unless can_edit is true; editing teammates work in their own git worktree by default. ' +
    'Give a `task` (text) or `task_id`, or let it self-claim from the task list.',
  {
    team: TEAM_PROP,
    name: { type: 'string', description: 'Unique teammate name (e.g. "reviewer").' },
    agent: { type: 'string', enum: TEAM_AGENTS, description: 'Which agent runs this teammate.' },
    role: { type: 'string', description: 'Role instructions: what this teammate focuses on and how.' },
    tier: { type: 'string', enum: ['light', 'balanced', 'deep'], description: 'Model/effort preset for that agent (spec 005).' },
    model: { type: 'string', description: 'Optional model override for that agent.' },
    effort: { type: 'string', enum: [...EFFORTS, 'ultra'], description: 'Optional effort override.' },
    can_edit: { type: 'boolean', description: 'Allow file edits (default false).' },
    isolation: { type: 'string', enum: ['worktree', 'none'], description: 'For editing teammates: own git worktree (default in a git repo) or the shared project folder.' },
    owns: { type: 'array', items: { type: 'string' }, description: 'Files or folders (from the repo root) this teammate may change; others are flagged.' },
    task: { type: 'string', description: 'Initial task text (creates a task assigned to this teammate).' },
    task_id: { type: 'string', description: 'Assign an existing pending task instead.' },
    max_turns: { type: 'number', description: 'Lower turn limit for this teammate.' },
  },
  ['name', 'agent', 'role'],
  (args) => {
    if (isNested()) return { text: NESTED_REFUSAL, isError: true };
    const team = getTeam(args.team);
    if (!TEAM_AGENTS.includes(args.agent)) throw new Error(`agent must be one of ${TEAM_AGENTS.join(', ')}.`);
    const settings = resolveSettings(args.agent, args);
    const { member, assigned, notes } = team.spawn({
      name: args.name,
      agent: args.agent,
      role: args.role,
      tier: args.tier,
      settings,
      canEdit: args.can_edit === true,
      isolation: args.isolation,
      owns: args.owns,
      task: args.task,
      taskId: args.task_id,
      maxTurns: Number.isFinite(args.max_turns) ? Math.floor(args.max_turns) : undefined,
    });
    const where = member.canEdit ? `edits in ${member.workDir}` : 'read-only';
    const doing = member.state === 'working' ? `working on ${member.currentTask || 'its messages'}` : assigned ? `waiting for ${assigned.id}` : 'idle, waiting for a task';
    const warnings = [...settings.warnings, ...notes];
    return ok(
      `Spawned ${member.name} (${member.agent} ${member.model}/${member.effortApplied === false ? 'n/a' : member.effort}, ${where}) — ${doing}.` +
        (warnings.length ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : '') +
        `\nCall team_wait to hear when it finishes.`
    );
  }
);

export const taskCreateTool = tool(
  'task_create',
  'Add tasks to the team task list. A task with depends_on starts only after those tasks complete; cycles are refused. ' +
    'Optional `check` is a command (argv array, no shell, e.g. ["npm","test"]) that must pass before "done" counts.',
  {
    team: TEAM_PROP,
    tasks: {
      type: 'array',
      description: 'Tasks to add.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Optional id (default T1, T2, …).' },
          title: { type: 'string' },
          description: { type: 'string' },
          assignee: { type: 'string', description: 'Teammate name (optional; unassigned tasks are self-claimed).' },
          depends_on: { type: 'array', items: { type: 'string' } },
          check: { type: 'array', items: { type: 'string' } },
        },
        required: ['title'],
      },
    },
  },
  ['tasks'],
  ({ team: name, tasks }) => {
    const team = getTeam(name);
    const created = team.createTasks(tasks);
    return ok(`Created ${created.map((t) => t.id).join(', ')}.\n${team.taskList()}`);
  }
);

export const taskUpdateTool = tool(
  'task_update',
  'Change a task as the lead: reassign, cancel, reopen (pending), or mark completed/failed. Reassigning a running task applies after the current turn.',
  {
    team: TEAM_PROP,
    id: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'cancelled', 'completed', 'failed'] },
    assignee: { type: 'string', description: 'Teammate name, or "" to unassign.' },
    description: { type: 'string' },
    note: { type: 'string' },
  },
  ['id'],
  ({ team: name, id, status, assignee, description, note }) => {
    const team = getTeam(name);
    const t = team.updateTask(id, { status, assignee, description, note });
    return ok(`Updated ${t.id}.\n${team.taskList()}`);
  }
);

export const taskListTool = tool(
  'task_list',
  'Show the team task list, one line per task.',
  { team: TEAM_PROP },
  [],
  ({ team: name }) => ok(getTeam(name).taskList()),
  { readOnlyHint: true, openWorldHint: false }
);

export const teamStatusTool = tool(
  'team_status',
  'Full picture in one call: each teammate (state, agent/model, task, turns, cost, unread messages), team limits and the task list. ' +
    'Prefer team_wait to follow progress; use this when you need everything at once. Also loads a saved team by name.',
  { team: TEAM_PROP },
  [],
  ({ team: name }) => ok(getTeam(name).status()),
  { readOnlyHint: true, openWorldHint: false }
);

export const teamWaitTool = tool(
  'team_wait',
  'Wait for the next team event (a teammate finished or failed, a task completed, a message to you, a limit hit) and return every event you have not seen. ' +
    'Returns as soon as something happens; call it again to keep following. Results are compact; read full outputs with team_result.',
  {
    team: TEAM_PROP,
    timeout_seconds: { type: 'number', description: `Max wait (default ${WAIT_DEFAULT_SECONDS}, max ${WAIT_MAX_SECONDS}).` },
  },
  [],
  async ({ team: name, timeout_seconds }, ctx) => {
    const team = getTeam(name);
    const raw = Number(timeout_seconds);
    const seconds = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), WAIT_MAX_SECONDS) : WAIT_DEFAULT_SECONDS;
    const events = await team.wait(seconds * 1000, ctx?.signal);
    if (!events.length) {
      const brief = team.data.members.map((m) => `${m.name}: ${m.state}${m.currentTask ? ` on ${m.currentTask}` : ''}`).join(' · ');
      return ok(`No events in ${seconds}s. ${brief || 'No teammates.'}`);
    }
    const working = team.data.members.filter((m) => m.state === 'working').map((m) => m.name);
    return ok(
      events.map((e) => e.text).join('\n\n') +
        `\n\n— ${working.length ? `still working: ${working.join(', ')}` : 'no teammate is working'} · turns ${team.data.turnsUsed}/${team.data.limits.maxTotalTurns}`
    );
  },
  { readOnlyHint: true, openWorldHint: false }
);

export const teamMessageTool = tool(
  'team_message',
  'Send a message to a teammate. It arrives at the start of its next turn; an idle teammate wakes for one turn (within its budget).',
  {
    team: TEAM_PROP,
    to: { type: 'string', description: 'Teammate name.' },
    text: { type: 'string' },
  },
  ['to', 'text'],
  ({ team: name, to, text }) => {
    const team = getTeam(name);
    const member = team.message(to, text);
    return ok(`Queued for ${member.name} (${member.state}).`);
  }
);

export const teamResultTool = tool(
  'team_result',
  'Read the full saved output of a teammate turn or change set by its ref (e.g. "reviewer#2"), page by page.',
  {
    team: TEAM_PROP,
    ref: { type: 'string' },
    offset: { type: 'number', description: 'Start character (default 0).' },
    limit: { type: 'number', description: `Characters to return (default ${RESULT_PAGE_DEFAULT}, max ${RESULT_PAGE_MAX}).` },
  },
  ['ref'],
  ({ team: name, ref, offset, limit }) => {
    const team = getTeam(name);
    const start = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
    const size = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), RESULT_PAGE_MAX) : RESULT_PAGE_DEFAULT;
    const page = team.store.readResult(ref, start, size);
    if (!page) throw new Error(`No saved output '${ref}'.`);
    const end = start + page.text.length;
    return ok(`${page.text}\n\n[${ref}: characters ${start}–${end} of ${page.total}${end < page.total ? ` · next offset ${end}` : ''}]`);
  },
  { readOnlyHint: true, openWorldHint: false }
);

export const teamChangesTool = tool(
  'team_changes',
  'Show the change set of a teammate that edits in its own git worktree (status, diff stat, full diff ref). remove: true deletes the worktree afterwards.',
  {
    team: TEAM_PROP,
    member: { type: 'string' },
    remove: { type: 'boolean' },
  },
  ['member'],
  async ({ team: name, member, remove }) => {
    const team = getTeam(name);
    const res = await team.changes(member, { remove: remove === true });
    return ok(res.text);
  }
);

export const teamShutdownTool = tool(
  'team_shutdown',
  'Stop one teammate or the whole team. A running turn gets a grace period (default 60 s), then is stopped. Worktrees are kept.',
  {
    team: TEAM_PROP,
    member: { type: 'string', description: 'Teammate name (default: everyone).' },
    grace_seconds: { type: 'number' },
  },
  [],
  ({ team: name, member, grace_seconds }) => {
    const team = getTeam(name);
    const grace = Number.isFinite(grace_seconds) && grace_seconds >= 0 ? Math.min(grace_seconds, 600) * 1000 : 60000;
    const summary = team.shutdown({ member, graceMs: grace });
    return ok(summary.length ? summary.join('\n') : 'Nothing to stop.');
  }
);

export const TEAM_TOOLS = [
  teamCreateTool,
  teamSpawnTool,
  taskCreateTool,
  taskUpdateTool,
  taskListTool,
  teamStatusTool,
  teamWaitTool,
  teamMessageTool,
  teamResultTool,
  teamChangesTool,
  teamShutdownTool,
];

export function createServer() {
  return createMcpServer({ name: 'team', version: '1.0.6', tools: TEAM_TOOLS, host });
}
