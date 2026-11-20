---
title: Verify first
type: practice
updated: 2026-11-20
summary: Turn each acceptance criterion into a check that fails before the code exists, so "done" is something a machine can say and not only the agent.
---

## Why
An agent that writes the code and then says it works is grading its own homework. A check that was written first, and seen to
fail, cannot pass by accident: when it turns green, something real changed. It also tells the agent when to stop, and tells the
reviewer what was meant. Without it, "the acceptance criteria are met" is a claim, not a result.

## When
For every plan section that has an acceptance criterion, and for every bug. Not for pure documentation or a mechanical rename
with an existing test suite: say so in the plan and move on.

## How here
- **In the plan.** Each criterion of the ticket has a numbered id (AC1, AC2, ...). The section that implements it carries the item
  `- [ ] verify AC2: <command> (red first)` with the repo's own command and the result that proves it (for example
  `npm test -- cart.spec.ts` fails with "expected 3, got 0", then passes). A bug gets `- [ ] verify repro: <command>` first. A
  check a person does is written as `- [ ] verify AC3: manual: <who> opens <what> and sees <what>`. `plan --key` reports which
  criteria still have no check.
- **Red before green.** Before the code of a section, write or name the check, run it, and see it fail for the right reason. A
  check that passes before the code exists checks nothing: rewrite it.
- **A bug starts with a reproduction.** First a failing test that shows the bug (the steps, the expected and the actual from the
  ticket), then the fix. If you cannot reproduce it, say so and ask; do not fix a bug you have not seen.
- **Build runs the checks** of a section after its code and again at the end, with the repo's own commands from
  `CONSTRAINTS.md`. It shows the real output. It never reports a criterion as met without a run that shows it.
- **If a criterion cannot be checked by a machine** ("the page feels fast", "the wording is friendly"), say so in the plan and
  ask the engineer how it will be verified (a number, a manual step, a person). Do not leave it out and do not invent a check that
  proves something else.
- **A check that cannot fail for the right reason is not a check.** If the only command the repo offers passes after any change at all (a file exists, a build compiles), say so and ask how the criterion will really be checked; do not present it as proof.
- **Never weaken a check to make it pass**: no deleted assertion, no skipped test, no looser threshold. If a check is wrong,
  say why and ask.
- Team detail (the test commands per module, what counts as enough, the manual checks): add below.

## Example
Criterion: "a reset link expires after 24 hours". Sara's plan section 2 adds the check `npm test -- reset-link.spec.ts` with a
case that creates a link, moves the clock 25 hours and expects "expired". It fails ("expected expired, got valid"); then the
agent writes the expiry; the case passes. The merge request description quotes the run.

Anti-example: the agent writes the endpoint, writes a test that calls it and asserts only that it returns 200, and reports the
criteria as met.
