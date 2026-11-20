---
title: When not to hand it to the agent
type: practice
updated: 2026-11-20
summary: Let the agent do mechanical work and decide the design yourself first, because an agent builds fast on whatever decision it is given or guesses.
---

## Why
An agent is quick and tireless at work whose shape is already known, and much less reliable where the work is deciding what the
shape should be. If it is handed a design question, it answers with a confident guess, and the guess becomes code. Knowing which
is which is most of the skill.

## When
Before starting a task, and again when an agent session keeps producing changes you have to undo.

## How here
- **Hand it over when the work is mechanical:** a rename across files, a migration with a known pattern, tests for a known
  behaviour, a repetitive edit across modules, boilerplate that follows an existing example, a first draft of docs from code.
- **Decide it yourself first when it is design:** where a responsibility lives, a data model, a public interface, a trade-off
  between two valid approaches, security-sensitive logic, anything with no existing example in the repo. Then give the agent the
  decision, not the question.
- **Use the agent to think, not to choose:** ask for options and their costs, then decide and write the decision in the ticket or
  the plan.
- **A good test:** can you say in two sentences what the diff should look like? If yes, delegate. If not, you are still
  designing.
- **Stop when it fights you.** Two or three failed attempts at the same thing mean the problem is the question; restart with a
  clearer one (handbook: session-hygiene) or do it by hand.
- **Never delegate the responsibility.** What the agent writes, the engineer owns and can explain.
- Team detail (areas this repo treats as design-only, such as auth, billing or migrations): add below.

## Example
"Rename `Order.total` to `Order.amount` everywhere and update the tests" goes to the agent, with the check that the suite passes.
"Should orders and refunds share a table?" does not: Sara decides after hearing the options, writes the decision into PROJ-140,
and only then asks for the migration.

Anti-example: "design the notification system" as a first message, then accepting the first answer.
