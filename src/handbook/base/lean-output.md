---
title: Keep tool output lean
type: practice
updated: 2026-11-20
summary: Filter logs before they enter the context and send noisy work to a subagent, because everything in the context is reread on every turn.
---

## Why
A raw test log or a large tool result lands in the context and is then reread on every turn. A passing test run can be
thousands of lines of which the agent needs a few. Tool definitions count too: a server that exposes many tools adds its
definitions to what the agent carries.

## When
When a command prints a lot (tests, builds, logs, a large `git diff`), when you add an MCP server, and when you ask for a
broad search.

## How here
- **Filter before it enters the context.** Ask for the failures only (`grep` for errors, or a runner's quiet mode), or limit the
  tail (`| tail -n 100`). A hook can rewrite a command this way (`PreToolUse` with `updatedInput`). Filter only commands whose
  output you know; cutting the line that explains the failure costs more than it saves.
- **Send verbose, self-contained work to a subagent**: running the full test suite, reading logs, searching documentation. The
  noise stays in its context and only a summary comes back. Do not use one for a small or iterative edit: each subagent starts
  from nothing, is often slower and counts on the same usage limits.
- **Choose the model for the job.** Routine work goes to the middle model, architecture and subtle reasoning to the top one,
  simple search subagents can use the small one (`model: haiku` in the subagent's definition; `CLAUDE_CODE_SUBAGENT_MODEL`
  forces one model for all subagents). The built-in Explore subagent runs on the parent's model: for a cheap one, define your
  own Explore with a small model. The small model gets subtle things wrong, so never use it for judgment, and never for the
  clean reviewer (handbook: clean-review).
- **Prefer a command-line tool (`gh`, `glab`) to an MCP server when one does the job**, and turn off the servers you are not
  using (`/mcp`). With tool search on (the default), tool definitions are deferred and only their names are loaded, so a
  dormant server costs little; keep that setting on. Turning a server off in the middle of a session breaks the cache when tool
  search is off.
- **An MCP result is capped** at 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`) with a warning at 10,000; if you hit it, ask for less.
- **Agent teams cost far more** (about 7x in plan mode, per the vendor's cost page). Use one only for work that is truly
  parallel.
- Team detail (the commands that are noisy in this repo and how to quiet them): add below.

## Example
The API test suite prints 4,000 lines. Marco's agent runs it through a subagent that returns "3 failures: names, first error
line of each". The main session keeps about 200 tokens of it instead of 40,000.

Anti-example: the agent runs the full suite in the main session, three times, to find which test fails.

The vendor's figures for tool search (definitions of 134K tokens cut by 85%, accuracy up from 79.5% to 88.1%) come from a
search snippet and are **unverified**: do not quote them. Whether VS Code Copilot hooks can rewrite or truncate output is
**unverified** and probably not.
