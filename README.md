# LiftOff

> Start every project AI-native. Turn every ticket into a PR on your team's standards. Stay the engineer in charge.

LiftOff is a plugin for software engineers who work with AI coding agents. It sets up a repository so agents understand it, connects the agent to the tools where work is defined and delivered (Jira/Linear, GitHub/GitLab), and keeps the daily loop — ticket → plan → code → PR → ticket — AI-assisted without taking the engineer out of it.

**Status:** brainstorm / product definition. Stack being defined — see [Stack (draft)](#stack-draft).

---

## The problem

Engineers who use AI agents seriously spend hours on every new project before writing a line of product code:

- writing `AGENTS.md` / agent instructions, module structure, subagents, quality bar, hooks, MCP servers;
- repeating all of it for the next project, and again for each agent the company allows (Claude Code, Copilot, …);
- gluing the agent to the issue tracker and the code host by hand: it doesn't know where the team puts acceptance criteria in a ticket, and it writes PRs and ticket updates that don't follow the team's conventions;
- every teammate redoing the same setup on their own machine, slightly differently.

## Who it's for

**The software engineer who owns the code.** Someone who reads, reviews and is accountable for what ships.

Not for vibe-coders, not for non-engineers. The team benefits as a side effect: configuration is shared and committed, so everyone's agent behaves the same way.

**Secondary user: the PO/PM**, for the [Ticket flow](#ticket-flow) only. Tickets are mostly written by the PO/PM; the engineer files bugs or proposes tasks now and then. Init, Plan, Build and Close stay engineer-only.

## Core principle: the engineer owns the work

LiftOff **proposes, the engineer decides.**

- Every write to an external system — ticket, comment, status change, branch, PR — is shown first and applied only on approval.
- **Dry-run on every write:** the approval step shows exactly what will be sent — fields, body, target — before anything leaves the machine.
- **One approval per decision, not per API call.** A plan with 120 sections is approved once; the PR and its ticket updates are approved together.
- No "assign the ticket to the AI and walk away". No auto-merge.
- The tool removes setup and glue work. It does not abstract the engineer away from their job.

## How it works

```
Development flow (engineer):
Init ──▶ Connect ──▶ Plan ──▶ Build ──▶ Close
 repo     tracker +    ticket →   plan →    ticket +
 setup    code host    local plan PR        PR updated

Ticket flow (PO/PM, engineer):
Ticket ── bug / task / story on the team's templates
```

### 1. Init — make the repo AI-native

Built on the `project-init` skill. Detects whether the project is new or existing, then sets up:

- the team config, `liftoff.yaml`;
- module structure and root + per-module `AGENTS.md`;
- `CONSTRAINTS.md` (the quality bar);
- the thin per-agent files (`CLAUDE.md`, `.github/copilot-instructions.md`), rendered from the config and pointing to `AGENTS.md`;
- the plugin recommendation in `.claude/settings.json`, so teammates are prompted to install it.

**Coming after v1, as optional add-ons:** suggested subagents and an implementation orchestrator, hooks, MCP and permission presets, a CI workflow, the wiki and Graphify, and reorganizing an existing repo's folders.

**Agent choice.** The engineer picks the target agent(s) — Claude Code, GitHub Copilot, more later — and can pick **several**. Init generates the right files for each one, from the same source (see [Agent support](#agent-support)). Many companies mandate a specific tool, and many teams are mixed; LiftOff adapts instead of fighting it.

**Team config.** See [Team config](#team-config) — if one exists, Init applies it instead of running the full interview.

### 2. Connect — learn the team's tools

**LiftOff doesn't write its own API clients.** Each external system is reached through an **MCP server**: the official one when it exists and fits, otherwise the best-supported community one. LiftOff picks the right server for the target, configures it for the chosen agent(s), and wires the auth (OAuth or access token) the server expects. On top of it, LiftOff adds what MCP servers don't have: **the team's conventions and the approval layer.**

Each connector has its own **onboarding**. Onboarding doesn't just authenticate — it learns the house conventions, so the agent reads tickets the way the team writes them and everything it writes looks like the team wrote it.

| Connector | MCP server | Auth | Onboarding learns |
|---|---|---|---|
| **Issue tracker** — Jira Cloud, Jira Server/DC, Linear | see [Tracker MCP servers](#tracker-mcp-servers) | OAuth or access token, as the server supports | project, team, issue types; from **one sample per type** (task, story, bug, …) **how tickets are structured** — where the description, acceptance criteria and relevant custom fields live; workflow transitions per project; comment conventions |
| **Code host** — GitHub, GitLab (cloud & self-hosted) | MCP server **or CLI** — see [Code host access](#code-host-access) | OAuth or access token, as the server / CLI supports | branch naming, PR/MR template, labels, default reviewers, target branch — inferred from existing PRs |

On-prem / self-hosted with personal access tokens is a first-class case, not an afterthought. Which MCP server backs each connector is part of the team config, so a company can pin an approved one.

#### Tracker MCP servers

Supported from day one:

| Target | MCP server | Type | Auth |
|---|---|---|---|
| **Jira Cloud** | [Atlassian Rovo MCP server](https://github.com/atlassian/atlassian-mcp-server) — remote, `https://mcp.atlassian.com/v2/mcp` | official | OAuth 2.1 (interactive) or API token (must be enabled by the org admin) |
| **Jira Server / Data Center** (v8.14+) | [`sooperset/mcp-atlassian`](https://github.com/sooperset/mcp-atlassian) — local (`uvx`, Docker) | community, MIT | Personal Access Token |
| **Linear** | [Linear MCP server](https://linear.app/docs/mcp) — remote, `https://mcp.linear.app/mcp` (read-only variant: `/mcp/readonly`) | official | OAuth 2.1 (interactive) or API key as Bearer header |

`sooperset/mcp-atlassian` also supports Jira Cloud (API token); a team may pin it for both if it prefers one server everywhere. The official Atlassian server is Cloud-only.

#### Code host access

For code hosts, LiftOff supports **two modes: MCP server or official CLI**. The CLIs are mature, handle self-hosted instances well, and every agent can run shell commands — so they fit the "build on what agents have in common" principle. The team config pins the mode per code host.

| Target | MCP server | CLI |
|---|---|---|
| **GitHub.com / GHE.com** | [GitHub MCP server](https://github.com/github/github-mcp-server) — official, remote `https://api.githubcopilot.com/mcp/`; OAuth or PAT | [`gh`](https://cli.github.com/) |
| **GitHub Enterprise Server** | same server, **local only** (Docker), with `GITHUB_HOST`; PAT | `gh` with `--hostname` |
| **GitLab.com / self-managed** | GitLab built-in MCP — official, `https://<instance>/api/v4/mcp`; OAuth. Beta (since 18.6), Premium/Ultimate only, must be enabled by an admin | [`glab`](https://gitlab.com/gitlab-org/cli) with `--hostname` |

Where the official GitLab MCP isn't available (Free tier, older instance, not enabled), **`glab` is the default**.

**CLI mode requires installation**: it's a step of the **team member onboarding** — LiftOff checks whether `gh` / `glab` is installed, guides the install if not, and runs the CLI's own login (`gh auth login` / `glab auth login`) against the right host. Credentials then live in the CLI's own store. `doctor` checks the CLI is installed, authenticated and pointing at the right host.

#### Onboarding validation (lead, at the real Init)

Real trackers are messy: workflow validators require fields the metadata API doesn't declare, Jira Server/DC uses wiki markup while Cloud uses ADF, transitions differ per project. Templates only become reliable by trying them. This is **the lead's job during the real Init**, and LiftOff guides it:

1. **Start from what exists** — the lead's existing example tickets, plus samples and API metadata.
2. **Test-create one ticket per type** through LiftOff, on approval (in a test project, or in the real one with a `[LiftOff test]` title, closed right after).
3. **Learn from errors** — when a create fails or renders badly, LiftOff reads the tracker's error / result, shows what's wrong (missing field, broken formatting) and proposes the template fix.
4. **Repeat until every type passes**, then write templates, text format (wiki markup / ADF / Markdown) and per-project transitions into the team config.

After Init, a failure for a teammate never gets fixed silently on their machine: LiftOff proposes the fix as a config change for the lead.

**Conventions are part of the team config.** Onboarding runs once — usually by the lead during the first Init — and its output (a reading map per issue type, workflow transitions, ticket templates for the Ticket flow, the PR/MR template and conventions) is stored in the config. Engineers get it all pre-set.

The lead builds them from, in order:
1. **Existing samples** — one ticket per type, existing PRs.
2. **System metadata** — fields per issue type and workflows from the Jira/Linear API, PR template file already in the repo.
3. **Pasted example** — a ticket or PR from another project the lead likes.
4. **Built-in defaults** — sensible task / story / bug / PR conventions, to edit and approve.

**Credentials** are never held by LiftOff. OAuth sessions live in the agent client, CLIs use their own credential store, and access tokens for local MCP servers (e.g. a Jira DC PAT) live in the OS keychain (macOS Keychain, Windows Credential Manager, libsecret) and reach the server as env vars. Never in plain files, never in the config: the config only names the endpoint (e.g. `jira: https://jira.company.local`). Onboarding wires this up; `doctor` checks the credentials exist and are still valid.

### 3. Plan — ticket → local plan

The engineer picks a ticket. The agent reads it — using the learned reading map to find description, acceptance criteria and relevant fields — and produces an **implementation plan**, split into as many sections as needed (12 or 120).

- The plan is **local**: it lives in the repo as input for Build. Nothing is written to the tracker.
- The engineer reviews, edits and **approves the whole plan in one step**.

### 4. Build — plan → PR

The agent implements the approved plan using the repo's `AGENTS.md`, constraints and subagents, then prepares a branch and PR following the code host conventions. The engineer reviews the work.

Side writes — ticket to "In Progress", branch, PR — are **approved together** in one dry-run.

### 5. Close — keep everything in sync

Ticket status, PR link and summary comment are updated, approved **together** in one dry-run.

### Ticket flow — write tickets on the team's standards

Separate from the development flow above. Creates bugs, tasks and user stories following the team's templates (`liftoff ticket`).

- **Who:** the PO/PM writing stories (including breaking an epic into several tickets), and the engineer filing a bug or proposing a task.
- **Same config, both directions:** the template the PO/PM writes with is the same reading map the engineer's agent reads with. The team config becomes the contract between who writes tickets and who implements them — tickets created via LiftOff are readable by Plan by construction.
- **Batch approval:** several tickets are shown together, editable one by one, approved once.
- **Where it runs:** Claude Code first. Chat clients without a shell (e.g. Claude Desktop) need an MCP wrapper over the LiftOff library, added with this flow — the natural place for a PO/PM.

### Work streams — time-boxed Kanban projects

Not every piece of work fits the team's sprint. A roadmap item of 3–6 weeks, or a task force that builds an MVP before becoming a module, needs a deadline and a scope, not a velocity. A **work stream** is a child tracker project run as Kanban, declared in the team config:

- **Linked, not created.** The tracker project (e.g. a Jira project with a Kanban board) is created by hand; LiftOff only connects it. Creating projects needs admin rights and is a high-impact write, so it is out.
- **Backlog from epics.** A stream can hold **several epics**. The Ticket flow breaks each epic into tickets on the team's templates, shown together and approved once, and creates them in the stream's project.
- **No sprint, no velocity.** Plan, Build and Close never assume an active sprint or story points. Workflow transitions are read per stream project, as for any project.
- **Lives in the repo config** (`streams:` in `liftoff.yaml`: id, tracker project key, `mode: kanban`, the code module it feeds). Who works on the stream (team or external people) is not LiftOff's concern: access is whatever the tracker and the repo already grant.
- **Optional.** A repo without `streams:` behaves exactly as before; the team's sprint project stays the default.

Later, not now: deadline and MVP-scope warnings, WIP limits, handoff notes when a stream closes.

## Team config

One config file is the single source of truth for a team (or a whole company, if setup is centralized).

1. **First run, no config found** → full Init interview. At the end LiftOff writes the config file, ready to commit to a shared place (the repo by default).
2. **Lead / platform team** can also author the config upfront, before telling the team to adopt the plugin.
3. **Teammate runs LiftOff** → the config is found and applied with no interview. Only personal bits are asked: credentials, agent choice if the config leaves it open, and installing/logging into the code host CLI (`gh` / `glab`) if the config uses CLI mode.

**Where it lives — two levels:**

1. **Repo** (default): config file committed in the repo.
2. **Central** (optional): the repo config extends a company-level config by git URL + version tag (e.g. `extends: <company-presets-repo>#v3`). A platform team maintains shared standards there; each repo inherits and adds its specifics. Central *required* fields can't be overridden by the repo; *default* fields can.

Plain git, no registry or server: engineers already have access, on-prem companies already host it.

What's **shared** (committed): stack, module layout, agent instructions, constraints, MCP servers per connector, tracker mapping, ticket template / reading map per issue type (with required fields), workflow transitions, PR/MR template and code host conventions.
What's **personal** (never committed): credentials, tokens, personal preferences (e.g. `warn_on_config_update`).

### Updates: the team config is authoritative

If a team adopts a standard, it must be followed.

- Every LiftOff command (e.g. picking a ticket from Jira/Linear) first checks whether the team config changed since it was last applied.
- **Required change** → it blocks only the commands it affects, until applied. A new PR template blocks PR creation, not Plan. No silent drift where it matters.
- **Non-required change** → a warning, controlled by the personal setting `warn_on_config_update` (default `true`, can be set to `false`). It never blocks.
- **Local override (later, not in v1)**: a personal file for one's own additions, never committed. Updates would never touch it and it couldn't contradict a required rule. No common file name works across agents today (`AGENTS.local.md` is read by neither Claude Code nor Copilot), so how it works is open.
- Using LiftOff is optional. Breaking a required rule while using it is not.
- **Versioned.** The team config carries a version/hash; each repo records the version it last applied. The check is a cheap comparison.
- **Diff before overwrite.** If an update touches a file that was edited by hand (e.g. an `AGENTS.md` section), the diff is shown first. The team config wins, but nobody loses work blindly.
- **Required vs default fields.** The team marks each config **section** as *required* (always enforced, e.g. the PR template section) or *default* (overridable, e.g. agent choice) with a `required: true` flag inside the section.

## Agent support

Teams are mixed: some engineers use Claude Code, others GitHub Copilot. LiftOff must behave the same for all of them, without being built twice.

**Design principle: build only on what agents have in common — instructions, Agent Skills, MCP and shell commands (CLIs).** Hooks and subagents differ between agents (or are missing); these don't.

- **LiftOff's runtime is a CLI** (`liftoff`, one bundled file shipped inside the plugin, no `npx`), a thin layer over a TypeScript library, called by the skills through the shell that every agent has. It exposes the team's rules as commands, e.g. `check-config` (is the team config up to date?), and later `parse-ticket` (a ticket fetched by the agent, interpreted with the team's reading map), `pr-template`, `preview-write` (the dry-run shown before approval), `transition` (the right transition for that project). v1 ships `check-config`, `validate` and `render`.
- **An MCP wrapper over the same library is added when a client without a shell needs it** (Ticket flow in Claude Desktop, roadmap item 4). The core flow never depends on it.
- **The LiftOff CLI is pure: no network, no credentials.** It only reads the team config and the local repo. All calls to Jira / Linear / GitHub / GitLab are made by the agent, through their MCP servers or CLIs; LiftOff tells it *what* to do and *how*. No token ever passes through LiftOff, nothing is reimplemented, and the CLI stays small and easy to test. The final approval is the confirmation the agent already asks before calling the tracker / code host.
- **Flows ship as Agent Skills in one plugin** that Claude Code, Claude Desktop/Cowork and VS Code/Copilot all install (see [Stack](#stack-draft)). Project files (`AGENTS.md`, per-agent instructions) come from one source of truth — team config + `AGENTS.md` — rendered into each agent's format at Init.
- **No hook dependency for the core flow.** The config check is the first CLI call of every command, not a hook.
- **Same conventions, same rules, same approvals** for every engineer on every agent — so "identical agent behavior" holds for mixed teams.
- **Agent-specific extras are optional.** Features only one agent has (e.g. parallel specialized subagents in Claude Code) are add-ons, never required by the core flow.
- **Any agent with skills and a shell is supported almost for free.** An agent without them can't run the core flow: LiftOff **warns and stops**, no silent degraded mode.

## Doctor

`liftoff doctor` checks everything in one place: team config version, credentials still valid, agent capabilities, connector reachability (Jira/Linear, GitHub/GitLab — on-prem included). First stop when something doesn't work.

## What LiftOff is not

- **Not an autonomous agent.** No walk-away mode, no auto-merge.
- **Not for non-engineers — except the Ticket flow.** The development flow assumes you can read and own the code; PO/PMs only use ticketing.
- **Not CI/CD or deploy.** It stops at the PR and the ticket update.
- **Not a code-review bot.** It may self-check before opening a PR; reviewing teammates' PRs is out.
- **Not a new IDE or agent runtime.** It builds on the agents you already use.

## Success looks like

- A new repo goes from zero to AI-ready in **< 10 minutes** — **~1 minute** when a team config exists.
- PRs and ticket updates created through LiftOff are **accepted without edits** — measured as a % per connector.
- A new teammate gets the same agent behavior as everyone else by cloning the repo and running the plugin.

## Pilot

The first users are internal: the product owner and close colleagues at their company. The pilot is how we find out whether LiftOff works before building more.

- **Who:** 3–5 engineers, mixed agents (Claude Code and GitHub Copilot).
- **On what:** 1–2 new projects in the next 2–3 months.
- **Scope:** Init + Connect + Plan/Build first. Close joins once those hold. The product owner also uses the Ticket flow as PO/PM, from Claude Code.
- **What we measure:**
  - **Init time**: zero to AI-ready repo, without a team config and then with one.
  - **Return usage**: how many colleagues use Plan/Build in the 2–4 weeks after Init. This is the key signal: it tells whether the value is recurring or stops at setup.
  - **Quality**: % of PRs and ticket updates created via LiftOff accepted without edits.
  - **Friction**: how often someone bypasses LiftOff and uses the agent directly, and why.
  - **Does Init actually help?** Manual, qualitative check with the team: same tasks on a bare repo vs a LiftOff repo, same agent; discuss the results together. Whatever generated file makes no difference gets cut. Repeat after major Init changes. A built-in `liftoff eval` only if outside teams ask for proof.
- **Decision rule (set in advance):** if after 4 weeks fewer than half of the group uses Build, we revisit the product before adding anything else.

Small numbers: read the metrics as signals, not statistics. Talk to every user.

## Roadmap (draft)

1. **Plugin, Init** — `project-init` as a product, multi-agent output, team config read/write.
2. **Connect** — Jira/Linear and GitHub/GitLab via MCP servers, with onboarding.
3. **Plan / Build / Close** — the ticket → plan → PR loop, approval-gated.
4. **Ticket flow** — bugs / tasks / stories on the team's templates; Claude Code first, then MCP chat clients (e.g. Claude Desktop).
5. **Work streams** — Kanban child projects linked in the config, epics broken into tickets; no sprint assumptions. Needs Connect and the Ticket flow. Judged with pilot data.
6. **More agents** — beyond Claude Code and Copilot.

## Distribution

Open source, **Apache-2.0** — permissive, with an explicit patent grant that corporate legal teams approve easily. A tool that reads your repo and holds your tracker and code host tokens has to be inspectable to be trusted. No business model for now; usage limited to the pilot at first.

## Stack (draft)

- **LiftOff CLI:** TypeScript / Node, bundled into one file (`dist/liftoff.mjs`) that ships inside the plugin, so no npm publish and no `npx` fetch. A library plus a thin `liftoff` binary, small and pure (reads config + repo, returns results). Skills call it through the shell. An MCP wrapper over the same library comes later, for clients without a shell. Maintained by the product owner, not by pilot users.
- **Team config:** YAML, `liftoff.yaml` at the repo root, validated by a JSON Schema (autocomplete and errors in the editor). Comments allowed, multi-line ticket templates read well.
- **Flows (Init, Plan, Build, Close, Ticket) = Agent Skills** (`SKILL.md`, an open standard): one version for every agent, with supporting files, templates and scripts. Skills say *how* to proceed; the CLI enforces *the team's rules*.
- **Distribution: one Claude-format plugin** (`.claude-plugin/plugin.json`) bundling the skills (which call the bundled CLI through `node`), published in a LiftOff marketplace (a git repo). The same plugin installs in:
  - **Claude Code** — `/plugin marketplace add` + `/plugin install`;
  - **Claude Desktop / Cowork** — same plugin directory as Claude Code;
  - **VS Code + Copilot** — VS Code auto-detects Claude-format plugins (Agent Plugins).
- **Repo recommends the plugin:** Init commits `.claude/settings.json` with `extraKnownMarketplaces` + `enabledPlugins`, read by both Claude Code and VS Code. Whoever clones the repo is prompted to install it. The plugin itself is never copied into the repo. What Init commits is `liftoff.yaml`, the `AGENTS.md` files, `CONSTRAINTS.md`, the thin per-agent files (`CLAUDE.md`, `.github/copilot-instructions.md`) and this settings file.
- **Plugin version pinning:** `liftoff.yaml` declares the minimum plugin version (e.g. `plugin: { version: "1.4" }`, always required). `check-config` compares it with the installed one; an older install is a **required change** — commands are blocked with instructions to update. Every version is a git tag in the marketplace, so a team can deliberately stay behind until the lead has validated the new one.

## Open questions

None right now.
- **Ownership before public release** — confirm with the employer that the project can be released as open source, since the pilot runs at the company.
