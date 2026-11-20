# The living handbook

Status: **built (2026-11-20), phases A, B and C, in version 0.5.0 on `main`, untagged and unpiloted.** Rules 1-8 were decided with the
product owner; rules 9-27 are what the design needed on top of them, reviewed by an Opus design pass (see `DECISIONS.md`). It builds on
the project brain (`src/brain/*`, the Brain skill), which has not been piloted either. Everything that adds a step to Plan or Build is
**off by default** (`practices`, rule 20), so the README's pilot rule holds: nothing changes for a team that does not turn it on.

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

Decided while building, because the design needed them:

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
    LiftOff page `base` (in quotes: twelve digits with no letter would be read as a number; it is the first 12 hex digits of the
    SHA-256 of the title, type, summary, stub mark and body, the body normalized like quotes: NFC, LF, whitespace runs to one space;
    not `updated`, which a team touches on every edit, and not `origin`/`base` themselves). Optional `sources`, `module`. The page id is the file name without `.md`. A practice has the sections
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
20. **The `practices` switch exists from the first release** (decided 2026-11-20, replacing "with the first nudge"):
    `practices: { <id>: on | nudge | off }` in `liftoff.yaml`, the lead's choice and `required` like the other sections. It is not
    empty config because its first entry is a behaviour that already exists, the Ticket flow's PO review
    (`ticket-po-review`, see `ticket-po-review.md`): `off` means the Ticket skill does not ask the why and out-of-scope questions
    and does not require a review file. Every later practice with a step of its own adds its id here; a page without a step
    needs none, because a page is guidance and never a switch.

## What ships in the base

Eleven practices and two convention stubs (thirteen pages), English text, each page under 120 lines. One line each; the text is in
`src/handbook/base/` and is bundled into the CLI through `src/handbook/catalog.json`, which `npm run build` generates.

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
| `lean-output` | practice | Filter test and log output before it enters the context, keep few MCP servers, prefer a CLI the agent already knows. |
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

Read-only unless `--write`, like the brain commands. `--page <id>` and `--reason <text>` are valid only for the handbook commands.

| Command | Does |
|---|---|
| `handbook-init [--page <id>] [--write]` | Plans, and with `--write` creates, the shipped pages that are missing and not retired (with `--page`, only that one: how a new practice is adopted). Never overwrites; refuses past `maxPages`. Writes the index. |
| `handbook-status [--page <id>]` | Per page: status, origin, stub, `drift`; for one page, the three texts (`team`, `original`, `shipped`). Read-only. |
| `handbook-update --page <id> [--write]` | For `update-available` only: the shipped text replaces the untouched copy. Refuses anything else and says why. |
| `handbook-retire --page <id> --reason <text> [--write]` | Writes the `retired.txt` line and deletes the page file. |
| `handbook-seen --page <id> [--write]` | How a skill points at a page: `form` `full` the first two times, then `id`, `none` for a stub or an absent page; the count is personal (`.liftoff/brain/handbook-seen.json`). |
| `clean-review --key <KEY>` | Checks the result of the clean-context review against the ticket's criteria. |
| `pilot-metrics` | The pilot counters that do not need the brain (the PO's review of tickets). |

`brain-check` gains the handbook findings (`handbook-*` codes) and `brain-index --write` regenerates the handbook index too. All of it is a
no-op unless `brain.handbook` is set, and `brain.handbook` joins the `brain` section's hash only when present, so a brain without a
handbook keeps its hash (as for lessons). `parse-ticket` also returns `practices`, `reading.acceptanceCriteria.items` (AC1, AC2, ...)
and `brain.handbook`; `plan` returns `verify`.

## Decisions taken in the build (Opus design review, 2026-11-20)

21. **`practices` section** (`liftoff.yaml`, needs plugin 0.5): ids `ticket-po-review`, `verify-first`, `clean-review`; values
    `on | nudge | off`; `required` optional. An unknown id is an error (a typo ignored in silence is worse), and so is the id of a page
    without a step. Only the keys the lead wrote enter the hash (the defaults live in code), so a default added later never changes a
    config already written. Defaults: `ticket-po-review: on`, `verify-first: off`, `clean-review: off`. `on` performs the step and the
    CLI enforces it with errors; `nudge` offers it in a line and the CLI only warns.
22. **`pilot: { metrics }`** (a new top-level section) switches every pilot counter: `pilot.metrics`, else `brain.lessons.metrics`, else off.
23. **`verify-first`:** the plan carries `- [ ] verify AC<n>: <command> (red first)` in the section that implements the criterion, and
    `- [ ] verify repro: <command>` first for a bug; a manual check is `verify AC<n>: manual: <who> ...`. `plan --key` answers `verify`;
    with `on`, `--approve` is refused with `criterion-unverified`; an approved plan is never invalidated by a change of config.
24. **`clean-review`:** step 6b of Build, after the self-check. On Claude Code the plugin's `liftoff-reviewer` subagent (read-only, no
    `model:`, so it inherits the session's model and never drops to a smaller one); elsewhere a fresh session with a file input. The reviewer
    returns JSON (`criteria` verdicts with evidence, `findings` with kind and severity); the findings are the engineer's, never applied or
    argued away by the agent; fixes are one `<KEY>: review fixes` commit and a `Note:` line, not a new plan section (that would make the
    approved plan stale).
25. **Revisions and stubs:** the plugin keeps the last 5 revisions of a page; while a version is in development a changed text replaces its
    revision, from the next version on it is appended and the old one is never edited. A stub is `status: stub` in the front matter
    (counted in the fingerprint, without the practice sections); the health check lists it (`handbook-stub`), it does not age, agents
    skip it, and removing the mark makes the page `modified`.
26. **Credentials stay an error** anywhere in the brain folder, handbook included (`secret`); only instruction-like and bar-lowering
    text are warnings, and only on pages the team wrote or changed.
27. **Context hygiene** is part of `brain-check` when the handbook is on (`context-size`, `import-no-saving`, `emphasis`, `skill-size`,
    `skill-model`, `hook-count`, `mcp-count`), tuned or turned off in `brain.handbook.context`; see
    `handbook-practice-context-hygiene.md`.

## Order of work

The README's pilot rule stands: if fewer than half of the pilot group use Build after four weeks, the product is revisited before
anything is added. So everything that adds a step to Plan or Build is off by default. What was built, in this order:

1. **Phase A, pages:** the format, `origin`/`base`, `handbook-init`, `handbook-status`, the `brain-check` findings, the index, Query reading
   the handbook, the `practices` section.
2. **Phase B, the steps and the pointer:** `verify-first`, `clean-review`, the one-line pointer with its personal count, the PO review's
   modes.
3. **Phase C, the loop:** `handbook-update`, `handbook-retire`, drift in the health check, the question after a build, the lessons target.
4. **Later (not built, on purpose):** a line-based merge for `both-changed`, a shared company-level base that repos inherit (on the
   README's "Not yet" list), metrics on which practices are read.

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

## The questions that were open (all decided)

All seven were decided with the product owner on 2026-11-20.

1. **Language of the base.** *English only.* The skills and the rest of the repo are English; a team may write its own pages in its
   language, but translating the base would double the update work.
2. **Standalone or inside the brain?** *Inside* (`brain.handbook`, rule 11): it reuses the folder, the check, the index and the
   lessons. The cost is that a team that wants only the handbook also gets a brain section (`brain: { handbook: {} }`). The
   handbook inherits the brain's lack of a pilot, which is why Phase A adds no step to Plan or Build.
3. **The `practices` switch now or with the first nudge?** *Now*, with `ticket-po-review` as its first entry so it is not empty
   config (rule 20). Cost: one more field in the schema and in the hash of `liftoff.yaml`. This also answers open question 2 of
   `ticket-po-review.md` (configurable per team).
4. **Bundle every revision of a page, or only hashes?** *Every revision* (rule 19): without the original text the three-way diff
   is impossible and a two-way diff mixes the team's edits with liftoff's. Growth is bounded by keeping the last N revisions of
   a page (N to be fixed when `handbook-update` is built); a page whose recorded `base` is older than that falls back to a
   two-way diff and says so.
5. **The convention stubs.** *Ship `how-we-test` and `how-we-review`*, marked as not yet filled in: agents skip a stub, and the
   health check lists it as "to fill in" until the team writes it. An empty template with questions gets completed; an absent one
   does not. The marking must be checked against the page format when `handbook-init` is built.
6. **Nudge state.** *A personal count* per page, in a file under `.liftoff/brain/` that is never committed (rule 17): the line
   teaches the first two times and then shrinks to the id. Each machine counts for itself, which is harmless.
7. **Who may retire a base page?** *Any developer, through a merge request that the team's reviewer must accept.* The tool decides
   nothing about roles. A lead who wants to bind it can add a code-owners rule on `<brain.dir>/handbook/` in the code host (liftoff
   may propose the line, never enforces it). The same review applies to editing `How here`, which is a vector for instructions
   like `AGENTS.md`.

## Test plan

Built: unit tests for the page format, the fingerprint, the status table, `handbook-*`, the checks and the context hygiene; packaging
tests (the catalog equals the build, every revision parses and carries its own fingerprint, every page is under the limit, the build
script's fingerprint is the CLI's, no page lowers the bar); skill drift tests (the skills and the reference name the commands, the codes
and the rules, and each exists in the CLI); end-to-end runs through the scripted agent. Smoke runs with agents (`smoke-test`): see
`DECISIONS.md` for what they found. Not done: any run on a real Jira, GitLab or in VS Code Copilot (`docs/pilot-checklist.md`).
