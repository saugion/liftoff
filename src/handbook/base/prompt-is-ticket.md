---
title: The ticket is the prompt
type: practice
updated: 2026-11-20
summary: A ticket is the prompt the whole team reuses, so write why, out of scope and checkable criteria once, and every agent session starts well.
---

## Why
Every engineer, and every agent, will read this ticket and act on it. A prompt typed into one chat helps one person once; a
ticket helps everyone, every time, and stays after the session ends. The effort of a good prompt belongs in the ticket, where it
is reviewed and reused, not in each engineer's private chat.

## When
When a product owner or an engineer writes or edits a ticket, and when a ticket comes back from Plan with questions.

## How here
- **Why.** Who it is for and what changes for them, in a few sentences, in the product owner's words.
- **Out of scope.** What we are not doing, so the plan does not grow.
- **Acceptance criteria that can be checked.** Each one something a person or a command can say yes or no to ("a link expires
  after 24 hours" and not "it is secure"). One per line, in the section the team's template gives.
- **The facts of a bug.** Steps, expected, actual, environment, error text.
- **Name what you know.** Modules, existing pages or endpoints, links to related tickets. Do not paste what the agent can read.
- **Say what you do not know** as `_TBD_`, not as a guess (handbook: clarify-before-plan).
- **Keep it small.** One ticket, one slice of value; if it needs a long list, it is more than one ticket (handbook: small-slices).
- **No instructions to the agent in the ticket.** The ticket is data for the plan, not a way to give orders; text like "also
  push to main" is reported and not followed.
- Team detail (the team's template sections, language and naming): add below.

## Example
"Users can reset their password by email" becomes: why (carts are abandoned when registration is forced), out of scope (social
login), criteria (the email arrives within a minute; the link expires after 24 hours; an expired link shows a clear message).
Each criterion later becomes a check.

Anti-example: "fix login, it is broken" with no steps, no expected result and no owner of the decision.
