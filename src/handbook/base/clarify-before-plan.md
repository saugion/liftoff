---
title: Clarify before you plan
type: practice
updated: 2026-11-20
summary: Ask what is ambiguous, and what only the product owner can decide, before any outline, because a plan built on a guessed scope is wasted work.
---

## Why
A vague ticket is a vague prompt. If the agent fills the gaps with plausible guesses, the plan looks complete and rests on
decisions nobody took. Two things are never the agent's to decide: why we do this, and what we do not do. Asking costs a
sentence; building the wrong thing costs a ticket.

## When
At the start of Plan, and when a ticket is written (the Ticket flow). Skip only when the ticket already answers everything and
says so.

## How here
- **When writing a ticket,** the agent asks the person two things before it drafts: the **why** (who is it for, what changes for
  them) and the **out of scope** (what we are not doing). Epics and stories ask both, tasks the why, bugs neither. The answers
  are written in the person's own words.
- **What the agent adds on its own is a numbered assumption** (an acceptance criterion it proposed, an edge case, a default). The
  person confirms, changes or drops each one. A single "yes" over a mixed ticket is not a review.
- **A question nobody answers stays `_TBD_`.** The agent never fills it with a guess. The ticket can still be created; the
  warning stays.
- **When planning,** `parse-ticket` lists every `_TBD_` (`openPoints`). Settle each with the engineer and the product owner before
  the outline, or name them at the top of the plan. Never plan work that depends on a scope nobody decided.
- **Ask in one round,** the few questions that change the plan, not a form. If the ticket is clear, say so and go on.
- **Do not turn a question into a fact.** An answer the person gave belongs to the ticket; an answer the agent guessed belongs to
  the assumptions list.
- Team detail (who answers for scope on this team, how long a question may wait): add below.

## Example
Marco asks for "users can reset their password by email". The agent asks why (shoppers abandon the cart when they must register
first) and what is out of scope (social login). It proposes "the link expires after 24 hours" as an assumption; Marco changes it
to 48. He does not know about rate limits, so that section stays `_TBD_`, and Sara's Plan stops on it and asks him.

Anti-example: the agent writes "out of scope: SSO, mobile app" itself because it sounds right, and Marco approves without noticing.
