---
title: Pre-mortem on the plan
type: practice
updated: 2026-11-20
summary: Before approving a plan, ask what could go wrong and what it assumes, because a wrong assumption is cheapest to fix before any code.
---

## Why
A plan reads well because it hides what it assumes. Asking "suppose this failed in a month: why?" before approving brings the
assumptions out while changing them still costs a sentence and not a rewrite. It takes a few minutes and catches the errors that
no check can, those in what was chosen.

## When
When the engineer is about to approve a plan, for any ticket that is more than a one-line change.

## How here
- **Add a short "Risks and assumptions" block at the top of the plan**, before the sections, with at most five lines.
- **Ask these questions** and write the answers that matter: What are we assuming about the data, the users, the existing code
  and the other services? What would make this wrong? What is the part we understand least? What breaks if it is slow, empty,
  repeated or concurrent? What can we not undo?
- **Name each assumption so it can be checked**, and say how: a file to read, a query to run, a person to ask. Check the cheap
  ones now.
- **Open points stay open.** A `_TBD_` in the ticket is listed here and settled with the engineer and the product owner before
  the outline, never filled by a guess (handbook: clarify-before-plan).
- **Keep it short.** If the block is longer than the plan sections, the ticket is probably too big (handbook: small-slices).
- **The engineer decides** which risks change the plan. The agent proposes and does not approve its own plan.
- Team detail (risks this repo is known for: migrations, shared state, a fragile integration): add below.

## Example
The plan for PROJ-130 says "assumes the mail service retries on failure" and "assumes tokens are unique per user". Sara reads the
mail client: it does not retry. The plan gains a section with a retry and a check, before any code.

Anti-example: the plan is approved in one read; the missing retry shows up in production a month later.
