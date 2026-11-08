# LiftOff: handoff

Repo: https://github.com/saugion/liftoff · Last update: 2026-11-08 · Released: **`v0.3.0`** (tag pushed with `main`).

## Where we are

The MVP is built: **Init, Connect, Plan, Build, Ticket flow (with epics), work streams**, and the `build.git` team option.
Everything is covered by ~1200 tests, including end-to-end runs (`test/e2e/`) against a fake Jira, a fake `glab` and a real
git remote. **Nothing has run against a real Jira Data Center, a real GitLab or a real agent following the skills.**

| Piece | Where |
|---|---|
| Config schema, hashes, connectors, streams, `build` | `src/config/`, `schema/liftoff.schema.json` |
| CLI (`validate`, `check-config`, `render`, `connect-info`, `parse-ticket`, `plan`, `draft-tickets`) | `src/cli/`, `src/plan/`, `src/connect/` |
| Skills: `liftoff-init`, `-connect`, `-plan`, `-build`, `-ticket` | `plugin/skills/` |
| Shipped CLI bundle (committed, must equal a fresh build) | `plugin/bin/liftoff.mjs` |
| Specs (design record) | `SPEC*.md` |
| Decisions the agent took alone, to review | `docs/decisions/DECISIONS.md` |

## What is left

- **The pilot** (the README's "Pilot" section): run Init, Connect (lead and member), Plan, Build and Ticket on a real Jira DC and GitLab, in Claude Code and in VS Code Copilot. The manual checklists are at the end of each `SPEC-connect-*.md`. Open questions that only the pilot can answer are listed at the end of the specs.
- **Open decisions** (see the top of `docs/decisions/DECISIONS.md`): where the plan file lives, one ticket per project for work across a stream and a team module, the assumed shape of `jira_get_issue` / `jira_create_issue` results.
- **Not built:** the MCP wrapper for chat clients (Claude Desktop), `doctor`, sprint support, stream deadline/WIP warnings, the optional Init add-ons (subagents, hooks, CI, wiki, folder reorganization). Close was dropped: the merge request and the ticket's lane belong to the engineer.
- **Decision rule for the pilot:** if after 4 weeks fewer than half of the group uses Build, revisit the product before adding anything.

## How to work on it

- `npm ci`, `npm run build` (typecheck, bundle, regenerate `plugin/`), `npm test` (unit and e2e). CI checks that the committed `plugin/` equals a fresh build.
- Look at an end-to-end run: `LIFTOFF_E2E_DIR=<dir> npm test` keeps each run's repos, logs and `tickets.json` there.
- Release: a published tag is immutable (a ruleset blocks updating or deleting `v*` tags), and teammates pin to it. `npm run release x.y.z` bumps both versions, builds from a clean install, tests, commits and tags; pushing stays manual.
- Keep a skill and the CLI in step: tests fail when a skill stops naming a CLI code, key or tool.
