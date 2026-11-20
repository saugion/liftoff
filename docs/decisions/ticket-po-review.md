# Ticket flow: the PO decides, the agent writes

Status: **proposal, not built.** Decided with the product owner on 2026-11-20; the numbered rules below are the decisions, the
rest is the design that follows from them. Nothing here is in the skills or the CLI yet.

## Why

A ticket written by the agent and approved with one "yes" can become a rubber stamp: the PO reads it in a hurry, the
decisions that were theirs (why we build this, what we do not build) were taken by the agent, and the engineer plans on
top of them. The goal is not a nicer ticket. It is that **the PO takes the decisions that belong to the PO**, and the agent
only does the writing. A PO who delegates everything to the AI is the failure this flow is built to prevent.

This is the first piece of a wider direction (automating the habits that separate an engineer who uses AI well from one who
does not; a living team handbook comes later and is out of scope here). Ticket flow comes first because it is the smallest
piece and does not depend on the project brain, which has not been piloted.

## Decisions

1. **Open questions on the why and on the out-of-scope.** Before drafting, the agent asks the person two things only they
   can answer: *why are we doing this* (who is it for, what changes for them) and *what do we NOT do* (out of scope). The
   answers are written **in the person's words**, only fixed for format. The agent never writes these two sections from its
   own idea.
2. **Confirmation for everything else.** What the agent proposes on its own (acceptance criteria, edge cases, defaults,
   technical constraints it took from `AGENTS.md`) is listed as numbered **assumptions**. The person answers each one:
   confirm, change, or drop.
3. **Said by the person, inferred by the agent, kept apart.** The review shows two groups: *what you told me* and *what I
   assumed*. A single "yes" over a mixed ticket is not a review.
4. **A skipped answer stays visible.** If the person does not answer a why or out-of-scope question, the section is left as
   `_TBD_`, never filled with a plausible guess. The ticket can still be created, but `draft-tickets` warns and Plan stops on
   it and asks.
5. **The batch is still approved once**, after the questions and the assumptions. The guarantees of the README do not
   change: nothing is written to Jira before an explicit yes to the exact batch.
6. **Delegation is measured, locally.** A count of "approved with no answer and no edit" is a pilot signal. It stays on the
   machine, like the other pilot metrics.

## Which tickets ask what

| Type | Why | Out of scope | Assumptions |
|---|---|---|---|
| Epic | asked | asked | listed |
| Story | asked | asked | listed |
| Task | asked | optional | listed |
| Bug | not asked (steps, expected and actual are facts the skill already asks) | optional | listed |

This is a starting point; the lead may want it configurable (see open questions).

## The flow, step by step

Changes are to `plugin/skills/liftoff-ticket/SKILL.md`, steps 3 to 5. Steps 1, 2 and 6 do not change.

**3. What (extended).** After the type and the content the person already gave, the agent asks, in one round, the why and
out-of-scope questions that the table above requires. If the person's first message already answers one, the agent
quotes it back and does not ask again.

**4. Draft (extended).** The agent writes from the type's template as today, with two rules: the why and out-of-scope
sections carry the person's answers, and every sentence the agent added that the person did not say is recorded as an
assumption in a local review file, `.liftoff/tmp/review-<n>.json`, next to the drafts file:

```json
{ "tickets": [ { "ref": "#0",
  "said": ["why", "outOfScope"],
  "assumptions": [ { "id": 1, "text": "Reset link expires after 24 hours", "section": "Acceptance criteria", "source": "agent" } ] } ] }
```

**5. Review (extended).** Show, per ticket: the preview, then *what you told me* (the why and out-of-scope, verbatim),
then the numbered assumptions. Ask the person to answer in one message ("1 ok, 2 change to 48 hours, 3 drop"). Apply the
changes to the drafts, run `draft-tickets` again, and only then ask the single batch approval. A change after the yes
asks for a fresh yes, as today.

**What is written in the ticket.** Nothing visible in Jira changes except the two sections. Whether to add a one-line
footer ("Why and scope written by the PO; N assumptions confirmed") is an open question below.

## What the CLI does and what the agent does

Deterministic, tested, in the CLI (`draft-tickets`):

- the required why and out-of-scope sections are present in the template for the type, or the lead is told to teach them
  with Connect;
- a `_TBD_` left in a why or out-of-scope section raises a `po-decision-missing` warning;
- the review file is well formed and every assumption has an answer before the batch is marked ready (a new `review`
  check; the agent cannot skip it by forgetting).

Judgment, in the skill: which statements are assumptions, how to word the questions, how to keep the person's words.

## Plan reads it

Plan already reads the ticket through the reading map. Two additions, in `parse-ticket` and the Plan skill: a `_TBD_` in
the why or out-of-scope section is reported as an open point to settle with the PO before the outline, and Plan does not
invent a scope. This is what gives the PO's answers weight downstream.

## The signal

One local event, written only when pilot metrics are on, with no key, text or name:

```json
{ "e": "ticket-reviewed", "t": "2026-11-21T09:00:00Z", "tickets": 3, "questionsAsked": 4, "questionsAnswered": 4,
  "assumptions": 9, "confirmed": 6, "changed": 2, "dropped": 1, "noEditApproval": false }
```

`noEditApproval` is true when the person answered no question and changed nothing. A high share of those is the alarm
for delegation. "Show my pilot metrics" gains one row. Nothing is sent anywhere.

## Risks

- **Friction.** Every extra question can make the PO stop using Ticket. The README's pilot rule applies: if people bypass
  the flow, revisit it before adding anything. Two questions and one round of assumptions is the ceiling.
- **Nothing stops a PO who wants to click through.** The flow makes delegation visible and a little harder, not impossible.
  The metric is how we find out.
- **Assumption lists get long.** If a ticket produces many assumptions, the draft is probably too ambitious: the skill
  should say so and propose splitting, rather than ask for fifteen confirmations.
- **Unverified against a real agent.** Like the rest of the skills, the wording is tested for rules and drift, not for
  how a real agent follows it. A smoke run with the `smoke-test` skill should come before any release.

## Open questions

1. **Who counts as "the person"?** An engineer filing a bug or a task is not a PO. Same flow, lighter table (above), or
   skip the why for engineers?
2. **Configurable per team?** A `tracker.issueTypes[].poQuestions` list (which sections are asked) in `liftoff.yaml`,
   or fixed in the skill? Fixed is simpler for the pilot.
3. **A visible trace in Jira?** The footer line makes the review auditable and costs one line of noise per ticket.
4. **Metrics without the brain.** Pilot metrics are switched on under `brain.lessons.metrics`, but Ticket works without a
   brain. Move the switch to a top-level key, or keep this signal tied to the brain?
5. **Language.** The questions follow the team's ticket language, as the skill already does for the text.

## Test plan

- Unit: `draft-tickets` warns `po-decision-missing` on `_TBD_` in a required section; rejects a review file with an
  unanswered assumption; accepts one with all answered.
- `parse-ticket`: reports a `_TBD_` why or scope as an open point.
- End to end (fake Jira, as in `test/e2e/`): a story batch with answered questions is created; one with a skipped why is
  created with the `_TBD_` and the warning; one with an unanswered assumption is not created.
- Skill drift test: the skill text mentions the questions, the review file and the single approval.
- A smoke run with agents (`smoke-test`): a PO who answers, a PO who clicks "yes" to everything, and a PO who changes an
  assumption.
