# Changelog

Releases 0.1 to 0.3 are described by their tags (`v0.1.0`, `v0.3.0`) and by `docs/decisions/DECISIONS.md`.

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
