# LiftOff

LiftOff is a plugin for AI coding agents (Claude Code, and GitHub Copilot in VS Code). Without it, every engineer
tells their agent how the team works in their own words, and the agent doesn't know your Jira or your GitLab. With it,
the team writes its rules down once, in one file, and every engineer's agent follows them. The agent can read a
ticket, write a plan, write the code and prepare the merge request, all the way the team does it. The engineer approves
every step and stays in charge.

Current release: **v0.4.0**, built and tested, not yet piloted (the pilot runs on v0.3.0; the project brain is new in v0.4). `main` is at **0.5.0**, unreleased and untagged: the PO's review of tickets, the living handbook and the practices below. See [Status](#status-and-limits).

**What a team gets**

- **The same agent behavior across a mixed team.** One committed file, `liftoff.yaml`, holds the team's rules. Every
  engineer's agent reads it, whichever agent they use.
- **Tickets and merge requests that follow the team's conventions.** The agent reads tickets the way the team writes
  them. It writes tickets on the team's templates and prepares merge requests on the team's branch, title and
  description conventions.
- **The engineer stays in charge.** LiftOff proposes, the engineer approves. LiftOff never merges, never opens the
  merge request and never moves a ticket on the board.
- **The lead sets it up once.** After that, a teammate needs a few minutes per machine: clone, apply, connect.

## A day with LiftOff

A team of four builds a web app. They use Jira for tickets and GitLab for code. Nina is the lead. Marco is the product
owner. Sara is an engineer. Each of them uses an AI agent.

**Once, for the team (Nina, about 30 minutes)**

1. Nina runs `/liftoff:liftoff-init` in the repo. The agent asks a few questions (what the project is, its modules,
   which agents the team uses) and writes the team's rules: `liftoff.yaml`, an `AGENTS.md` with instructions for the
   agents, and `CONSTRAINTS.md` with the quality bar.
2. Nina runs `/liftoff:liftoff-connect`. The agent looks at the team's real Jira tickets and GitLab merge requests and
   learns how the team writes them: where the acceptance criteria go, how branches and titles are named, which
   states a ticket moves through. It creates a few test tickets to prove it got them right.
   Starting a brand-new project with no tickets or merge requests yet? Nina picks a built-in template or lists the
   sections she wants, and answers a few questions about branch and title names. The rest works the same.
3. Nina commits the files. That is the whole setup.

**Once per machine (Sara, about 5 minutes)**

Sara clones the repo, runs `/liftoff:liftoff-init` (no questions, it applies Nina's rules) and
`/liftoff:liftoff-connect` (she makes her own Jira token and keeps it in her own keychain).

**Every day**

1. **Marco asks for a ticket.** He types: *"create a story: users can reset their password by email"*. The agent
   writes it on the team's story template, shows him the full text, and creates it in Jira only after he says yes.
   Result: `PROJ-123`, written the way Sara expects to read it.
2. **Sara plans it.** She types *"plan PROJ-123"*. The agent reads the ticket and the code, and writes a plan in short
   sections ("add the reset endpoint", "send the email", "tests") with a check for each acceptance criterion. The plan
   is a local file. Nothing goes to Jira. Sara reads it, changes what she dislikes and approves it once.
3. **Sara builds it.** She types *"build this plan"*. The agent works one section at a time and runs the team's checks
   after each. In the default mode it shows a preview before every git step: create the branch, commit the section,
   push. Sara approves each one. If the ticket changed in the meantime, or the plan no longer matches it, the agent
   stops and says so.
4. **The agent hands back a ready merge request.** The branch is pushed. The agent prints the merge request title and
   description in the team's format and the exact `glab` command to open it, after checking its own work against the
   acceptance criteria.
5. **Sara finishes.** She reviews the code, opens the merge request with that command and moves the ticket to the
   next column herself. LiftOff never opens the merge request, never merges and never moves a ticket.

**With the project brain (optional, after a few weeks)**

6. **The wiki already knows.** Nina turned on the brain. Sara's next *"plan PROJ-130"* starts from what the team's
   agents wrote down before: the plan names the wiki pages it used, and says so when a page and the ticket disagree
   (the ticket wins).
7. **Sara finishes, and the agent offers a note.** After the build it offers to add the ticket, the plan and the merge
   request text to the wiki, on the same branch, as a quote from each source. Sara reads the pages, says yes, and the
   change reaches `main` in the same merge request that reviews her code.
8. **A correction becomes a rule.** Twice, on different tickets, Sara told the agent to run the API tests with
   `make test-api`. "Promote my lessons" shows the one-line rule and the diff; Sara commits it on a branch and opens a
   merge request, and Nina and the team review it like code.

At no point does the agent act alone. Everything that leaves the laptop (a ticket, a branch, a push) is shown first
and waits for a yes.

## The problem

Teams that use AI agents rebuild the same setup on every project: agent instructions and a quality bar, once per
agent the company allows, slightly different on each machine. The agent doesn't know where the team puts acceptance
criteria, and the tickets and merge requests it writes don't match the team's habits. LiftOff turns that setup into a
shared team config and connects the agent to the tracker and code host with the team's conventions built in.

## How it works

Six skills (a skill is a packaged set of instructions the agent follows). The skills call a small command-line tool
bundled with the plugin, which checks the team's rules. That tool makes no network calls and never handles
credentials. (The optional [control panel](#control-panel-optional) is a separate program that listens only on your own
machine.) The agent talks to Jira through an MCP server (a standard way to give an agent access to an outside
system) and to GitLab through the `glab` command-line tool.

```
 Lead, once per team            Teammate, once per machine      Every day
 ───────────────────            ──────────────────────────      ─────────
 Init     the team's rules      Init     apply them (no        PO/PM or engineer:
          in liftoff.yaml                questions)              Ticket  ──▶ tickets in Jira
 Connect  learn Jira and        Connect  own token, own                      │
          GitLab conventions             machine                Engineer:    ▼
 Commit                                                          Plan ──▶ Build ──▶ merge request
                                                                                    + ticket lane
                                                                                    (engineer's)
```

| Skill | Who | What it does |
|---|---|---|
| **Init** | lead, then each teammate | Lead: a short interview that writes `liftoff.yaml`, the `AGENTS.md` instruction files, `CONSTRAINTS.md` (the quality bar) and the per-agent files (`CLAUDE.md`, `.github/copilot-instructions.md`). Teammate: applies the committed config with no questions. Never replaces a hand-written `AGENTS.md` or `CONSTRAINTS.md`: it shows additions as a diff. |
| **Connect** | lead once, then each teammate | Teammate: checks prerequisites, stores a personal Jira token in the macOS Keychain (or reads it from an environment variable), adds the Jira server entry, verifies Jira and GitLab. Lead, once: sets the team's ticket templates, starting from real tickets, a built-in default or the lead's own sections (and can change one later), and learns the fields, test-creates one ticket per type until each one works, learns the workflow transitions, learns the merge-request conventions from past merge requests, and writes all of it to `liftoff.yaml`. Can also link work streams. |
| **Plan** | engineer | Reads a ticket through the team's reading map (where acceptance criteria and key fields live), reads the repo's rules and code, and writes a local plan in sections. The engineer approves it once. Nothing is written to Jira. |
| **Build** | engineer | Implements the approved plan section by section and runs the repo's checks. Then it self-checks against the acceptance criteria and prepares the branch name, commit messages, the merge-request description and the exact command to open it. |
| **Brain** | lead (setup), engineer, anyone | Optional. The project's second brain: a wiki in the repo that the team's agents read before planning and keep up to date, and a personal layer that is never committed. The lead turns it on once. After that, "what do we know about X" is answered from the wiki, Build offers to add what a ticket taught, and "promote my lessons" turns repeated corrections into reviewed team rules. See [Project brain](#project-brain-optional). |
| **Ticket** | PO/PM, engineer | Writes bugs, tasks, stories and epics on the team's templates, or breaks an epic into tickets. Before it drafts it asks the two things only the person can decide, the **why** and the **out of scope**, and writes them in the person's words (a skipped one stays a visible `_TBD_`); what it added itself is listed as numbered assumptions the person answers. The whole batch is shown together and approved once. Works in the team's Jira project or in a linked work stream. See [The PO decides](#the-po-decides-and-the-living-handbook). |

**Work streams** are optional. A stream is a time-boxed Kanban project (say a 3-6 week roadmap item or an MVP task
force) that someone creates by hand in Jira. The lead links it in `liftoff.yaml` together with the code module it
feeds. Plan, Build and Ticket then never assume a sprint or story points for it. One ticket lives in one project, so
work that touches both a stream's module and a team module becomes two tickets, one per project.

The template a PO/PM writes a ticket with is the same one the engineer's Plan reads it with. The team config is the
contract between who writes tickets and who implements them.

## The PO decides, and the living handbook

Two habits of the engineers who use AI well, built into the flow so a team that has had no AI training gets them anyway.

- **The PO decides, the agent writes.** A ticket the agent writes and the PO approves with one quick yes can hide that the decisions were the
  agent's. So the Ticket skill asks the **why** and the **out of scope** (Epic and Story both, Task the why, Bug neither), never writes them
  itself, and leaves what nobody answered as `_TBD_`, which Plan then stops on. Everything else it added is a numbered assumption the PO
  confirms, changes or drops; the batch is `ready` only when each one has an answer. `practices.ticket-po-review` is `on` by default; `nudge`
  asks the same questions with one yes; `off` goes back to a single approval. A local counter (`pilot-metrics`, no key or text in it) shows how
  many batches were approved with no question answered and no change.
- **The living handbook** (optional, `brain.handbook`): thirteen shipped pages in the team's own repo, copied once so the team owns and
  edits them: eleven practices (verify before you build, a clean-context reviewer, small slices, session hygiene, a pre-mortem on the plan,
  context on demand, lean output, ...) and two stubs to fill in (how we test, how we review). The agents read a page only when a step needs it
  and say once, in a line, why they did something (`handbook: verify-first`). A page is guidance, never a switch: it never lowers
  `CONSTRAINTS.md`. Each page carries its origin and a fingerprint, so a new release brings an **update as a three-way diff**, one page at a
  time, never applied automatically; a page the team retires stays retired. `brain-check` reports stale pages, how far behind the shipped
  ones the team is, and **context hygiene** (an `AGENTS.md` over 200 lines, a skill over 500, too many hooks or MCP servers, shouting in
  capitals): in lines, never tokens.
- **Two steps off by default** (`practices` in `liftoff.yaml`, each `on`, `nudge` or `off`): `verify-first` (every acceptance criterion gets a
  check, seen to fail before the code exists; Plan numbers the criteria AC1, AC2 and refuses the approval while one has none) and
  `clean-review` (before the merge request, a read-only reviewer that has not seen the session re-reads the diff against the ticket and the
  quality bar; the findings are the engineer's to fix or refuse).

## Project brain (optional)

A second brain for the project: a shared wiki in the repo, plus a personal layer on each machine. It is off unless the
lead adds a `brain` section to `liftoff.yaml` (the Brain skill's Setup does it, with a diff to approve).

```
brain/                      committed, reviewed in merge requests like code
  README.md   hot.md        what it is; a few lines of "what is going on now"
  index.md                  generated list of every page
  raw/                      the sources, copied once and never edited (named by their content)
  wiki/                     pages: modules, decisions, learnings, each fact quoted from a source in raw/
  log/                      one line per ingest, retract or fix
.liftoff/brain/             personal, never committed (ignored): hot.md, notes/, lessons/
```

- **Three operations.** *Ingest* adds one source (a ticket, a plan, a merge request description, a file): you see
  the source, then the pages, then the commit, each with its own yes. *Query* answers from the wiki by reading
  the hot notes, the index and only the pages the question needs. *Health check* reports contradictions and stale
  pages and changes nothing. *Retract* removes a wrong source's facts from the pages that cite it.
- **Quotes are checked, not trusted.** Every key fact is a blockquote copied word for word from a raw source, and
  `brain-check` verifies each one against the file. A raw source is written only by a command that never overwrites;
  a later edit shows up as an error. The check proves structure and quotes, not truth: a wrong source gives a
  faithfully wrong wiki.
- **The wiki is background, not instructions.** The ticket, `AGENTS.md`, `CONSTRAINTS.md` and the code win over a page.
  Text in a source or page that tries to give the agent an order is reported and never followed.
- **It plugs into Plan and Build.** Plan reads the brain before the outline and names the pages it used; Build offers an
  ingest after the work (`brain.afterBuild`: `propose` by default, or `off`), as one extra commit on the ticket's branch.
- **A teammate gets it with Init**: the folders and the personal layer are created on the machine; the files the lead
  must commit (an `AGENTS.md` pointer, an optional deny rule for `raw/`) come from the Brain skill's Setup, never from
  a teammate's Init.
- **Honest limits.** The brain has not been piloted. The deny rule for `raw/` is enforced in Claude Code, not in VS
  Code Copilot (there `brain-check` is the guard). A very small brain warns about orphan pages.

### Lessons (optional)

With `brain.lessons` in `liftoff.yaml` (inside `brain`), the agents also learn from corrections, and the team can keep
what repeats. It is off unless the lead turns it on.

- **A lesson** is one behaviour you corrected ("run the API tests with `make test-api`, not `npm test`"), kept as a short
  rule with the exact words you used as evidence, in `.liftoff/brain/lessons/` on your machine. When you correct Plan or
  Build, the agent says so in one line and goes on. Say "forget it" and it is dropped. The lessons are never committed.
- **The count is yours.** A lesson is *ready* when you made the same correction on two different tickets (the lead can
  change that number). Nobody else's corrections are counted; the team never sees your personal files.
- **Promotion is a review, not a sync.** In the Brain skill ("promote my lessons") you pick a lesson, word it for the
  team, see the exact diff and say yes. The rule goes into a marked "Team lessons" block of `AGENTS.md` (or a module's
  `AGENTS.md`, or `CONSTRAINTS.md`), on a branch the tool names, with the commit message. The tool never pushes and never
  opens the merge request: you do, and the team reviews the rule like code.
- **Until the team merges it, a lesson is only data.** Plan lists your own past corrections as reminders and applies
  nothing by itself; only merged rules in `AGENTS.md` and `CONSTRAINTS.md` instruct the agents.
- **It never lowers the bar.** A rule that skips tests, disables checks or lowers a threshold is refused (an accident
  guard, not a guarantee: a team that wants a lower bar edits `CONSTRAINTS.md` by hand). Retiring a rule from the
  constraints block asks an explicit question first. The block holds at most `maxRules` rules (default 20), and rules
  older than `reviewAfterDays` (default 90) are listed as "still true?" in the health check.
- **Ticket text cannot become a rule.** A lesson whose words match the ticket is marked *tainted* and needs its own
  confirmation, and a rule shaped like an instruction to an agent is refused.
- **Pilot metrics** (`brain.lessons.metrics`, on by default): local counters of how many plan sections you changed before
  approving and how many corrections you made. "Show my pilot metrics" prints them by month, with and without the brain
  filled in, with no ticket key, rule, path or name, so you can paste them into the pilot results by hand. Nothing is sent
  anywhere.

## What the lead decides

All of it lives in `liftoff.yaml`, committed in the repo:

| Section | What it sets |
|---|---|
| `project`, `stack`, `modules` | The project, its languages and frameworks, and its modules (each one gets its own `AGENTS.md`). |
| `agents` | Which agents the team uses: `claude-code`, `copilot`, or both. |
| `constraints` | Where the quality bar lives (`CONSTRAINTS.md`). |
| `tracker` | The Jira Data Center URL and project. For each issue type: the reading map, the ticket template, required creation fields, and the workflow transitions for start, review and done. |
| `codeHost` | The GitLab host and merge-request conventions: target branch, branch pattern, title pattern, template, labels, reviewers. |
| `streams` | The linked Kanban work streams, their epics and the module each one feeds. |
| `brain` | Opt-in. `dir` (where the wiki lives, `brain` by default), `hotMaxLines` (15), `afterBuild` (`propose` or `off`) and `required` (a teammate is warned, or blocked, until they run Init). |
| `build.git` | Who runs git in Build. `assisted`: the agent creates the branch, commits each section and pushes, each step only after the engineer approves a preview. `manual`: the agent never runs a git command that writes anything. It hands the engineer the branch name, the commit messages and the commands. |
| `brain.lessons` | Opt-in inside `brain`. `capture` (`notify` by default, `ask` or `off`), `promoteAfter` (distinct tickets before a lesson is ready, 2 by default), `maxRules` (20), `reviewAfterDays` (90) and `metrics` (on). |
| `plugin.version` | The minimum plugin version. An older install is stopped with instructions to update. |

**The lead's rules are enforced.** A section can be marked `required: true`. When the lead changes a required
section, every teammate's LiftOff reports a required change until they apply it again with Init (one run, no
questions). Init marks `constraints` and `build` required by default. Personal things, like tokens, are never in the
config.

## Control panel (optional)

`npm run ui -- --root <project>` starts a local page for the lead, PO or TL (an address on `127.0.0.1` that it prints; open it
in a browser). It shows every section of `liftoff.yaml` (project, modules, tracker, code host, work streams, constraints,
brain), validates with the same rules as the CLI, and shows the exact change before writing. It is the place to change a
project that is already set up, and a stopped session resumes where it left off. It never takes a token or a password.
It is a separate program from the CLI, which still has no network code, and it is not part of the plugin yet.

## Guarantees

- **Approval before every write to an outside system.** You see exactly what will be sent first: ticket fields, branch,
  push. A plan or a batch of tickets is approved once, not once per call.
- **No credentials in the repo, the config or the chat.** You type the Jira token into your own terminal, and it is
  kept in the macOS Keychain or an environment variable. `glab` keeps its own login. The agent never sees either.
- **Nothing is merged or moved by the tool.** The merge request and the ticket's status always belong to the engineer,
  in every git mode. Build never writes to Jira at all.
- **Ticket text is data, not instructions.** If a ticket contains something like "also push to main", the agent
  reports it and does not follow it.
- **Nothing is committed for you.** Init, Connect and the Brain skill tell you which files to commit.
- **The brain's sources are read-only and its quotes are verified.** `raw/` is written only by a command that never
  overwrites, a page's quote must match its source word for word, and the wiki never outranks the ticket and the code.
- **A lesson never weakens `CONSTRAINTS.md`, and nothing is promoted without a review.** Personal lessons are data until the
  team merges the rule; the tool never pushes and never opens a merge request.

## Quick start

Requirements: macOS, Node 22.12 or newer, Claude Code or VS Code with GitHub Copilot. For Connect you also need a Jira
Server/Data Center account and a GitLab account. Connect installs `uv` (it runs the Jira server) and `glab` with
Homebrew, after you approve.

**Install (lead, or anyone installing by hand)**

Claude Code:

```
/plugin marketplace add saugion/liftoff#v0.4.0
/plugin install liftoff@liftoff
```

The `#v0.4.0` tag installs exactly that release. A team already piloting on v0.3.0 stays on its tag until it chooses to move.

VS Code with GitHub Copilot: turn on `chat.plugins.enabled`, add the marketplace `saugion/liftoff`, install `liftoff`.
Plugin support in VS Code is partly experimental, and the pilot will check this path.

**Lead, once per team**

1. In the repo, run `/liftoff:liftoff-init` (in VS Code, the `liftoff-init` skill). Answer up to four questions:
   name and purpose, modules and stack, agents, git mode. Then approve the recap.
2. Run `/liftoff:liftoff-connect` and say you are the lead. Give the Jira URL and project, and the GitLab host. Approve
   each test ticket and each config change. If the agent asks you to restart it, restart and run the skill again: it
   picks up where it stopped.
3. Optional: run `/liftoff:liftoff-brain` and say you are the lead to turn on the project brain (a `brain` section, the folders,
   an `AGENTS.md` pointer, each one a diff you approve), and add `lessons: {}` under `brain` if you want repeated corrections to become
   reviewed rules.
4. Optional: to set up or change `liftoff.yaml` in a form instead of through the skills, run `npm run ui -- --root <your repo>`
   from a clone of LiftOff (see [Control panel](#control-panel-optional)).
5. Commit what the skills list: `liftoff.yaml`, the `AGENTS.md` files, `CONSTRAINTS.md`, `CLAUDE.md`,
   `.github/copilot-instructions.md`, `.claude/settings.json`, `.mcp.json`, `.vscode/mcp.json`.

**Teammate, once per machine**

1. Clone the repo. In Claude Code, trust the folder: the committed `.claude/settings.json` registers the LiftOff
   marketplace and loads the plugin.
2. Run `/liftoff:liftoff-init`: it applies the team config with no questions.
3. Run `/liftoff:liftoff-connect`: make a Jira token, store it from your own terminal, approve the Jira server.

**Every day**

| Who | Skill | Or just say |
|---|---|---|
| PO/PM, engineer | `/liftoff:liftoff-ticket` | "create a bug", "break down this epic" |
| Engineer | `/liftoff:liftoff-plan` | "plan PROJ-123" |
| Engineer | `/liftoff:liftoff-build` | "build this plan" |
| Anyone | `/liftoff:liftoff-brain` | "what do we know about login", "promote my lessons" |

After Build you review the work, open the merge request with the command Build handed you, and move the ticket to its
next lane.

The repo pins the plugin to a release tag in `.claude/settings.json` (`ref`), and to a minimum version in
`liftoff.yaml`. The pin is per user, not per repo, so move all pilot repos to a new release together.

## Status and limits

**Built in v0.4.0:** Init, Connect (member and lead flows), Plan, Build with the `build.git` option, Ticket (with
epics), work streams, and the optional project brain (shared wiki, personal layer, lessons loop).

**Unreleased (on `main`, 0.5.0):** the [control panel](#control-panel-optional) (`liftoff-ui`); the [PO's review of tickets, the living handbook, `verify-first` and `clean-review`](#the-po-decides-and-the-living-handbook), `practices` and `pilot` in `liftoff.yaml`, and the context-hygiene checks. Nothing in them has been piloted, and the steps that add work to Plan and Build are off until the lead turns them on. Not checked anywhere: a real Jira (does `_TBD_` survive its markup?) and VS Code Copilot (the reviewer's fallback and the commands the pages mention): see `docs/pilot-checklist.md`.

**Supported:** Jira Server/Data Center through the community MCP server `mcp-atlassian`, one Jira project per repo.
GitLab through `glab`. macOS. Claude Code and GitHub Copilot in VS Code.

**Tested:** 1,723 automated tests. These include end-to-end runs against a fake Jira, a fake `glab` and a real git
remote, with a scripted stand-in for the agent. **Nothing has run yet against a real Jira Data Center, a real GitLab or
a real agent following the skills** apart from scripted runs where an agent followed the brain and lessons skills against fakes. **The brain and the lessons loop have not been piloted.** Nothing has been measured. The control panel's server is tested end to end; its page has no automated browser test yet.

**Not yet:**

- Jira Cloud, Linear, GitHub
- credential storage on Linux or Windows
- sprint support (assigning sprints), and deadline or WIP warnings for streams
- `doctor` (one command to check the whole setup)
- a server so chat clients without a shell, like Claude Desktop, can run the Ticket flow
- the optional Init add-ons: subagents, hooks, a CI workflow (the wiki is now the optional project brain)
- a company-level shared config that repos inherit from
- the control panel inside the plugin (today it runs from a clone of this repo)

There is also no Close step, on purpose. Updating the ticket and linking the merge request stay with the engineer.

**What LiftOff is not:** not an autonomous agent (no "assign it to the AI and walk away", no auto-merge); not CI/CD or
deploy (it stops at a merge request ready to open); not a code-review bot for teammates' work; not a new IDE or agent
runtime. Plan and Build assume you can read and own the code. PO/PMs use Ticket.

## Pilot

The next step is an internal pilot: 3-5 engineers using both Claude Code and Copilot, on 1-2 new projects, for 2-4
weeks. It covers Init, Connect, Plan, Build and Ticket on a real Jira Data Center and GitLab. What we watch:

- how long setup takes
- whether people keep using Plan and Build after setup (the key signal)
- how often merge requests and tickets need edits
- when people bypass LiftOff, and why

Numbers this small are signals, not statistics, so we talk to every user. **Decision rule, set in advance:** if after
4 weeks fewer than half of the group uses Build, we revisit the product before adding anything else. The manual
checks are in [`docs/pilot-checklist.md`](docs/pilot-checklist.md).

## More, and contributing

- [`docs/HANDOFF.md`](docs/HANDOFF.md): where the project stands and what is left.
- [`docs/pilot-checklist.md`](docs/pilot-checklist.md): the manual checks to run on a real Jira and GitLab.
- [`docs/design-notes.md`](docs/design-notes.md): the reasoning behind the choices that are not obvious from the code.
- [`docs/decisions/DECISIONS.md`](docs/decisions/DECISIONS.md): decisions taken while building. The open ones are
  listed at the top.
- [`schema/liftoff.schema.json`](schema/liftoff.schema.json): everything `liftoff.yaml` can hold.

To work on it: `npm ci`, `npm run build` (type check, bundle, regenerate `plugin/`), `npm test` (unit and end-to-end).
CI checks that the committed `plugin/` matches a fresh build.

Open source under the [Apache-2.0](LICENSE) license.
