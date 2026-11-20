---
title: Clean-context review
type: practice
updated: 2026-11-20
summary: Before the merge request a second agent that has not seen the session re-reads the diff, because the author is the worst reviewer of its own work.
---

## Why
The agent that wrote the change shares the assumptions that produced it, and a long session makes them harder to see. A
reviewer that starts from nothing, with only the diff, the ticket and the quality bar, reads what is there and not what was
meant. It finds the gaps the author cannot.

## When
After the last section of the plan is built and the checks pass, before the merge request text is prepared. Always for changes
that touch more than one module, security, data or an interface; for a one-line fix the engineer may skip it and say so.

## How here
- **Give the reviewer three things only:** the diff (`git diff <target>...HEAD`), the ticket (summary, description, acceptance
  criteria) and `CONSTRAINTS.md`. Not the plan, not the chat.
- **On Claude Code use a subagent**, which starts with a clean context. Give it a model at least as strong as the one that wrote
  the code: do not use the small model for a reviewer.
- **Where there is no subagent** (VS Code with Copilot: whether it has one is **unverified**): the engineer opens a new session
  and pastes the same three things. It costs a few minutes and is worth it on the cases above.
- **Ask for specific things:** is each acceptance criterion met by the diff and by a check? Is anything in the diff not in the
  ticket? Is a rule of `CONSTRAINTS.md` broken? What is untested? Invented functions or options? A secret?
- **The findings come back as a list the engineer decides.** The agent does not apply them by itself and does not argue them
  away. The engineer picks which to fix; fixes are one more plan section and run the checks again.
- **The reviewer reads, it does not write:** it makes no commit and changes no file.
- Team detail (what the reviewer must always look at in this repo, whether the step is mandatory for some modules): add below.

## Example
Build finishes PROJ-123. A review subagent gets the diff, the ticket and `CONSTRAINTS.md` and replies: "criterion 2 has no
check; `retry()` in `mail.ts` is not in the ticket; the new endpoint skips the auth middleware used by its siblings". Sara decides:
add the check, drop `retry()`, fix the middleware. Then she opens the merge request.

Anti-example: the same session is asked "does this look right?" and answers yes, having written it.
