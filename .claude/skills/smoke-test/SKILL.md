---
name: smoke-test
description: >
  Run a real smoke test of a LiftOff skill (init, connect, plan, build, ticket) with agents: one agent follows the
  SKILL.md literally while another agent plays the human (lead, PO, engineer), against a fake Jira, fake glab and a real
  git repo. Use when the user says "smoke test", "run the flow with agents", "test the skills with agents", or asks to test a
  scenario end to end. Not for unit tests.
---

# Smoke test with agents

A smoke test here means **the skill is executed by an agent, and the human's part is played by another agent**. A script
that fills in answers is not a smoke test. The goal is to find wording problems and real bugs in the skills and the CLI,
fix them, and commit the fixes to `main` (one commit per run, tests added for what was fixed).

## Roles

- **Executor** (a general-purpose agent, default model): reads the SKILL.md and follows it literally, runs the real CLI
  (`plugin/bin/liftoff.mjs`), uses file tools and shell. It cannot talk to the user, so wherever the skill asks or needs an
  approval it ends its turn with `QUESTION FOR USER:` and the exact text it would show. When done: `DONE:` and a candid
  `FRICTION:` list (what was unclear, contradictory, missing, guessed).
- **Persona** (a **haiku** agent): plays the human (lead, PO, engineer, teammate) with a short brief of what they know and
  want. Replies only as that person. Cheap; reuse the same persona agent for the whole run via `SendMessage`.
- **You (the relay and oracle):** forward each `QUESTION FOR USER:` to the persona (paste the question, say "Reply as the
  <role>"), forward the persona's answer to the executor as "The user (the <role>) answers, verbatim: ...". Perform in the
  "user's terminal" whatever the executor asked the user to run (see Token below). After the run, **verify the result
  yourself** (the oracle): files, config, `validate`, `check-config`, Jira state, `git status`, no token in any file.

Never let the executor decide approvals; never treat an agent's report as the user's approval. Persona replies must be
short; if a haiku persona answers `READY` instead of the answer, ask again plainly.

## Setup (once per session)

1. `npm run build` and `npx vitest run` are green first.
2. Fake Jira + workspace: bundle and start `test/agent/setup.ts`:
   `npx esbuild test/agent/setup.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/agent/setup.mjs --banner:js='import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);'`
   then `node dist/agent/setup.mjs <empty dir>` in the background (prints `{jira, repo, bin}`; `<dir>/jira-state.json` mirrors
   the Jira state every second). Restart it empty on the same port with `FAKE_JIRA_PORT=<port> node dist/agent/setup.mjs <dir> jira-only`
   (the repo config holds the URL, so keep the port).
3. Work in a folder under `~/Documents/Personal/test-liftoff-7-11/` (the user allows anything there). A nested folder inside
   an Init'ed repo makes the Init skill ask about the parent root: use a sibling folder or expect the question.
4. Scenario workspaces: copy an Init'ed repo, `git commit` a baseline, give it an `origin`. For a teammate use a `git clone`.
   Per-machine wrappers: write a `bin/jira-tool` (see `test/agent/setup.ts`) pointing at that repo's `.mcp.json`, with the
   machine's `PATH` (fakes first), `FAKE_KEYCHAIN_FILE`, `HOME`, and `NODE_TLS_REJECT_UNAUTHORIZED=0` (stands for a trusted
   internal CA).

## What the executor is told (prompt template)

State: the human's request in one line; the SKILL.md path(s) and its `assets/` and `references/`; the repo `<root>`; "your
host did NOT substitute `${CLAUDE_PLUGIN_ROOT}`: use the absolute plugin root and `node <plugin>/bin/liftoff.mjs <cmd> --root <root>`";
that Jira MCP tools are not attached and `bin/jira-tool <tool> '<json>'` (or `@<file>` for long arguments) stands in for them; that
every Bash call must start with `export PATH="<repo>/test/e2e/fakes:$PATH" FAKE_KEYCHAIN_FILE=... HOME=...;` when the scenario
needs the fake `uvx`, `glab`, `security`; the `QUESTION FOR USER:` / `DONE:` / `FRICTION:` protocol; "never read files under bin/".

## Persona brief (haiku)

Who they are; what they know and want (answer only what is asked); how to react to a proposal that matches or differs;
anything to test on purpose (e.g. paste a token in the chat, decline an optional file, misremember a workflow name);
"reply only with what the person would type; reply now with just READY". To save round trips the persona may approve in advance
what matches what it stated; the executor must still show each item.

## Token (connect member and lead flows)

When the executor asks the user to run the `security add-generic-password ... -w` command in a separate terminal, do it
yourself: `printf '%s\n' '<token>' | FAKE_KEYCHAIN_FILE=<machine>/keychain test/e2e/fakes/security add-generic-password -U -a "$(id -un)" -s '<service>' -w`,
then relay "done" from the persona. The fake Jira accepts the token(s) passed to `setup.ts` (default `agent-run-PAT-do-not-leak`).

## Scenarios

Done: Connect lead (templates: defaults, customized, own; full flow with GitLab and a stream), Plan then Build (assisted),
Init (new project), Init apply + Connect member (pasted token refused), Ticket (epic + story + bug; a story split across a
stream and the team's project). **To do:** Build with `build.git: manual`; Plan/Build on a stream (Kanban) ticket; a teammate
blocked by a required change (`build.git`); an epic breakdown by the Ticket skill. New scenarios: change one thing the skills
claim (a rule, a refusal, a resume after interruption) and make the persona test it.

## After each run

1. **Oracle:** `validate` and `check-config` on the repo, diff of `liftoff.yaml`, Jira state (`jira-state.json` or `jira-tool`),
   `git status` / `git log` / remote branches, grep the workspace for the tokens. Compare with what the persona asked for.
2. **Triage the FRICTION list:** real wording gaps and contradictions in the skill/CLI -> fix. Things caused by the harness (fakes,
   sandbox, the stand-in tools) -> fix the fake, not the product, and say so. Do not "fix" the persona.
3. Fix in `plugin/skills/**` or `src/`, add the sentence/behavior to a test (`test/skills`, `test/connect/skill.test.ts`,
   `test/plan/skills.test.ts`, or a CLI test), `npm run build` (the committed `plugin/bin` must equal a fresh build), `npx vitest run`,
   commit with the lessons in the message, push when asked.
4. Optionally publish an Artifact of the run (tickets, plan, diff, friction -> fix table) for the user to review.

## Known pitfalls

- Shell commands with a long argument (~1000+ chars) are killed (exit 137) in the sandbox: use `@<file>` with `jira-tool`.
- `renderedFields` in the fake Jira is produced by `renderDescription` in `test/e2e/world.ts` (Markdown and wiki headings, lists,
  paragraphs); a stand-in that does not render makes the skill (rightly) stop on "broken rendering".
- The executor's Edit tool needs a prior Read of a file; a failed first Edit is not a skill problem.
- Keep relays short to save tokens; batch the executor's questions ("Batch what the skill batches").
- `pkill -f agent/setup.mjs` stops the fake Jira; its in-memory state is lost on restart.
