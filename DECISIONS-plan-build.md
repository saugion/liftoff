# Plan / Build (MVP): decisions taken in autopilot

Written while implementing (2026-11-08). Each is reversible; the commit is named where it matters.

1. **MVP = Init + Connect + Plan + Build.** The README pilot scope says Close joins later, so Close, the Ticket flow, work streams and `doctor` are not built. If you meant Close inside the MVP, it is the natural next feature (the review transition and the summary comment; the config already has `transitions.review`).
2. **Specs: one file, no fresh-context review.** `SPEC-plan-build.md` covers both skills and both commands; I did not spawn reviewer agents (cost) and approved it myself. Treat it as unreviewed.
3. **Two new CLI commands** (`parse-ticket`, `plan`) although the Connect spec made a new command "Ask first". Needed so the reading map and the approval hash are deterministic and tested, not agent judgment.
4. **Plan lives in `.liftoff/plans/<KEY>.md`, personal and self-ignored**, not committed. README says "lives in the repo"; this is in the repo directory but never committed. Easy to change.
5. **Two dry-runs in Build** (branch + start transition, then push + MR) instead of one, because the MR cannot be previewed before the code exists.
6. **Build does not do the review transition or the ticket comment** (that is Close).
7. **Error codes `no-tracker`, `ticket-invalid`, `plan-missing`, `plan-invalid`** live in their own union, not in v1's `ErrorCode`, so the Init skill's drift test does not have to mention them.
8. **`jira_get_issue` output shape is assumed, tolerant.** Not checked against a live server (see the spec's open question 1).
9. **End-to-end tests** (`test/e2e/`): the shipped bundle `plugin/bin/liftoff.mjs`, a real git repo with a bare remote, a **fake Jira DC** (HTTPS with a throwaway self-signed cert, Bearer token check, HTML `renderedFields`, a small workflow), a **fake `mcp-atlassian`** (`test/e2e/fakes/uvx`, stdio MCP honouring `ENABLED_TOOLS`/`READ_ONLY_MODE`), fake `glab` and `security`. A scripted "agent" in the tests performs what the skills say (it is not an LLM). They need `git`, `openssl`, `sh`, Node: all present on the CI image. With `LIFTOFF_E2E_DIR=<dir>` each run's repo, remote and logs are kept there for inspection; I ran them with `~/Documents/Personal/test-liftoff-7-11/e2e` (inside your folder, in subfolders; I touched nothing else there, only ran read-only CLI commands on its root).
10. **Vitest now has two projects** (`unit` with the no-network guard, `e2e` without it, because the fake Jira listens on localhost). `npm test` runs both.
11. The fake MCP's issue shape and the Jira workflow are my approximation of `mcp-atlassian` / Jira DC. The e2e proves the pipeline, not that the real server returns the same JSON (spec open question 1).
12. **Version 0.3.0** (package, plugin, marketplace fragment) for the Plan/Build commands and skills; still untagged and unpushed, like 0.2.0. Tagging `v0.3.0` supersedes the `v0.2.0` tag I suggested: Connect and Plan/Build ship together. The README install section still says `#v0.1.0`; I left it until you tag.
13. **Build is not Close.** Build moves the ticket to the `start` state only. It does not move it to `review`, comment, or link the MR on the ticket.
14. **Not done, on purpose:** Close, Ticket flow, work streams, `doctor`, optional Init add-ons (README pilot scope), and any run against a real Jira/GitLab/LLM agent. The skills' wording is verified by tests for drift and rules, not by an agent actually following them.
15. **What to review first:** the plan file format and location (decision 4), the two-dry-run choice (5), and the assumed `jira_get_issue` JSON shape (8, 11).
