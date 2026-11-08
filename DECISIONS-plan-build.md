# Plan / Build (MVP): decisions taken in autopilot

Written while implementing (2026-11-08). Each is reversible; the commit is named where it matters.

1. **MVP = Init + Connect + Plan + Build.** The README pilot scope says Close joins later, so Close, the Ticket flow, work streams and `doctor` are not built. If you meant Close inside the MVP, it is the natural next feature (the review transition and the summary comment; the config already has `transitions.review`).
2. **Specs: one file, no fresh-context review.** `SPEC-plan-build.md` covers both skills and both commands; I did not spawn reviewer agents (cost) and approved it myself. Treat it as unreviewed.
3. **Two new CLI commands** (`parse-ticket`, `plan`) although the Connect spec made a new command "Ask first". Needed so the reading map and the approval hash are deterministic and tested, not agent judgment.
4. **Plan lives in `.liftoff/plans/<KEY>.md`, personal and self-ignored**, not committed. README says "lives in the repo"; this is in the repo directory but never committed. Easy to change.
5. **Two dry-runs in Build** (branch + start transition, then push + MR) instead of one, because the MR cannot be previewed before the code exists.
6. **Build does not do the review transition or the ticket comment** (that is Close).
7. **Error codes `no-tracker`, `ticket-invalid`, `plan-missing`, `plan-invalid`** live in their own union, not in v1's `ErrorCode`, so the Init skill's drift test does not have to mention them.
8. **`jira_get_issue` output shape is assumed, tolerant.** Not checked against a live server (see the spec's open question 1).
