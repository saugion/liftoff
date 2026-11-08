# LiftOff — Handoff

> **Released 2026-11-08 as `v0.3.0`** (tag pushed with `main`): Init, Connect, Plan, Build, Ticket flow (with epics), work streams, `build.git` option. Not yet run against a real Jira DC / GitLab.
>
> **Update 2026-11-08 (latest): Ticket flow (`liftoff-ticket`) and work streams (`streams:`) are in the MVP too, same `0.3.0`; spec `SPEC-ticket-streams.md`, decisions `DECISIONS-ticket-streams.md`, e2e `test/e2e/ticket-streams.test.ts`. Close is dropped (the MR and the ticket's lane are the engineer's); the MCP wrapper for chat clients, `doctor` and sprint support are not built.**
>
> **Earlier: the MVP (Init + Connect + Plan + Build) is implemented as `0.3.0`, untagged and unpushed.** Plan/Build: `SPEC-plan-build.md`; autonomous decisions to review: `DECISIONS-connect.md`, `DECISIONS-plan-build.md`. End-to-end tests (`test/e2e/`, fake Jira/glab, real git) pass; nothing has run against a real Jira DC / GitLab yet. Close, Ticket flow, work streams, `doctor` are not built.
>
> **Earlier update 2026-11-08:** Connect (roadmap 2) is implemented on `main` as version `0.2.0` (not tagged, not pushed). Specs: `SPEC-connect*.md`. Autonomous decisions to review: `DECISIONS-connect.md`. Not yet run against a real Jira DC / GitLab: the manual checklists in the Connect specs are the next step, then `git tag -a v0.2.0`.

Date: 2026-11-07 · Repo: https://github.com/saugion/liftoff

## Where we are

**v1 is built and published as `v0.1.0`** (an annotated tag; a repository ruleset blocks updating or deleting `v*` tags). All five module specs are approved and implemented:

| Module | Spec | Code |
|---|---|---|
| `config-schema` | `SPEC-config-schema.md` | `src/config/`, `schema/liftoff.schema.json` |
| `agent-render` | `SPEC-agent-render.md` | `src/render/` |
| `cli` (`validate`, `check-config`, `render`) | `SPEC-cli.md` | `src/cli/` |
| `init-flow` | `SPEC-init-flow.md` | `plugin/skills/liftoff-init/` |
| `plugin-packaging` | `SPEC-plugin-packaging.md` | `plugin/`, `.claude-plugin/`, `scripts/`, `.github/workflows/` |

614 tests (Node 22 and 24 in CI), `claude plugin validate` passes. The work went in as PRs #1-#5, one per checkpoint.
The Init skill was run by the PM in Claude Code (interview, apply, conflicts): passed.

## What is left

- **The pilot run (T19)**, the part of the manual checklist that needs the published tag: the Claude Code prompt after folder trust, approval prompts, "stay behind" with two tags and two repos on different refs, **VS Code Copilot** (does it read `extraKnownMarketplaces` / `enabledPlugins` from `.claude/settings.json`; re-fetch when the `ref` changes; the skill loading despite `allowed-tools`; the nested-`AGENTS.md` limit), Cowork by URL. Results go to `tasks/pilot-results.md` (local, not committed); a failure becomes a task.
- **Then the pilot's decision rule** (README, "Pilot"): if after 4 weeks fewer than half of the group use Build, revisit the product before adding anything.
- **Known gaps, accepted for the pilot:** a hand-written agent file the user keeps makes `check-config` stay at `warn` (there is no "accepted conflict"); a teammate whose agent is not in `agents.targets` gets a note only; module `AGENTS.md` files are not loaded by VS Code Copilot by default (rules that matter go in the root file).
- **Deferred past v1**, in the order the README roadmap suggests: Connect (roadmap 2), Plan/Build/Close, the Ticket flow; and the optional Init add-ons (subagents, the `implement` orchestrator, hooks, MCP and permission presets, CI workflow, wiki, Graphify, folder reorganization).
- Open questions that only the pilot can answer are listed at the end of `SPEC-plugin-packaging.md` (VS Code re-fetch, `sparsePaths`, a commit SHA as `ref`, Cowork layout).

## How to work on it

- `npm ci`, then `npm run build` (typecheck, bundle, regenerate the files in `plugin/`) and `npm test`. The committed `plugin/` files must equal a fresh build: CI checks it, so commit them with their source.
- Release: on `main` with a clean tree, `npm run release x.y.z` (add `--dry-run` first). It bumps both versions, builds from a clean install, tests, commits and tags; **pushing the commit and the tag stays manual**. `release-check.yml` runs on the tag. A published tag is immutable: teammates pin to it.
- The flow used so far: one branch and one PR per checkpoint, squash merge. `tasks/` (plan, todo, checklist) is local and excluded through `.git/info/exclude`.
- Keep `SKILL.md` and the CLI in step: a test fails if the skill stops naming a CLI code, action or reason.
