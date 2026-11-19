# Changelog

Releases 0.1 to 0.3 are described by their tags (`v0.1.0`, `v0.3.0`) and by `docs/decisions/DECISIONS.md`.

## 0.4.0 (not released yet)

### Lessons loop (opt-in: `brain.lessons` in `liftoff.yaml`)

- New `brain.lessons` section (`capture`, `promoteAfter`, `maxRules`, `reviewAfterDays`, `metrics`), part of the `brain` hash.
- New commands: `lesson-add`, `lesson-list`, `lesson-promote`, `lesson-metrics`; `brain-source --kind lesson`;
  `parse-ticket` returns `brain.lessons`.
- `brain-check` also reads the "Team lessons" blocks (broken block, too many or too long rules, a rule that lowers the
  bar, duplicates, rules due for review, credentials, instruction-shaped rules).
- The Brain skill has a Lessons mode (`references/lessons.md`): list, pick, diff, two approvals, never pushes.
- Plan and Build record a correction as a personal lesson in one line; Plan lists your past corrections as reminders.
- Pilot metrics, local only, with a summary that carries no ticket key, rule, path or name.
