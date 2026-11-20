# The living handbook

Status: **proposal, not built.** Rules 1-8 were decided with the product owner on 2026-11-20; rules 9-20 are what the design
needed on top of them and are **to be confirmed**. Nothing here is in the skills or the CLI yet. It builds on the project
brain (`src/brain/*`, the Brain skill), which has not been piloted either; "Order of work" says what ships first so this does
not double that unknown.

## Why

Companies do not train their engineers to use AI, and the difference between an engineer who uses an agent well and one who
does not is a handful of habits nobody writes down: check before you build, have the work re-read by a reviewer that has not
seen the session, keep slices small, start a fresh session when the old one degrades. LiftOff already automates some of this
inside its skills. What it lacks is the place where a team keeps the *reasons*, adapts them to its own way of working, and
improves them from what actually went wrong.

A handbook that people write once and leave dies. The only handbook that stays true is one the agents **use every day**, because
a stale line then fails in front of someone (a command that no longer exists, a step the team stopped doing) and the failure is
the signal to fix it. So the design is less about the pages than about the loop around them.

## Decisions

Decided (2026-11-20):

1. **The handbook is alive and used by the agents every day.** Plan and Build apply the team's practices and read the page that
   holds the team's version of the step; a stale page therefore fails visibly instead of rotting quietly.
2. **It is built on the brain**, not beside it: pages in the repo, reviewed in merge requests like code, the same health check,
   the same lessons loop, the same log.
3. **Short rules stay where they are.** `AGENTS.md` and `CONSTRAINTS.md` keep the few rules that are always loaded. The handbook
   holds the explanations, examples and cases, loaded on demand, so the always-loaded context does not grow.
4. **Three kinds of content:** practices for working with AI (verify before building, a clean-context reviewer, small slices,
   session hygiene, a pre-mortem on the plan), the team's own conventions, and real cases and anti-patterns.
5. **The base of practices is copied into the team's repo** by Init, so the team owns it and edits it. Each page carries its
   origin (the LiftOff version and a fingerprint of the shipped text). A new LiftOff release brings updates as a **three-way
   diff** (what LiftOff shipped, what the team has, what is new), shown for approval and **never applied automatically**.
   A page the team retires stays retired (a tombstone); LiftOff only says "a new practice exists".
6. **The health check reports drift** ("you are N practices behind", which ones) and imposes nothing.
7. **It improves from five sources:** lessons (repeated corrections), an offer after Build, review comments that keep coming back,
   pilot metrics, and pages not touched for `reviewAfterDays`.
8. **Every change goes through a merge request** the team reviews. The tool never pushes and never opens it.

To confirm (decided here, because the design needed them):

9. **A page is guidance, never a switch.** The behaviour of a skill is LiftOff's, reviewed in LiftOff's repo. A page can add the
   team's detail to a step LiftOff already performs (which commands, which threshold, what the reviewer looks for), and nothing
   else: no new capability, no permission, nothing that lowers the bar. Editing or retiring a page does not turn a practice off;
   a switch in `liftoff.yaml` does (rule 20). This keeps the brain's rule "pages describe, rules belong in `AGENTS.md`" and its
   guarantee that nothing lowers `CONSTRAINTS.md`.
10. **Precedence:** the ticket, `AGENTS.md`, `CONSTRAINTS.md` and the code win over a handbook page, exactly as over the wiki.
11. **A separate page family, inside the brain folder.** `<brain.dir>/handbook/`, opt-in as `brain.handbook` (the way `brain.lessons`
    is), not mixed into `wiki/`. The wiki's pages are *facts* proven by quotes from `raw/`; handbook pages are *practice*
    proven by their origin. Mixing the two would loosen the quote rule for facts.
12. **Trust by declared origin, not by quotes.** Every page says `origin: liftoff@<version>` or `origin: team`. A page that cites a
    real ticket or merge request (a case) may also list `sources` and then its quotes are verified exactly as in the wiki, through
    the same `brain-source` path. A practice has no source to quote, so none is demanded.
13. **Page format.** Front matter (own validator, because the wiki's rejects unknown keys): `title`, `type` (`practice`,
    `convention` or `case`), `updated`, `summary` (one line, 160 characters, used by the index and by the nudge), `origin`, and for a
    LiftOff page `base` (the first 12 hex digits of the SHA-256 of the shipped body, normalized like quotes: NFC, LF, whitespace
    runs to one space). Optional `sources`, `module`. The page id is the file name without `.md`. A practice has the sections
    `## Why`, `## When`, `## How here` (the team's adaptation: this is what the agents read when they apply it) and `## Example`.
14. **Size.** At most 120 lines per page (about 1.5k tokens, so reading one on demand is cheap) and `maxPages` per handbook
    (default 40), the way `maxRules` limits the lessons block. Past the limit `brain-check` errors and a new page is refused until
    one is retired. A page older than `reviewAfterDays` (default 180; practices age slower than the 90-day rules) is listed as
    "still true?" in the health check, a warning that the team settles in a merge request.
15. **Retiring** a page: the file is deleted and its id is written to `<brain.dir>/handbook/retired.txt` (one line: id, date,
    reason), a committed file that merges by union. `handbook-init` and `handbook-update` skip every id in it.
16. **A base page the team rewrites becomes theirs:** setting `origin: team` and removing `base` ends all updates for it. This is the
    explicit way to say "this is ours now".
17. **How a skill points at a page.** When a skill applies a practice it says one line, once, in the form
    `I did <what> because <the page's summary> (handbook: <id>)`, using the page's `summary`; it does not paste the page. The id
    is the stable link a teammate can open. After the first two times the line shrinks to the id alone, kept in a personal file
    under `.liftoff/brain/`, never committed.
18. **No proactive reading of the whole handbook.** The index is read only to answer a "how do we..." question or when a skill
    names a page. This is for tokens and for noise: an always-read handbook is an `AGENTS.md` that grew.
19. **Updates ship per page revision.** The plugin bundles every revision of every base page (small text) so the original that a
    team started from can be recovered, which is what makes the three-way diff possible without relying on git history.
20. **Switches come with the first nudge** that needs one: `practices: { <id>: on | nudge | off }` in `liftoff.yaml`, the lead's
    choice and `required` like the other sections. Not before; until then the pages only explain.

## What ships in the base

Ten practices and two convention stubs, English text, each page under 120 lines. One line each; the text is for the build, not
for this document.

| Id | Type | One line |
|---|---|---|
| `verify-first` | practice | Turn each acceptance criterion into a check that fails before the code exists; for a bug, reproduce it with a failing test first. |
| `clean-review` | practice | Before the merge request, a second agent that has not seen the session re-reads the diff against the ticket and `CONSTRAINTS.md`. |
| `small-slices` | practice | One plan section, one reviewable change; split when a slice touches too many files. |
| `session-hygiene` | practice | One session per ticket, the state in the plan file and not in the chat, and a clean restart when the session degrades. |
| `plan-premortem` | practice | Before approving the plan: what could go wrong, and what are we assuming. |
| `clarify-before-plan` | practice | Ask what is ambiguous and what only the product owner can decide before any outline (the Ticket flow's why and out of scope). |
| `context-on-demand` | practice | Give the agent the module's `AGENTS.md`, the named files and the ticket, not the repository; load more only when asked. |
| `when-not-ai` | practice | Which work is mechanical (let the agent do it) and which is design (decide it yourself first). |
| `review-ai-code` | practice | What a human reviewer looks for in generated code: invented APIs, a change wider than the ticket, tests that assert nothing. |
| `prompt-is-ticket` | practice | A ticket is the prompt the whole team reuses: why, out of scope, acceptance criteria that can be checked. |
| `how-we-test` | convention | A stub the team fills in: commands, layers, what must never be skipped. |
| `how-we-review` | convention | A stub the team fills in: who reviews, what a good merge request description holds. |

Cases are never shipped: they come from the team's own tickets and merge requests.

## The loop, step by step

**Setup (lead).** The Brain skill's Setup gains one optional step: add `handbook: {}` under `brain` (a diff, with the
`plugin.version` raise), then `handbook-init`, which shows the pages it will create and writes only the missing ones on a yes.
A teammate gets the pages by cloning; teammate Init only checks the folder exists.

**Use (every day).** Plan and Build apply a practice and read its page's `## How here` for the team's detail (which commands, which
thresholds). Query ("how do we review?") reads the handbook index, then the page. Where a step fails because the page is out of
date, the skill says which line failed.

**Improve.**
- *After a build:* the existing ingest offer gains one question, "did a practice step fail or feel outdated?". If yes, the fix is a
  diff to that page, with the same approvals as an ingest (the diff, then the commit on a `brain/handbook-<id>` branch).
- *Lessons:* `lesson-promote` gains the target "handbook page" besides `AGENTS.md`/`CONSTRAINTS.md`: a repeated correction that is
  an explanation rather than a rule becomes a dated bullet under `## How here`. Later phase.
- *Review comments that come back:* the engineer pastes them into the Brain skill, which proposes a case or a change to a practice.
  The agent does not read the merge request by itself.
- *Staleness:* `brain-check` lists pages past `reviewAfterDays`.

**Update (lead, when LiftOff releases).** `handbook-status` shows, per base page: `current`, `update-available` (the team's copy is
untouched, so the new text can replace it), `modified` (the team changed it, nothing new), `both-changed` (the team changed it and
LiftOff did too), `new-practice` (never adopted, not retired), `retired`. The lead takes what they want, one page at a time, as a
diff, then the commit on a branch.

## What the CLI does and what the agent does

Deterministic, tested, in the CLI:
- the page structure, the front matter, `origin` and `base` consistency (a LiftOff page needs `base` and a valid version not above the
  installed one, a team page needs neither), sections of a practice, the 120-line and `maxPages` limits, relative links;
- the fingerprint of a body, and from it the **status** of every base page (table above), and the drift count;
- the create-only copy of missing base pages, skipping retired ids; reading and writing `retired.txt`;
- the three texts of a page (original, team, new) for the agent to show, and for `update-available` the replacement itself;
- the generated handbook index, and the review-due warnings;
- the text guards the brain already has: a credential (`source-secret`-style), instruction-like phrases (`instructionLike`) and a
  weakening of the bar (`lessonWeakens`'s list), as **warnings** on a handbook page, because a page is still text a ticket can
  leak into.

Judgment, in the skills: which practice applies to this change, the one-line reason, what the team's `## How here` should say,
how to resolve a `both-changed` page with the lead, whether a repeated review comment is a practice or a case, when to ask to fix a
page after a build.

A clean three-way merge by machine is **not** in the first version: for `both-changed` the CLI returns the three texts and the
agent proposes the merged page as a diff the lead approves. A line-based merge in the CLI can come later if it proves needed.

## New CLI commands

Read-only unless `--write`, like the brain commands. Folded into existing ones where possible so there is less to remember.

| Command | Does |
|---|---|
| `handbook-init [--write]` | Plans, and with `--write` creates, the base pages that are missing and not retired. Never overwrites. |
| `handbook-status [--page <id>]` | Per page: status, `origin`, review due; and the drift count. For one page, the three texts. Read-only. |
| `handbook-update --page <id> [--write]` | For `update-available` only: shows, and with `--write` writes, the new text and the new `origin`/`base`. Refuses a modified page and says why. |
| `handbook-retire <id> --reason <text> [--write]` | Writes the `retired.txt` line and plans the page deletion. |

`brain-check` gains the handbook findings (`handbook-*` codes) and `brain-index --write` regenerates the handbook index too, so the
single health command and the single index command keep covering everything. All of it is a no-op unless `brain.handbook` is set,
and `brain.handbook` joins the `brain` section's hash only when present, so a brain without a handbook keeps its hash (as for lessons).

## Order of work

The README's pilot rule stands: if fewer than half of the pilot group use Build after four weeks, the product is revisited before
anything is added. The handbook must not add a step to Plan or Build before that is known. Proposed order:

1. **Phase A, pages only (ship with the next release, opt-in, no new step in any skill).** The format, `origin`/`base`,
   `handbook-init`, `handbook-status`, the `brain-check` findings, the index, and Query reading the handbook. The base ships with its
   provenance from day one, because adding fingerprints later cannot be done retroactively. No nudges, no updates.
2. **Phase B, nudges.** Each practice's skill step (the Ticket flow's questions, `verify-first`, `clean-review`) arrives with its page
   and the one-line pointer, and with the `practices` switch the first time one is needed (rule 20).
3. **Phase C, the loop.** `handbook-update`, `handbook-retire`, drift in the health check, the after-Build question, the lessons target.
4. **Later:** a line-based merge for `both-changed`, a shared company-level base that repos inherit (already on the README's
   "Not yet" list), metrics on which practices are read.

Phase A is cheap and unblocks everything; B and C depend on what the pilot shows people actually bypass.

## Risks

- **The soft spot is `## How here`.** It is team text the agent reads while acting, so it is an instruction vector like `AGENTS.md`.
  The guards are warnings, not a wall; the real guard is the merge request, and rule 9 limits what a page may do. Say it in the
  Brain skill the way the lessons reference says it.
- **A stale page can still mislead.** The loop makes it visible only when a step fails; a wrong sentence that does not fail anything
  stays. The review-due warning is the backstop.
- **Duplicate of `AGENTS.md`.** The temptation is to put rules in pages. Rule 3 and the size limit hold the line; the health check
  can warn on a page that is mostly imperatives.
- **Unpiloted foundation.** The brain, the lessons and now the handbook have no real use yet. Phase A is deliberately small for this.
- **Drift between teams.** After a year each repo has a different handbook and old practices the team never adopted; the drift report
  says so, it cannot make anyone adopt.
- **Nudge noise.** One line, once or twice, then the id. If people stop reading it, switch it to `off` (rule 20).
- **Copilot parity.** `clean-review` needs a second agent with a clean context; Claude Code can do it with a subagent, VS Code
  Copilot is not verified. A page for it must say what to do without one.
- **Tokens.** The handbook is read on demand and each page is capped, so the cost is the nudge line plus the one page a step needs.

## Open questions

1. **Language of the base.** English only (the skills and the rest of the repo are English), or also Italian pages for Italian teams?
   Recommended: English only, and the team may write its own pages in its language; translating the base doubles the update work.
2. **Standalone or inside the brain?** Recommended: inside (`brain.handbook`), as decided in rule 11, so it reuses the folder, check,
   index and lessons. The cost is that a team that wants only the handbook gets a brain section too (`brain: { handbook: {} }`).
3. **The `practices` switch now or with the first nudge?** Recommended: with the first nudge (rule 20), so Phase A adds nothing to
   `liftoff.yaml` beyond `handbook`.
4. **Bundle every revision of a page, or only hashes plus a two-way diff?** Recommended: every revision (rule 19); the text is small
   and the three-way diff is the point of the copy-into-repo choice.
5. **The convention stubs.** Ship `how-we-test` and `how-we-review` empty, or leave conventions entirely to the team? Recommended: ship
   the two stubs, because an empty template gets filled and an absent one does not.
6. **Nudge state.** A personal "seen" count per page is one more file; the alternative is a fixed one-line pointer every time.
   Recommended: the personal count, kept off the repo.
7. **Who may retire a base page?** The lead only (as for `liftoff.yaml`), or any engineer through a merge request? Recommended: any
   merge request, reviewed like code; the tool decides nothing about roles.

## Test plan

- Unit: the front-matter validator (all keys, types, `origin`/`base` consistency, size limits); the body fingerprint (CRLF, whitespace,
  NFC); the status table, one case per status; `handbook-init` creates only missing pages and skips retired ids; `retired.txt` read
  and written; `handbook-update` refuses a modified page and replaces an untouched one; the guards fire as warnings; `brain-check`
  without `brain.handbook` is byte-identical to today (a golden test); the config hash of a brain without a handbook is unchanged.
- Packaging: the bundled catalog equals the shipped pages, every revision's recorded hash matches its text, every page is under the
  size limit, every id the skills name exists in the catalog (a drift test like the one for the CLI contract).
- End to end (fake Jira and `glab`, real git): Init copies the base on a lead's yes; a teammate clones and sees it; the team edits a page;
  a newer bundled revision makes it `both-changed`; the lead retires another page and a later `handbook-init` does not bring it back;
  `brain-check` stays `ok` after each step.
- Skill drift: the Brain and Init skills name the new commands, the `origin` rule and "a page is guidance, never a switch", and each name
  exists in the real CLI output.
- A smoke run with agents (`smoke-test`): a lead who sets it up, an engineer whose page step fails because the page is stale and who
  accepts the fix, and a lead who updates one page and declines another.
