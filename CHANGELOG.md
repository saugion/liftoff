# Changelog

Releases 0.1 to 0.3 are described by their tags (`v0.1.0`, `v0.3.0`) and by `docs/decisions/DECISIONS.md`.
`0.5.0` was never tagged: its content (below) ships in `0.6.0`.

## Unreleased

### The control panel sets a project up like the guide

Found on the first run on a real project (a folder of repositories).

- A first setup in the control panel starts from what the folder shows (parts of the code, languages, GitLab host) and from the guide's defaults. It
  asks for what the guide asks for: a Jira, its project and at least one ticket type, with the default templates.
- The control panel takes the Jira token (kept in the keychain, never in the draft), lists the projects to pick from, and offers to save the files to a branch.
- Applying creates what the guide creates: missing `AGENTS.md` files and `CONSTRAINTS.md`, `.claude/settings.json`, the Jira MCP entry, the project brain
  when just switched on. Both pages say first which files they will create. A missing module `AGENTS.md` is no longer an error there.
- A config that was saved but not applied can be applied again with nothing changed.
- When `LIFTOFF_JIRA_TOKEN` is already set, both pages say so and ask for no token: nothing is saved in the keychain unless you choose to type a
  different one (the variable still wins while it is set). A refused token from the variable is named as such.
- A pasted GitLab address (`https://...`, a clone URL) is accepted: the config keeps the host. In a folder of repositories that is not one itself, the host
  comes from theirs when they agree.
- An empty `AGENTS.md` or `CONSTRAINTS.md` counts as missing. A hand-written `CLAUDE.md` that only says `@AGENTS.md` is no longer a conflict.

## 0.6.0 (tagged when the pull request is merged)

### A guided setup, product owner first, then the technical lead

- The Init skill no longer interviews: for a new project it starts `liftoff-ui`, which now ships in the plugin (`plugin/bin/liftoff-ui.mjs`).
  The first person (a PO) describes the project, connects Jira, picks the ticket types and their templates; a second (the TL) confirms modules,
  assistants, git mode, GitLab and the quality bar. Everything else is detected or defaulted. Each part ends with a save to a new branch
  (`liftoff/setup-po`, `liftoff/setup-tl`), pushed after the person's yes. See `docs/decisions/DECISIONS.md` 63-71.
- The token is entered in the page once and kept in the keychain (or lives in `LIFTOFF_JIRA_TOKEN`). A Jira whose certificate the computer does not
  know is never trusted by file (the real `mcp-atlassian` ignores them): see the "Removed" bullet below.
- New `project.setup` (`po` | `done`) in `liftoff.yaml`. New `docs/fake-jira.md` and `Dockerfile.fake-jira`: a fake Jira in Docker to try all of it.
- The plugin is now two bundles (limit 2 MB). The panel's guard test allows two named exceptions (`ui/connect.ts`, `ui/persist.ts`).
- After the first walk-through (PO, TL, member), see `docs/decisions/DECISIONS.md` 72-81: the PO picks the Jira project from a list; the page can be
  left and reopened (Back everywhere, "not saved yet", the save offered again); the root `AGENTS.md` follows the technical lead's modules; the stack
  is told once; `commitType` and `{commitType}` for titles like `fix(PROJ-123): ...`; ticket types the team names itself (`jiraType`, recognised again by
  the label `liftoff-<name>`), addable and editable by the PO and the TL in the page and later in the control panel; Copilot's three homes; after Init a
  teammate is sent to Connect. The Jira key is in the Keychain or in `LIFTOFF_JIRA_TOKEN`, nothing else.
- Removed: the certificate-trust mechanism (`.liftoff/ca`, the "trust" button, the launcher's extra lines): the real `mcp-atlassian` ignores it. A local
  test Jira gets one click to skip the check; any other address is told what to do.
- After an independent code review: saving the setup is safer (only the files the guide wrote, from where the person is unless they have unshared commits,
  put back if a step fails, works from a subfolder of a repository); a team-named type is recognised by its label in every command, not only `parse-ticket`;
  nothing is written through a link that leaves the project, and a failure after `liftoff.yaml` restores it; module ids from folder names are valid ids; the
  control panel offers the Jira projects for a stream and keeps buttons off while an input signals an error; the technical lead decides the project brain in the guide.
- Not checked: a real browser, a real Jira, Copilot CLI and IntelliJ, the macOS Keychain. See the pilot checklist.

### Faster lookups in the brain

- Each row of `brain/index.md` now carries the page's `updated` date and `module`, so the agent can pick pages without opening them.
  An existing `index.md` shows as `index-stale` once: run `brain-index --write`.
- `brain-index --write --hook` never fails (no brain or a broken one is a silent exit 0), for a Stop hook that keeps the index fresh.
  The plugin ships no hooks, so the repo opts in: the Brain skill's Setup gives the snippet for `.claude/settings.json`.

## 0.5.0 (2026-11-20)

### The PO decides, the agent writes (Ticket)

- The Ticket skill asks the why and the out-of-scope before it drafts (Epic and Story: both; Task: the why; Bug: none), writes the answers in
  the person's words, lists everything it added as numbered assumptions the person answers, and leaves what nobody decided as `_TBD_`.
- `draft-tickets` takes `po` per ticket and `--review`, answers `ready`, and with `--approve` records a local counter (`ticket-reviewed`).
  `parse-ticket` returns `openPoints` and `practices`; Plan stops on a `_TBD_`.
- New `practices` section (`ticket-po-review: on | nudge | off`) and `pilot: { metrics }`; new command `pilot-metrics`.

### The living handbook (opt-in: `brain.handbook`, plugin 0.5)

- Thirteen shipped pages (eleven practices, two stubs) copied into the team's repo with their origin and fingerprint; `handbook-init`,
  `handbook-status`, `handbook-update`, `handbook-retire`, `handbook-seen`; findings in `brain-check`; a generated index.
- `verify-first` (a check per acceptance criterion, seen to fail first) and `clean-review` (a read-only reviewer with a clean context), both off
  by default; `parse-ticket` numbers the criteria, `plan` reports `verify`, new command `clean-review`, new subagent `liftoff-reviewer`.
- Context hygiene warnings in `brain-check` (`context-size`, `skill-size`, `skill-model`, `import-no-saving`, `hook-count`, `mcp-count`, `emphasis`).
- The control panel edits `practices.ticket-po-review`.

Nothing here has been piloted. See `docs/decisions/DECISIONS.md` (44-57).

## 0.4.0 (2026-11-19)

### Project brain (opt-in: `brain` in `liftoff.yaml`, needs `plugin.version` 0.4)

- A shared wiki in the repo (`brain/`: `raw/` sources written only by the CLI, `wiki/` pages with verified quotes, `log/`,
  a generated `index.md`) and a personal layer (`.liftoff/brain/`, never committed).
- New commands: `brain-init`, `brain-source`, `brain-index`, `brain-check`; `parse-ticket` returns `brain`; `--write` and `--kind`.
- New skill `liftoff-brain`: Setup (the lead), Ingest (three approvals), Query, Health check, Retract, Personal notes.
- Init creates the local structure on a teammate's machine; Plan reads the brain; Build offers an ingest as a separate commit.

### Lessons loop (opt-in: `brain.lessons` in `liftoff.yaml`)

- New `brain.lessons` section (`capture`, `promoteAfter`, `maxRules`, `reviewAfterDays`, `metrics`), part of the `brain` hash.
- New commands: `lesson-add`, `lesson-list`, `lesson-promote`, `lesson-metrics`; `brain-source --kind lesson`;
  `parse-ticket` returns `brain.lessons`.
- `brain-check` also reads the "Team lessons" blocks (broken block, too many or too long rules, a rule that lowers the
  bar, duplicates, rules due for review, credentials, instruction-shaped rules).
- The Brain skill has a Lessons mode (`references/lessons.md`): list, pick, diff, two approvals, never pushes.
- Plan and Build record a correction as a personal lesson in one line; Plan lists your past corrections as reminders.
- Pilot metrics, local only, with a summary that carries no ticket key, rule, path or name.
