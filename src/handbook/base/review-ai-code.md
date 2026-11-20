---
title: Reviewing AI-written code
type: practice
updated: 2026-11-20
summary: Look for invented APIs, changes wider than the ticket and tests that assert nothing, because generated code fails in ways human code rarely does.
---

## Why
Generated code reads fluently, which makes errors easy to miss. It fails in typical ways: it calls functions or options that do
not exist, it changes more than was asked, it writes tests that pass whatever the code does. A reviewer who knows these looks in
the right places.

## When
Whenever you review a merge request that an agent wrote or helped to write, including your own.

## How here
- **Invented APIs.** For each call into a library or an internal module, check it exists with that signature in the version the
  repo uses (open the definition or the docs; a green build helps but dynamic code can hide it).
- **A change wider than the ticket.** Compare the diff with the acceptance criteria: every file and hunk should trace to one.
  Unrelated formatting, renames and "improvements" go to their own ticket.
- **Tests that assert nothing.** A test must be able to fail: look for missing assertions, assertions on the mock itself, `expect`
  on a value just set, tests that mirror the implementation line by line. Ask whether the check was red before the code
  (handbook: verify-first).
- **Dead and duplicate code.** Unused parameters, branches that cannot run, a helper that already exists elsewhere in the repo.
- **Error handling and edges.** Empty, null, repeated, large, concurrent. Swallowed exceptions and broad `catch`.
- **Secrets and data.** Keys, tokens, URLs with credentials, personal data in logs or fixtures. None in the diff, none in the
  description.
- **Quality bar.** Check each rule of `CONSTRAINTS.md`. A skipped test or a lowered threshold is a finding, not a style choice.
- **Say what you did not check.** A review that lists its limits is worth more than one that sounds complete.
- Team detail (the checklist this team adds: logging, i18n, accessibility, performance budgets): add below.

## Example
The merge request adds `client.retryWithBackoff({ jitter: true })`. Marco opens the client: there is no `jitter` option, and the
call is ignored silently. He also finds a test that only asserts the mock was called. He asks for both to be fixed.

Anti-example: "the build is green, the diff looks tidy, approved".
