# Changelog

Releases 0.1 to 0.3 are described by their tags (`v0.1.0`, `v0.3.0`) and by `docs/decisions/DECISIONS.md`.

## Unreleased

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
