---
title: Small slices
type: practice
updated: 2026-11-20
summary: One plan section, one reviewable change, because a big change hides mistakes from both the agent and the reviewer.
---

## Why
The bigger the change, the less anyone reads it. A long diff passes review on trust, and an agent that builds a lot before a
check runs piles error on error. A small slice is checked, committed and reviewed while it is still understood, and a wrong
turn costs one section instead of the whole ticket.

## When
When writing a plan, when Build starts a section, and when a diff grows past what a reviewer would read in one sitting.

## How here
- **One plan section is one change** that builds, passes its checks and can be reviewed alone. It has a short title and says what
  it adds.
- **Indicative sizes, set by the team:** a section touches about 5 files or fewer and a diff of about 300 lines or fewer
  (indicative numbers, not rules; the team changes them below). Past that, split it.
- **Order sections so each one leaves the code working**: the data first, then the logic, then the interface, then the wiring,
  or whatever order keeps the tests green.
- **Do not mix kinds of change in a slice.** A refactor, a behaviour change and a formatting sweep are three slices.
- **If a slice grows while you build it, stop and say so.** Propose the split to the engineer; do not carry on and hope.
- **A ticket that needs many slices** (more than about 8) is probably two tickets; say so in the plan.
- Team detail (the team's size thresholds, how a section maps to a commit): add below.

## Example
PROJ-130 "reset password by email" is planned as: (1) the token table and its migration, (2) the reset endpoint, (3) the email,
(4) the tests for expiry. Section 2 grows into a rewrite of the auth middleware; Build stops, says it is a different change, and
proposes a separate section with its own check.

Anti-example: one commit "reset password" with 42 files, reviewed in four minutes.
