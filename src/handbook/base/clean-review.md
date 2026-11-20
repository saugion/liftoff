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
- **Give the reviewer three things only:** the diff (`git diff <target>...HEAD`), the ticket (summary, description, numbered
  acceptance criteria) and the files that state the bar (`CONSTRAINTS.md`, the `AGENTS.md` of the touched modules). Not the plan,
  not the chat. Build writes them to `.liftoff/tmp/clean-review-<KEY>.md` and `.diff`.
- **On Claude Code the plugin's `liftoff-reviewer` subagent** starts with a clean context, reads and searches only, and inherits the
  session's model: do not run a reviewer on a smaller model than the one that wrote the code.
- **Where there is no subagent** (VS Code with Copilot: whether it has one is **unverified**): the engineer opens a fresh session,
  gives it the same input file and saves the JSON it returns. If they would rather not, the hand-over says "clean review not run".
  A review in the session that wrote the code is not a clean review.
- **Ask for specific things:** is each acceptance criterion met by the diff and by a check? Is anything in the diff not in the
  ticket? Is a rule of `CONSTRAINTS.md` broken? What is untested? Invented functions or options? A secret?
- **The findings come back as JSON the engineer decides on** (`criteria` with a verdict and evidence, `findings` with kind and
  severity); `clean-review --key <KEY>` checks its shape and that every criterion has a verdict. The agent does not apply a finding
  by itself and does not argue it away. The engineer picks which to fix and which to refuse (with a reason); the fixes are one commit
  `<KEY>: review fixes` and a `Note:` line in the plan, and the checks run again. A finding that needs a new section goes back to
  the Plan skill.
- **The reviewer reads, it does not write:** it makes no commit and changes no file.
- Team detail (what the reviewer must always look at in this repo, whether the step is mandatory for some modules): add below.

## Example
Build finishes PROJ-123. A review subagent gets the diff, the ticket and `CONSTRAINTS.md` and replies: "criterion 2 has no
check; `retry()` in `mail.ts` is not in the ticket; the new endpoint skips the auth middleware used by its siblings". Sara decides:
add the check, drop `retry()`, fix the middleware, in one commit. The merge request says "Clean review: 3 findings, 3 fixed".

Anti-example: the same session is asked "does this look right?" and answers yes, having written it.
