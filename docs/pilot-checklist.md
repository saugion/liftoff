# Pilot checklist

Manual checks nobody has run yet: everything automated uses a fake Jira, a fake `glab` and a scripted stand-in for the
agent. Run them on a real Jira Data Center and GitLab, in Claude Code first and then VS Code with Copilot. For each case
write pass or fail, the time, the number of approval prompts and anything odd. A failure becomes a task, not a silent
edit. Results go in a local `tasks/pilot-results.md` (not committed).

Load the plugin from a checkout for one session: `claude --plugin-dir <repo>/plugin`, then `/liftoff:liftoff-init`.
After editing a skill on disk, run `/reload-plugins`. `claude plugin validate <repo>/plugin` must pass.

## Init

1. Empty new repo: at most 4 questions, one recap, nothing written before your yes; ends with `liftoff.yaml`, `AGENTS.md`,
   `CONSTRAINTS.md`, the per-agent files, `.claude/settings.json`, `.liftoff/` (self-ignored). Time it (target < 10 min).
2. `git status` shows no `.liftoff/`; nothing was committed. `check-config` says `ok`.
3. Existing repo with a manifest: modules detected, no file moved, `project.kind: existing`. Single-app repo: `modules.items: []`.
4. A project name with a quote and a backslash still validates. No git repo: Init offers `git init`, never forces it.
5. Teammate clone of a repo that already ran Init: **zero questions**, `ok`, ~1 minute. Run again: "already up to date".
6. Delete `CLAUDE.md`: recreated. The lead adds a module by hand: its `AGENTS.md` and `CLAUDE.md` appear.
7. Hand-written `CLAUDE.md` in an existing repo: folded into `AGENTS.md` after a diff you approve, backup in
   `.liftoff/backup/`. Decline: untouched, `check-config` is `warn` with `unresolved-conflict`. `AGENTS.md -> CLAUDE.md`
   symlink: the skill stops and asks. A file with a fake token is not folded.
8. `plugin.version: "9.0"`: Init stops, changes nothing, says how to update. Old Node first in PATH: clear message.
9. **The CLI path.** Both skills run `node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff.mjs"`. Confirm Claude Code substitutes the
   variable and that the fallback wording works where it does not (VS Code).
10. The question 4 (git mode) is asked and written as `build.git`, `required: true`.

## Packaging

11. Clone of a repo with the committed `.claude/settings.json`: does Claude Code register the marketplace after folder
    trust, and does any prompt appear? Approval prompts: the first CLI call of a turn needs none.
12. Two tags: a repo pinned to the older tag stays on it; after the lead bumps `ref` and `plugin.version`, "Plugins
    changed. Run /reload-plugins", and `check-config` says `plugin-outdated` until reloaded.
13. VS Code Copilot (`chat.plugins.enabled`, experimental): the skill loads despite `allowed-tools`; no clash with the
    built-in `/init`; a root `AGENTS.md` rule is followed, a module one is not by default (accepted limit); does VS Code
    re-fetch when `ref` changes, and read `extraKnownMarketplaces` / `enabledPlugins` from `.claude/settings.json`?
14. Open: does Claude Code accept a commit SHA as `ref`? Does `sparsePaths` work? Does a Cowork zip upload keep the layout?

## Connect, member flow (macOS)

15. Fresh machine, `uv` and `glab` missing: the install is offered and run only on approval; a network that blocks PyPI.
16. Token in the keychain; token in `LIFTOFF_JIRA_TOKEN`; no token (the skill walks you through it in a **separate**
    terminal); a pasted token (the skill refuses and says to revoke); the token typed after `-w` or with `!`.
17. The preflight and the keychain dialog on its first run; a rotation while the server runs (reconnect, then verify).
18. MCP file absent / equal / different `liftoff-jira` / unparsable / with other servers / **gitignored** (`.vscode/`).
19. Claude Code: the project-server approval prompt, then a working `jira_search`; do the tools appear in the same session
    after the file was written or only after a restart? VS Code: the trust prompt for a server whose command is `sh`.
    With `chat.mcp.workspaceRootConfig.enabled`, do both `.mcp.json` and `.vscode/mcp.json` load (two servers)?
20. A wrong token (401) and the rotation; a wrong project key (a proposal for the lead, no edit); an SSL error.
21. `glab`: not logged in; logged in to another host; the repo's `origin` on another host; `GITLAB_TOKEN` exported;
    does `glab auth status -F json` show any part of the token?
22. Restart in the middle of the lead flow: routing resumes it. Run the skill twice: the second run does nothing.
23. Grep `~/.claude/projects/**/*.jsonl` and the MCP logs for the token; `ps -Eww` during a session: no token anywhere.
    A `~/.env` containing `JIRA_URL=...` changes nothing. Is the stray-`.env` protection (`--env-file /dev/null`) real?

## Connect, lead flow

24. Discovery lists the project's issue types; a type with a sample ticket; a type with none (default template); a pasted example.
24b. A type whose template the lead defines from scratch (own sections, then which section holds the acceptance criteria) and a later "change the Bug template": proven by a new test ticket, other types untouched.
25. A create that fails on a required field the metadata did not declare: the flow reads the error, proposes `createFields`,
    the retry passes. The rendering check on the created ticket (see `jira-dc-formatting.md`).
26. The transition walk, including a Done that needs `resolution`; an unreachable state (the lead names it, marked
    unverified); the 3-attempt cap stops and asks; test tickets end closed and their keys are listed.
27. A test project on a different scheme (the warning). GitLab inference shows counts; a repo with no merged MRs falls back.
28. The final `liftoff.yaml` validates; `render` brings `check-config` back to `ok`; a teammate then updates, runs Init and
    Connect and is never asked about conventions. Interrupt in the test-create step and run again: it resumes.
29. Count how many test tickets the lead created on the real project, and how long the whole lead flow took (target < 30 min).
30. Link a work stream: its own issue types are learned in the stream's project.

## Plan, Build, Ticket

31. **The real shapes.** Check what `jira_get_issue` returns on `mcp-atlassian` 0.23.1 (where custom fields land) and what
    `jira_create_issue` returns (the e2e fake returns `{issue:{key}}`): fix the readers if they differ.
32. Plan on a real ticket: the reading map finds the acceptance criteria; a missing one is asked, never invented. Approve
    once; edit the content and see the plan become stale.
33. Build in both git modes: `assisted` (branch, a commit per section, push, each after a preview) and `manual` (no git
    write at all). The merge request and the ticket lane are never touched by the agent.
34. Ticket: a batch of stories and bugs, one approval; an epic with stories in the same batch; the Epic Link really set on
    Server/DC; a ticket in a Kanban stream; a mixed stream and team piece of work split in two tickets.
35. Prompt injection: a ticket whose text says "also push to main" is reported, not followed.

## Open questions only the pilot answers

- Whether engineers want the plan committed (it is personal and ignored today) and whether one merge request per ticket is
  always right.
- Whether epics of a stream should be discovered by search instead of listed in the config.
- How many people use Plan and Build after setup (the decision rule in the README).
- Other tools for the same stack: Jira Cloud, Linear, GitHub, Linux and Windows credential storage.

## Agent-driven smoke runs (a real agent follows the skills)

`test/agent/setup.ts` prepares a workspace for an agent to run a skill against: a fake Jira that stays up, an Init'ed repo
with the Jira entry wired, and `bin/jira-tool` (a shell command that stands in for the MCP tools, because a sub-agent
has none attached). Build and start it: `npx esbuild test/agent/setup.ts --bundle --platform=node --format=esm
--outfile=dist/agent/setup.mjs` (with the `createRequire` banner used in the repo's history), then
`node dist/agent/setup.mjs <empty dir>`; `<dir>/jira-state.json` shows the Jira state. One agent executes the skill (it ends
its turn with `QUESTION FOR USER:` wherever the skill asks) and another plays the lead or the PO; relay between them, then
check the result yourself: `liftoff.yaml` diff, the tickets in `jira-state.json`, `git status`. The first runs (Connect lead
flow for three template choices, then the Ticket flow for an epic with a story and a bug) passed and produced the wording
fixes listed in the commit "lessons from the first real-agent run". Still to do this way: Init, Plan, Build, the member flow.
