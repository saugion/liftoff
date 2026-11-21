# LiftOff: handoff

Repo: https://github.com/saugion/liftoff · Last update: 2026-11-21 · Next release: **`v0.6.0`** (the guided setup, plus everything that was prepared as `v0.5.0`, which was never tagged). It is tagged by hand on `main` right after the pull request is merged: `npm run release 0.6.0`, then `git push origin main && git push origin v0.6.0` (a pushed `v*` tag is immutable). The pilot stays pinned to `#v0.3.0` until the group chooses to move; the brain, lessons and the guide have not been piloted.

## Where we are

The MVP is built: **Init, Connect, Plan, Build, Ticket flow (with epics), work streams**, and the `build.git` team option.
Everything is covered by ~2,000 tests (2,023 at the last run), including end-to-end runs (`test/e2e/`) against a fake Jira, a fake `glab` and a real
git remote. **Nothing has run against a real Jira Data Center, a real GitLab or a real agent following the skills.**

| Piece | Where |
|---|---|
| Config schema, hashes, connectors, streams, `build` | `src/config/`, `schema/liftoff.schema.json` |
| CLI (`validate`, `check-config`, `render`, `connect-info`, `parse-ticket`, `plan`, `draft-tickets`) | `src/cli/`, `src/plan/`, `src/connect/` |
| Skills: `liftoff-init`, `-connect`, `-plan`, `-build`, `-ticket` | `plugin/skills/` |
| Shipped CLI bundle (committed, must equal a fresh build) | `plugin/bin/liftoff.mjs` |
| Reasoning behind the design | `docs/design-notes.md` (the per-module specs were removed; they are in git history up to commit 79ab5e3) |
| Decisions the agent took alone, to review | `docs/decisions/DECISIONS.md` |

## v0.6 the guided setup (ready as v0.6.0, tag after the merge, unpiloted)

Init starts a page in the browser (`plugin/bin/liftoff-ui.mjs`, source in `ui/`): the product owner describes the project, connects Jira (address, token,
the project from a list), picks the ticket types (including the team's own, created as another Jira type and recognised by the label `liftoff-<name>`),
templates and the kind of change; the technical lead confirms modules, assistants, ticket types, git mode, GitLab (titles like `fix(PROJ-123): ...`), the quality
bar and decides the project brain. Each part saves to `liftoff/setup-po` / `liftoff/setup-tl` and pushes, after a yes. Decisions: `DECISIONS.md` 63-89. Tests: `test/e2e/ui-setup.test.ts`,
`ui-page.test.ts`, `ui-panel.test.ts` (the pages' own scripts run against the real server), `test/ui/`. To try it with no real Jira: `scripts/fake-setup.sh`
(`docs/fake-jira.md`). **Not checked:** a real browser, a real Jira, Copilot on the command line and in IntelliJ, the macOS Keychain, the real `mcp-atlassian`
with a certificate the system does not know (it ignores certificate files; only the system's trust or `sslVerify: false` work).

## v0.5 (content ships in v0.6.0, unpiloted)

The PO's review of tickets, the `practices` and `pilot` sections, the living handbook (opt-in `brain.handbook`), `verify-first`, `clean-review`
(a read-only subagent) and the context-hygiene warnings. Designs and decisions: `docs/decisions/ticket-po-review.md`, `handbook.md`,
`handbook-practice-context-hygiene.md`, and `DECISIONS.md` 44-57. Everything that adds a step to Plan or Build is off by default (the pilot rule).
New CLI commands: `handbook-init|status|update|retire|seen`, `clean-review`, `pilot-metrics`; `draft-tickets` takes `--review` and `--approve`.
Smoke runs with agents covered the Ticket flow (a PO who answers and one who delegates) and Plan and Build with `verify-first` and
`clean-review` (see `DECISIONS.md`). **Not checked:** a real Jira (does `_TBD_` survive its markup?), VS Code Copilot (the reviewer fallback, the
hooks, the commands the pages mention), a real GitLab. It ships with `v0.6.0` (`v0.5.0` was never tagged).

## v0.4 project brain (released as v0.4.0)

Opt-in `brain` section: a wiki in the repo (`brain/`: raw sources, pages, log, generated index) plus a personal layer under
`.liftoff/brain/`; commands `brain-init`, `brain-source`, `brain-index`, `brain-check`; the `liftoff-brain` skill (Setup,
Ingest, Query, Health check, Retract, Personal, Lessons); Init creates the local structure; Plan reads it, Build offers an
ingest. Built and smoke-run by agents (S1-S8); not piloted. `v0.4.0` was published by hand (clean install, build, test, tag, push `main` then the tag).

## v0.4 lessons loop (released as v0.4.0)

Opt-in `brain.lessons`: personal lessons (`lesson-add`, `lesson-list`), promotion into a marked block of `AGENTS.md` or
`CONSTRAINTS.md` (`lesson-promote`, never git), `brain-check` rules for the blocks, `brain-source --kind lesson`, pilot
metrics (`lesson-metrics`), the Brain skill's Lessons mode, capture in Plan and Build. Built and smoke-run by agents (S9-S14);
not piloted. See `docs/design-notes.md` and `docs/decisions/DECISIONS.md` ("Lessons (0.4)").

## Real-agent smoke runs (state at 2026-11-08)

Done, with a fix committed after each: Connect lead (own/default/customized templates; full L1-L9 with GitLab and a stream), Plan then Build (assisted), Init (new project), Init apply and Connect member (a pasted token is refused), Ticket (epic with story and bug; a story split across a stream and the team's project). **Left:** Build in `manual` mode, Plan/Build on a stream ticket, a teammate blocked by a required change, an epic breakdown. How to run them: `docs/pilot-checklist.md`, last section.

## What is left

- **The pilot** (the README's "Pilot" section): run Init, Connect (lead and member), Plan, Build and Ticket on a real Jira DC and GitLab, in Claude Code and in VS Code Copilot. The manual checklist, with the open questions only the pilot can answer, is `docs/pilot-checklist.md`.
- **Open decisions** (see the top of `docs/decisions/DECISIONS.md`): where the plan file lives, one ticket per project for work across a stream and a team module, the assumed shape of `jira_get_issue` / `jira_create_issue` results.
- **Not built:** the MCP wrapper for chat clients (Claude Desktop), `doctor`, sprint support, stream deadline/WIP warnings, the optional Init add-ons (subagents, hooks, CI, folder reorganization; the wiki is the project brain). Close was dropped: the merge request and the ticket's lane belong to the engineer.
- **Decision rule for the pilot:** if after 4 weeks fewer than half of the group uses Build, revisit the product before adding anything.

## How to work on it

- `npm ci`, `npm run build` (typecheck, bundle, regenerate `plugin/`), `npm test` (unit and e2e). CI checks that the committed `plugin/` equals a fresh build.
- Look at an end-to-end run: `LIFTOFF_E2E_DIR=<dir> npm test` keeps each run's repos, logs and `tickets.json` there.
- Release: a published tag is immutable (a ruleset blocks updating or deleting `v*` tags), and teammates pin to it. `npm run release x.y.z` bumps both versions, builds from a clean install, tests, commits and tags; pushing stays manual.
- Keep a skill and the CLI in step: tests fail when a skill stops naming a CLI code, key or tool.
