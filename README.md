# LiftOff

LiftOff is a plugin for AI coding agents: Claude Code, and GitHub Copilot in VS Code, IntelliJ and on the command
line. It makes every engineer's agent work the way the team works.

**The problem.** Without it, each engineer explains the team's habits to their agent in their own words, on every
project. The agent does not know where the team puts acceptance criteria in a Jira ticket, how branches and merge
request titles are named, or which checks must pass. So the tickets and merge requests it writes need fixing by hand.

**What LiftOff does.** The team writes its rules once, in one file in the repo (`liftoff.yaml`). Every engineer's agent
reads that file. The agent can then read a Jira ticket, write a plan, write the code and prepare the merge request, the
team's way. The engineer approves every step that leaves the laptop and stays in charge.

**You do not have to edit that file by hand.** Both the product owner and the technical lead set LiftOff up in a **web page that
runs on their own computer** (a setup guide with forms and plain-language questions). The product owner fills in part 1,
the technical lead part 2, and each saves their part to the team with one click, after a yes. The same page, the control
panel, is there for every later change: a ticket template, a new ticket type, the GitLab conventions.

Status: built and tested with automated tests, **not yet used by a real team**. See [Status and limits](#status-and-limits).

## Contents

- [A day with LiftOff](#a-day-with-liftoff)
- [Who does what](#who-does-what)
- [Try it with a fake Jira](#try-it-with-a-fake-jira)
- [Quick start for a team](#quick-start-for-a-team)
- [What LiftOff never does](#what-liftoff-never-does)
- [Words you will see](#words-you-will-see)
- [The setup guide, step by step](#the-setup-guide-step-by-step)
- [Changing the setup later: the control panel](#changing-the-setup-later-the-control-panel)
- [What `liftoff.yaml` holds](#what-liftoffyaml-holds)
- [Optional extras](#optional-extras)
- [Status and limits](#status-and-limits)
- [Pilot](#pilot)
- [More documentation, and working on LiftOff](#more-documentation-and-working-on-liftoff)

## A day with LiftOff

A team builds a web app, with tickets in Jira and code in GitLab. The setup is already done.

1. **The product owner asks for a ticket.** They type *"create a story: users can reset their password by email"*.
   The agent asks the two things only the product owner can decide: why the story matters, and what is out of scope.
   It writes the story on the team's template, lists anything it assumed, and creates `PROJ-123` in Jira only after
   the product owner says yes.
2. **An engineer plans it.** They type *"plan PROJ-123"*. The agent reads the ticket and the code and writes a plan in
   short sections ("add the reset endpoint", "send the email", "tests"), with a check for each acceptance criterion.
   The plan is a local file; nothing goes to Jira. The engineer edits it and approves it.
3. **The engineer builds it.** They type *"build this plan"*. The agent works one section at a time and runs the team's
   checks after each. It asks before it creates the branch and before it pushes. If the ticket changed in the
   meantime, it stops and says so.
4. **The agent hands back a ready merge request.** It checks its work against the acceptance criteria and prints the
   title and description in the team's format, for example `feat(PROJ-123): users can reset their password by email`,
   with the exact command to open it.
5. **The engineer finishes.** They review the code, open the merge request and move the ticket on the board
   themselves. LiftOff never does either.

## Who does what

| Person | When | What they do | What they get |
|---|---|---|---|
| **Product owner** | once per project, about 10 minutes | Part 1 of the setup guide, a page in the browser with forms (no file to edit): the project, the Jira connection, the ticket types and how each ticket is written. Nothing technical. | Tickets written on the team's templates, from a sentence. |
| **Technical lead** | once per project, after the product owner | Part 2 of the setup guide, the same page: the parts of the code, the agents the team uses, git, GitLab and the quality bar. | One set of rules that every engineer's agent follows. |
| **Engineer (teammate)** | once per machine, a few minutes | Runs Init (no questions) and Connect (their own Jira token). | An agent that plans, builds and prepares merge requests the team's way. |
| **Everyone** | every day | Asks in plain words: "create a bug", "plan PROJ-123", "build this plan". | Every step shown first, nothing sent without a yes. |

## Try it with a fake Jira

The quickest way to see everything, with no real Jira, GitLab or token. You need macOS, Docker (running), Node 22.12
or newer, git and Claude Code. From a clone of this repo:

```bash
scripts/fake-setup.sh
```

The script builds the plugin, starts a fake Jira in Docker on `https://127.0.0.1:8443` (project `PROJ`, token
`agent-run-PAT-do-not-leak`, both fake and public), and creates a small project with a git remote in
`~/liftoff-sandbox/my-app`. It prints the command that starts Claude Code with the plugin and the fakes. Then:

1. In Claude Code, say *"I want to set up liftoff for this project"*. The agent prints a local address: open it in
   the browser.
2. Do part 1 as the product owner. Jira address `https://127.0.0.1:8443`, the token above. The page says it does not
   know the certificate and offers to skip the check because this Jira is on your computer: click it. Pick `PROJ` from
   the list, choose ticket types, then **Save and share**.
3. Do part 2 as the technical lead: run `/liftoff:liftoff-init` again, the page opens on the technical part.
4. Try the daily work: *"create a story: ..."*, then *"plan PROJ-123"*.

Stop the fake Jira with `scripts/fake-setup.sh --down`. The full walk-through, and what the fake cannot prove, are in
[`docs/fake-jira.md`](docs/fake-jira.md).

## Quick start for a team

### Requirements

- macOS (the Jira token is kept in the macOS Keychain; Linux and Windows are not supported yet).
- Node 22.12 or newer, and git.
- Claude Code, or GitHub Copilot in VS Code, IntelliJ or on the command line.
- Jira Server or Data Center (not Jira Cloud) and a personal access token. GitLab, for merge requests.
- The Connect skill installs `uv` (it runs the Jira connection) and `glab` (the GitLab command-line tool) with
  Homebrew, after you approve.

### 1. Install the plugin

**The guided setup in the browser is not in a release yet.** Until it is, load the plugin from a clone:

```bash
git clone https://github.com/saugion/liftoff.git
cd <your project>
claude --plugin-dir <path to the clone>/plugin
```

From a release tag, in Claude Code:

```
/plugin marketplace add saugion/liftoff#v0.7.0
/plugin install liftoff@liftoff
```

The tag pins an exact release. `v0.6.0` was the first release with the setup guide; `v0.5.0` was never tagged and its
content shipped in `v0.6.0`. Earlier tags (up to `v0.4.0`) open Init's chat interview instead of the guide. `v0.6.0`
can overwrite a settings file that has comments in it: use `v0.7.0` or newer.

VS Code with GitHub Copilot: turn on `chat.plugins.enabled`, add the marketplace `saugion/liftoff`, install
`liftoff`. Plugin support in VS Code is partly experimental. Copilot in IntelliJ and on the command line are meant to read the
instruction files LiftOff writes (`AGENTS.md`, `.github/copilot-instructions.md`); this, and whether they can run
LiftOff's skills, has not been checked.

### 2. Set up the project, once (product owner, then technical lead)

1. The product owner opens the repo in the agent and says *"set up LiftOff"* (or runs `/liftoff:liftoff-init`). The
   agent starts the [setup guide](#the-setup-guide-step-by-step) and prints an address on `127.0.0.1`. The product
   owner fills in part 1 and saves. The guide commits the setup files to a new branch, `liftoff/setup-po`, and pushes
   it after a yes.
2. The technical lead checks out that branch, runs Init again, and fills in part 2. It saves to `liftoff/setup-tl` the
   same way.
3. The team merges the branches like any other merge request.
4. Optional, for the lead: run `/liftoff:liftoff-connect` and say you are the lead. The agent learns the Jira fields
   and workflow by creating a few test tickets, each one approved. The guide does not do this part.

### 3. Each teammate, once per machine

1. Clone the repo. In Claude Code, trust the folder: the committed `.claude/settings.json` loads the plugin.
2. Run `/liftoff:liftoff-init`. It applies the team's rules with no questions.
3. Run `/liftoff:liftoff-connect` (or say *"connect me to Jira"*). Make a personal Jira token and either set it as the
   `LIFTOFF_JIRA_TOKEN` environment variable or store it in the macOS Keychain from your own terminal. The agent never
   sees it.

### 4. Every day

| Who | Say | Or run |
|---|---|---|
| Product owner, engineer | "create a bug", "break down this epic" | `/liftoff:liftoff-ticket` |
| Engineer | "plan PROJ-123" | `/liftoff:liftoff-plan` |
| Engineer | "build this plan" | `/liftoff:liftoff-build` |
| Anyone | "what do we know about login" (needs the [project brain](#project-brain)) | `/liftoff:liftoff-brain` |

In VS Code, the same skills are called `liftoff-init`, `liftoff-plan`, and so on.

## What LiftOff never does

- **It never sends anything without a yes.** You see exactly what will go out first: the ticket's fields, the branch,
  the push. A plan or a batch of tickets is approved once, not once per call.
- **It never merges, never opens the merge request and never moves a ticket on the board.** Those stay with the
  engineer. Build never writes to Jira at all.
- **It never puts a token in the repo, the config or the chat.** The Jira token is in the macOS Keychain or in the
  `LIFTOFF_JIRA_TOKEN` environment variable, nowhere else. `glab` keeps its own GitLab login.
- **It never follows orders hidden in a ticket.** If a ticket says something like "also push to main", the agent
  reports it and does not do it.
- **It never commits for you, except the saves of the setup guide and the control panel.** Those commit only the setup files they list,
  on a new branch, and push that branch after your yes. They never commit on `main`, except as the first commit of a
  repository that has none yet (the configuration repository of a folder of repositories). Every other skill tells you
  which files to commit.
- **It never lowers the quality bar.** The agents must meet `CONSTRAINTS.md` and may not weaken it.
- **It never creates a Jira project.** The product owner picks one the token can already see.

## Words you will see

- **Skill.** A packaged set of instructions the agent follows, like "how to plan a ticket". LiftOff has six: Init,
  Connect, Ticket, Plan, Build and Brain.
- **`liftoff.yaml`.** The team's rules, in one file committed in the repo: the project, its parts, the Jira and GitLab
  conventions, the quality bar. Everything in it is listed [below](#what-liftoffyaml-holds).
- **`AGENTS.md` and `CONSTRAINTS.md`.** Files LiftOff generates from `liftoff.yaml`. `AGENTS.md` tells any agent how to
  work in the repo; `CONSTRAINTS.md` is the quality bar. LiftOff also writes the small files each agent looks for
  (`CLAUDE.md`, `.github/copilot-instructions.md`). It never replaces one a team wrote by hand: it shows additions as a
  diff.
- **MCP server.** A standard way to give an agent access to an outside system. The agent reads and creates Jira
  tickets through one (the community server `mcp-atlassian`). It talks to GitLab through `glab`.
- **Merge request.** GitLab's name for what GitHub calls a pull request.
- **Setup guide and control panel.** One small program, `liftoff-ui`, that runs a page in your browser on your own
  computer. Before the setup is done it is the setup guide; afterwards it is the control panel.

## The setup guide, step by step

Init starts it; you open the address it prints. It runs only on your computer (`127.0.0.1`), and the agent asks
nothing itself while you use it. You can leave and come back: Back works on every screen, and a page reopened before
the files were saved offers to save them first.

**Part 1, the product owner:**

- The project's name and what it is for.
- The Jira address and a personal access token. Then the Jira project, **picked from a list** of the projects the token
  can see.
- Which ticket types the team uses. You can add types of your own: a name you make up, like "e2e", and the Jira type it
  is created as, like Task. LiftOff tells them apart with the label `liftoff-<name>` (here `liftoff-e2e`) on each ticket
  it creates.
- For each type: how a ticket is written (a ready-made template, the sections of a real ticket, or your own), which
  section holds the acceptance criteria, and what kind of change it is (`feat`, `fix`, `chore`...). The kind of change
  can start the merge request title, as in `fix(PROJ-123): ...`.
- **Save and share**: the page lists the files, commits only those on a new branch `liftoff/setup-po`, and pushes it
  after your yes.

**Part 2, the technical lead:**

- The parts of the code LiftOff found (from `package.json`, Gradle, Maven, Python, Go and Rust files), with their
  languages, frameworks and build, test and lint commands. Fix what is wrong.
- The agents the team uses: Claude Code, GitHub Copilot (VS Code, IntelliJ or command line), or both.
- Who runs git when an agent builds: the agent, with your approval of each step, or only you (the agent hands over
  the commands).
- The ticket types, with any to add.
- The GitLab address and conventions: target branch, branch names, merge request titles (with `{commitType}`,
  `{key}` and `{summary}`, and an example title for each type), labels, reviewers.
- The quality bar (`CONSTRAINTS.md`).
- Save to `liftoff/setup-tl`, the same way.

**The Jira token.** You type it into the page once. It goes into the macOS Keychain, never into a file, a log or the
page's answers. If `LIFTOFF_JIRA_TOKEN` is already set, both pages say so and ask for nothing: they use it and save
nothing in the Keychain. You can still type a different one, which is saved there, but the variable wins while it is set.

**A Jira whose certificate this computer does not know.** If Jira runs on this computer (a test Jira on `127.0.0.1`,
`localhost` or `::1`), the page offers one click to skip the certificate check for it. For any other address it never
skips the check: it tells you to have the company certificate installed on the computer (a company laptop usually has
it already) or to ask the technical lead.

**Not done by the guide:** the test tickets and the Jira workflow (the Connect skill's lead flow learns them), and
the GitLab login (`glab` keeps its own).

## Changing the setup later: the control panel

The same program, once the setup is done (or from the link "Open the full control panel" on the guide's page). Start it
with:

- in the installed plugin: `node <plugin>/bin/liftoff-ui.mjs --root <your repo>`
- from a clone of this repo: `npm run ui -- --root <your repo>`

It shows every section of `liftoff.yaml`: project, parts of the code, Jira (including the ticket types and their
templates: change a template, add a type Jira already has, or make up a new one), GitLab, work streams, quality bar,
and the optional extras. It checks each change with the same rules as the rest of LiftOff and shows the exact change
before it writes anything. What the Connect skill learned (fields, workflow) is kept.

It can also do the whole first setup, in any order, and then does what the guide does:

- it starts from what it finds in the folder (the parts of the code, their languages, the GitLab host);
- you paste the Jira token into it (kept in the macOS Keychain), or nothing if `LIFTOFF_JIRA_TOKEN` already holds one,
  and pick the project from a list;
- before writing, it lists the files that do not exist yet and will be created (`AGENTS.md` files, `CONSTRAINTS.md`).
  A file with content is never replaced;
- it saves the files to a new branch and pushes it, only after your yes. A folder that is not under git itself keeps
  the files but cannot save them this way (see below for a folder of several repositories).

## A folder holding several repositories

**LiftOff is made for one repository (a monorepo).** In a folder that holds several repositories and is not one itself,
building and merge requests do not work across them yet; the Build skill stops and says so.

Both pages say so and offer to make the folder a repository **for the configuration only**. You can skip it (the choice
stays on your computer; the offer comes back only at the point of saving). On your yes LiftOff:

- runs `git init` (branch `main`) in the folder;
- writes a `.gitignore` that ignores **everything except the files LiftOff writes** (`liftoff.yaml`, the `AGENTS.md` and
  `CLAUDE.md` files, the quality bar, the brain folder, the agents' settings files), so that loose files in the folder
  (notes, exports, scripts with keys) never travel by accident. The repositories stay out. What the file already said
  keeps the last word, and a settings file that was there before LiftOff stays ignored, since it may hold your keys. To
  share something else, add a line such as `!/my-folder/**`;
- writes `WORKSPACE.md` with the command that clones each repository, from its `origin` address with any password or
  token removed (an existing `WORKSPACE.md` with content is left alone).

Nothing is committed or sent at that point, and nothing is changed inside the repositories. The first save becomes the
first commit on `main`; to send it to your team, create an empty project on GitLab and add it as `origin`. A colleague
clones that repository, then runs the commands of `WORKSPACE.md` inside it.

Files LiftOff writes **inside** the repositories (their `AGENTS.md`, `CLAUDE.md`) are not part of that save: the pages
list them, and you commit them in their own repository. They also name any file LiftOff wrote that `.gitignore` keeps
out. Only repositories directly below the folder are found.

## What `liftoff.yaml` holds

| Section | What it sets |
|---|---|
| `project`, `stack`, `modules` | The project, its languages and frameworks, and its parts (each gets its own `AGENTS.md`). |
| `agents` | Which agents the team uses: `claude-code`, `copilot`, or both. |
| `constraints` | Where the quality bar lives (`CONSTRAINTS.md`). |
| `tracker` | The Jira Data Center address and project. For each ticket type: its template, where the acceptance criteria are, the fields Jira requires, the workflow steps, and optionally its Jira type (`jiraType`) and kind of change (`commitType`). |
| `codeHost` | GitLab and the merge request conventions: target branch, branch and title patterns, template, labels, reviewers. |
| `build.git` | Who runs git in Build: `assisted` (the agent, after your yes) or `manual` (only you). |
| `streams` | Optional linked work streams (see [Optional extras](#optional-extras)). |
| `practices`, `brain`, `pilot` | The optional extras. |
| `plugin.version` | The minimum plugin version. An older install is stopped with instructions to update. |

**The lead's rules are enforced.** A section can be marked `required: true`. When the lead changes it, every
teammate's LiftOff reports it until they run Init again (one run, no questions). The full list of fields is in
[`schema/liftoff.schema.json`](schema/liftoff.schema.json).

## Optional extras

Each is off, or set to its default, until the lead changes it. None has been used by a real team yet.

- **The product owner decides (on by default).** The Ticket skill asks the *why* and the *out of scope* and never
  invents them. An unanswered one stays a visible `_TBD_` in the ticket, and Plan stops on it. Everything the agent
  added itself is a numbered assumption the product owner answers. Setting: `practices.ticket-po-review` (`on`,
  `nudge` for one quick yes, or `off`).
- **Two extra checks in Plan and Build (off by default).** `verify-first`: each acceptance criterion gets a check that
  is seen to fail before the code exists. `clean-review`: before the merge request, a reviewer that has not seen the
  session re-reads the change against the ticket and the quality bar.
- **Work streams.** A time-boxed Kanban project in Jira (say a 3-6 week roadmap item), created by hand and linked in
  `liftoff.yaml` to the part of the code it feeds. LiftOff then assumes no sprint or story points for it.

### Project brain

A shared wiki in the repo (`brain/`) that the team's agents read before planning and keep up to date, plus personal
notes on each machine that are never committed. The lead turns it on with `/liftoff:liftoff-brain` ("set up the
brain"), each change shown as a diff.

- Plan starts from what the wiki already knows and names the pages it used. If a page and the ticket disagree, the
  ticket wins.
- After a build, the agent offers to add what the ticket taught to the wiki, on the same branch, so the team reviews
  it with the code.
- Every key fact in the wiki is a word-for-word quote from a source kept in `brain/raw/`, and a check verifies each
  quote. This proves the quote is faithful, not that the source is right.
- **Lessons** (`brain.lessons`): the agent keeps your corrections as personal notes ("run the API tests with
  `make test-api`"), never committed. Once you made the same correction on two different tickets, "promote my
  lessons" shows it as a one-line team rule and the exact change; you commit it on a branch and the team reviews it
  like code. A rule that would lower the quality bar is refused.
- **The handbook** (`brain.handbook`): pages of good practice copied into the team's repo, which the team owns and
  edits. A page is guidance; it never lowers `CONSTRAINTS.md`.

## Status and limits

**Built:** Init, Connect, Ticket, Plan, Build and Brain, and the optional extras above. Published tags go up to `v0.4.0`;
**New in `v0.7.0`:** the control panel can do the whole first setup, as the guide does; a folder holding several
repositories can get a repository for the configuration alone; a Jira token already in `LIFTOFF_JIRA_TOKEN` is used
without asking; and settings files that LiftOff cannot read are no longer overwritten. See
[`CHANGELOG.md`](CHANGELOG.md), "0.7.0".

**Tested:** 2,084 automated tests, including end-to-end runs against a fake Jira, a fake `glab` and a real git
remote. Both parts of the setup guide were driven step by step in a simulated page against the real program, the fake
Jira and a git remote. Agents have followed the skills against the fakes in scripted runs.

**Not tested yet:**

- a real Jira Data Center, a real GitLab, or a real team using LiftOff day to day
- the setup guide in a real browser, the real macOS Keychain, and the real `mcp-atlassian` with a company certificate
- GitHub Copilot in IntelliJ and on the command line; VS Code has been looked at only partly
- the control panel's page in a real browser (it is tested in a simulated page)

The manual checks for all of these are in [`docs/pilot-checklist.md`](docs/pilot-checklist.md).

**Supported:** macOS. Jira Server/Data Center through `mcp-atlassian`, one Jira project per repo. GitLab through
`glab`. Claude Code, and GitHub Copilot in VS Code, IntelliJ and on the command line (the last two untested). VS Code
and the Copilot command line take the Jira connection from a project file; in IntelliJ you paste it into the IDE's
settings, and Connect shows you what to paste.

**Not built:** Jira Cloud, Linear, GitHub; token storage on Linux or Windows; sprints, and deadline or WIP warnings for
work streams; one command that checks the whole setup; a way for chat apps without a terminal (like Claude Desktop) to
run the Ticket flow; a company-wide config that repos inherit. There is no "close the ticket" step, on purpose: the
ticket and the merge request stay with the engineer.

**What LiftOff is not:** not an autonomous agent (no "assign it to the AI and walk away", no auto-merge); not CI/CD or
deployment (it stops at a merge request ready to open); not a review bot for teammates' code; not a new IDE. Plan and
Build assume the engineer can read and own the code.

## Pilot

The next step is an internal pilot: 3-5 engineers using Claude Code and Copilot, on 1-2 new projects, for 2-4 weeks, on
a real Jira Data Center and GitLab. We watch how long setup takes, whether people keep using Plan and Build afterwards,
how often merge requests and tickets need edits, and when people go around LiftOff and why.

**Decision rule, set in advance:** if after 4 weeks fewer than half of the group uses Build, we revisit the product
before adding anything else. The checks to run are in [`docs/pilot-checklist.md`](docs/pilot-checklist.md).

## More documentation, and working on LiftOff

- [`docs/fake-jira.md`](docs/fake-jira.md): the fake Jira in Docker, to try everything without a real one.
- [`docs/pilot-checklist.md`](docs/pilot-checklist.md): the manual checks on a real Jira and GitLab.
- [`docs/HANDOFF.md`](docs/HANDOFF.md): where the project stands and what is left.
- [`docs/design-notes.md`](docs/design-notes.md): the reasoning behind choices that are not obvious from the code.
- [`docs/decisions/DECISIONS.md`](docs/decisions/DECISIONS.md): the decisions taken while building, open ones first.
- [`CHANGELOG.md`](CHANGELOG.md): what changed in each release.
- [`schema/liftoff.schema.json`](schema/liftoff.schema.json): everything `liftoff.yaml` can hold.

To work on it: `npm ci`, `npm run build` (type check, bundle, regenerate `plugin/`), `npm test` (unit and end-to-end
tests). CI checks that the committed `plugin/` matches a fresh build.

Open source under the [Apache-2.0](LICENSE) license.
