# Ticket flow: the PO decides, the agent writes

Status: **built (2026-11-20), including the `practices` switch and the metric; exercised by smoke runs with agents, not yet piloted.** Decided with
the product owner; the numbered rules below are the decisions, the rest is the design that follows from them.

What exists: `draft-tickets` takes a `po` field per ticket and a `--review` file, answers `practice` and `ready`, and with `--approve`
records the metric; `parse-ticket` reports `openPoints`; `pilot-metrics` prints the counters; the Ticket and Plan skills say what to do
with them; unit and end-to-end tests cover it.

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

Engineers who file a bug or a task get the same flow with this table (decided 2026-11-20), so a bug asks nothing about the
why and a task asks the why. The type is matched by its Jira name (`Epic`, `Story`, `User Story`, `Bug`); any other name (a
team that names its types in its own language) is treated like a Task. The lead may want this configurable (open question 2).

## The flow, step by step

Changes are to `plugin/skills/liftoff-ticket/SKILL.md`, steps 3 to 5. Steps 1, 2 and 6 do not change.

**3. What (extended).** After the type and the content the person already gave, the agent asks, in one round, the why and
out-of-scope questions that the table above requires. If the person's first message already answers one, the agent
quotes it back and does not ask again.

**4. Draft (extended).** The agent writes from the type's template as today, with two rules: the description carries the
person's answers as they said them, and each ticket in the drafts file has a `po` object with those same words:

```json
{ "type": "Story", "summary": "...", "description": "...", "po": { "why": "the person's words", "outOfScope": "the person's words" } }
```

Every sentence the agent added that the person did not say is recorded as an assumption in a local review file,
`.liftoff/tmp/review-<n>.json`, with one entry per ticket (an empty list is fine). The person's answer goes into the same file:

```json
{ "tickets": [ { "ref": "#0", "assumptions": [
  { "id": 1, "text": "Reset link expires after 24 hours", "section": "Acceptance criteria", "answer": "confirmed" },
  { "id": 2, "text": "Email in plain text", "answer": "changed", "final": "Email in HTML and plain text" },
  { "id": 3, "text": "Rate limit of 5 per hour", "answer": "dropped" } ] } ] }
```

**5. Review (extended).** Show, per ticket: the preview, then *what you told me* (the why and out-of-scope, verbatim),
then the numbered assumptions. Ask the person to answer in one message ("1 ok, 2 change to 48 hours, 3 drop"). Apply the
changes to the drafts, run `draft-tickets` again, and only then ask the single batch approval. A change after the yes
asks for a fresh yes, as today.

**Create only when `ready`.** `draft-tickets --file <drafts> --review <review>` answers `ready: true` only when every ticket is
valid (`allOk`) and the review is complete. Without a review file it answers `ready: false` with `review-missing`, so the
agent cannot skip the review by forgetting it.

**What is written in the ticket.** Nothing visible in Jira changes except the two sections. Whether to add a one-line
footer ("Why and scope written by the PO; N assumptions confirmed") is an open question below.

## What the CLI does and what the agent does

Deterministic, tested, in the CLI (`draft-tickets`):

- a question the type asks and the person did not answer (absent, blank or `_TBD_` in `po`) raises `po-decision-missing`, a
  warning: the ticket can be created, nothing is guessed. The per-ticket result carries `po` (`answered`, `missing`,
  `not-asked`);
- the person's words must be in the description, whitespace aside (`po-text-not-in-description`, a warning), and are
  checked for credentials like the rest of the ticket;
- the review file is well formed: one entry per ticket, every assumption has an id, a text and one of `confirmed`,
  `changed` (with `final`) or `dropped`; an unanswered one is `assumption-unanswered`. A confirmed or changed text missing
  from the description, or a dropped one still in it, is a warning;
- `ready` is true only when `allOk` and the review is complete.

The check does not require a section of a given name in the template: the template of a team may have none for the why, and
the skill puts the words in the section that fits best (it already did this for scope exclusions).

Judgment, in the skill: which statements are assumptions, how to word the questions, how to keep the person's words.

## Plan reads it

Plan already reads the ticket through the reading map. Two additions, in `parse-ticket` and the Plan skill: any `_TBD_` in
the description is reported as `openPoints` (with the section it sits in) and a `tbd-open-points` warning, and the Plan skill
settles each one with the engineer and the PO before the outline and does not invent a scope. It is not limited to the why
and the out-of-scope, because the CLI cannot know which heading is which in a team's template; any `_TBD_` is a decision
nobody took. This is what gives the PO's answers weight downstream.

## The signal

One local event, written by `draft-tickets --approve` (once per batch, only when the batch is `ready`, the mode is not `off` and pilot
metrics are on), with no key, text or name:

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

All decided on 2026-11-20 (the last four by a design review recorded in `DECISIONS.md`).

1. **Who counts as "the person"?** Engineers get the same flow with the lighter table above.
2. **Configurable per team?** One switch, `practices.ticket-po-review: on | nudge | off` in `liftoff.yaml` (see `handbook.md`, rule 20).
   `on` is the default and is what this document describes; `nudge` asks the same questions but writes the assumptions in the preview
   and takes one yes, with the review file optional; `off` goes back to one approval and no questions (the CLI still checks the shape and
   the credentials of `po`). Which types ask what stays fixed in the skill and the CLI.
3. **A visible trace in Jira?** No. The footer would claim "written by the PO" without the CLI being able to prove it (the agent fills `po`)
   and it adds noise to the template. The trace is local, in the metric.
4. **Metrics without the brain.** A new top-level section `pilot: { metrics }` (needs plugin 0.5). The switch is
   `pilot.metrics`, else the older `brain.lessons.metrics`, else off; it covers every pilot event.
5. **Language.** The questions are asked in the language the person writes in. The ticket text and the assumptions follow the language of the
   team's tickets. The why and the out-of-scope stay in the words and the language they were said in: the agent never translates them and,
   if that language is not the team's, asks once whether the person wants to reword them.

## Test plan

- Unit (`test/plan/po-review.test.ts`, built): `po-decision-missing` for each unanswered question and type; the words must
  be in the description; the review file shape, answers, refs and warnings; `ready` with and without a review; `--review`
  only for `draft-tickets`; `openPoints` in Markdown, Jira wiki and HTML.
- End to end (built): the scripted agent in `new-project` and `templates-smoke` now sends `po` and a review file, and
  every batch must be `ready` before it is created in the fake Jira.
- Skill drift test (built): the Ticket and Plan skills name the questions, the review file, `ready`, the warnings and
  `openPoints`, and each name exists in the real CLI output.
- Still to do: a case where the scripted agent sends a skipped why (created with the warning) and one with an unanswered
  assumption (not created).
- A smoke run with agents (`smoke-test`): a PO who answers, a PO who clicks "yes" to everything, and a PO who changes an
  assumption.
