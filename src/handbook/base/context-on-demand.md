---
title: Give the agent the context it needs, not the repository
type: practice
updated: 2026-11-20
summary: Keep always-loaded rules short and put long guidance in skills or on-demand pages, because everything always loaded is paid on every turn.
---

## Why
Whatever is always loaded is read on every turn of every session. A long `CLAUDE.md` or `AGENTS.md` costs tokens on every turn
and, past a point, the agent follows it less closely. Specific input is cheaper than vague input: "improve the codebase" makes
the agent scan the repository, while a named file and a clear goal do not.

## When
When you write or edit `AGENTS.md`, `CLAUDE.md`, `CONSTRAINTS.md`, a skill, or the first message of a task.

## How here
- **Keep `CLAUDE.md` under 200 lines** (the vendor's advice; longer costs more and is followed less). `AGENTS.md` and
  `CONSTRAINTS.md` follow the same spirit: a few short rules, always loaded.
- **Put specialist guidance in a skill or a handbook page**, not in `CLAUDE.md`. A skill costs only its description until it is
  used; keep the description short (it is cut at 1,536 characters) and the `SKILL.md` under 500 lines.
- **`@import` does not save tokens.** An imported file is loaded in full. Do not split a big `CLAUDE.md` into imports expecting
  it to get cheaper.
- **Rules that apply only to some files** can use `paths:` so they load when those files are touched. They are lost after a
  compaction, so do not rely on them for something that must always hold.
- **Rules that must always hold belong in a hook or a check, not in capital letters.** "IMPORTANT" and "ALWAYS" do not make a
  rule stick; a check does. A failing check the agent must pass before it stops (a Stop hook that exits 2) is stronger than a
  line of prose. After 8 blocks in a row the system lets the agent stop anyway (checked 2026-11-20).
- **In the first message of a task name the module, the files and the goal**, and point at the ticket and the plan. Do not
  paste whole files the agent can read, and do not say "look at the codebase".
- **Keep the number of hooks small.** The vendor's guidance treats more than about forty as a warning sign: they turn into
  rigid preferences nobody remembers.
- A page here is guidance. It never turns a practice off and never lowers the bar in `CONSTRAINTS.md`.
- Team detail (the repo's real size limits, which skills exist): add below.

## Example
Nina's `CLAUDE.md` has grown to 340 lines, half of it "how to write a migration". She moves that half into a skill with a
one-line description. Every session now starts smaller, and the migration guidance loads only when a migration is the task.

Anti-example: she splits the 340 lines into six `@import` files. Nothing gets cheaper; the six files load in full.

Copilot in VS Code: instruction files, skills and custom agents exist there (from search snippets); their exact loading rules,
size limits and whether a `paths:`-style filter exists are **unverified**.
