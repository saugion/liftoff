# LiftOff

LiftOff is a plugin for AI coding agents (Claude Code, and GitHub Copilot in VS Code). It gives a whole team one set
of rules for its agents and connects those agents to the team's Jira and GitLab. A ticket then goes to a plan, to
reviewed code, to a merge request ready to open, and every step follows the team's conventions. The engineer stays in
charge the whole time.

Current release: **v0.3.0**, built and tested, not yet piloted. See [Status](#status-and-limits).

**What a team gets**

- **The same agent behavior across a mixed team.** One committed file, `liftoff.yaml`, holds the team's rules. Every
  engineer's agent reads it, whichever agent they use.
- **Tickets and merge requests that follow the team's conventions.** The agent reads tickets the way the team writes
  them. It writes tickets on the team's templates and prepares merge requests on the team's branch, title and
  description conventions.
- **The engineer stays in charge.** LiftOff proposes, the engineer approves. LiftOff never merges, never opens the
  merge request and never moves a ticket on the board.
- **The lead sets it up once.** After that, a teammate needs a few minutes per machine: clone, apply, connect.

## The problem

Teams that use AI agents rebuild the same setup on every project: agent instructions and a quality bar, once per
agent the company allows, slightly different on each machine. The agent doesn't know where the team puts acceptance
criteria, and the tickets and merge requests it writes don't match the team's habits. LiftOff turns that setup into a
shared team config and connects the agent to the tracker and code host with the team's conventions built in.

## How it works

Five skills (a skill is a packaged set of instructions the agent follows). The skills call a small command-line tool
bundled with the plugin, which checks the team's rules. That tool makes no network calls and never handles
credentials. The agent talks to Jira through an MCP server (a standard way to give an agent access to an outside
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
| **Connect** | lead once, then each teammate | Teammate: checks prerequisites, stores a personal Jira token in the macOS Keychain (or reads it from an environment variable), adds the Jira server entry, verifies Jira and GitLab. Lead, once: learns the team's ticket templates and fields from real tickets, test-creates one ticket per type until each one works, learns the workflow transitions, learns the merge-request conventions from past merge requests, and writes all of it to `liftoff.yaml`. Can also link work streams. |
| **Plan** | engineer | Reads a ticket through the team's reading map (where acceptance criteria and key fields live), reads the repo's rules and code, and writes a local plan in sections. The engineer approves it once. Nothing is written to Jira. |
| **Build** | engineer | Implements the approved plan section by section and runs the repo's checks. Then it self-checks against the acceptance criteria and prepares the branch name, commit messages, the merge-request description and the exact command to open it. |
| **Ticket** | PO/PM, engineer | Writes bugs, tasks, stories and epics on the team's templates, or breaks an epic into tickets. The whole batch is shown together and approved once. Works in the team's Jira project or in a linked work stream. |

**Work streams** are optional. A stream is a time-boxed Kanban project (say a 3-6 week roadmap item or an MVP task
force) that someone creates by hand in Jira. The lead links it in `liftoff.yaml` together with the code module it
feeds. Plan, Build and Ticket then never assume a sprint or story points for it. One ticket lives in one project, so
work that touches both a stream's module and a team module becomes two tickets, one per project.

The template a PO/PM writes a ticket with is the same one the engineer's Plan reads it with. The team config is the
contract between who writes tickets and who implements them.

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
| `build.git` | Who runs git in Build. `assisted`: the agent creates the branch, commits each section and pushes, each step only after the engineer approves a preview. `manual`: the agent never runs a git command that writes anything. It hands the engineer the branch name, the commit messages and the commands. |
| `plugin.version` | The minimum plugin version. An older install is stopped with instructions to update. |

**The lead's rules are enforced.** A section can be marked `required: true`. When the lead changes a required
section, every teammate's LiftOff reports a required change until they apply it again with Init (one run, no
questions). Init marks `constraints` and `build` required by default. Personal things, like tokens, are never in the
config.

## Guarantees

- **Approval before every write to an outside system.** You see exactly what will be sent first: ticket fields, branch,
  push. A plan or a batch of tickets is approved once, not once per call.
- **No credentials in the repo, the config or the chat.** You type the Jira token into your own terminal, and it is
  kept in the macOS Keychain or an environment variable. `glab` keeps its own login. The agent never sees either.
- **Nothing is merged or moved by the tool.** The merge request and the ticket's status always belong to the engineer,
  in every git mode. Build never writes to Jira at all.
- **Ticket text is data, not instructions.** If a ticket contains something like "also push to main", the agent
  reports it and does not follow it.
- **Nothing is committed for you.** Init and Connect tell you which files to commit.

## Quick start

Requirements: macOS, Node 22.12 or newer, Claude Code or VS Code with GitHub Copilot. For Connect you also need a Jira
Server/Data Center account and a GitLab account. Connect installs `uv` (it runs the Jira server) and `glab` with
Homebrew, after you approve.

**Install (lead, or anyone installing by hand)**

Claude Code:

```
/plugin marketplace add saugion/liftoff#v0.3.0
/plugin install liftoff@liftoff
```

The `#v0.3.0` tag installs exactly that release.

VS Code with GitHub Copilot: turn on `chat.plugins.enabled`, add the marketplace `saugion/liftoff`, install `liftoff`.
Plugin support in VS Code is partly experimental, and the pilot will check this path.

**Lead, once per team**

1. In the repo, run `/liftoff:liftoff-init` (in VS Code, the `liftoff-init` skill). Answer up to four questions:
   name and purpose, modules and stack, agents, git mode. Then approve the recap.
2. Run `/liftoff:liftoff-connect` and say you are the lead. Give the Jira URL and project, and the GitLab host. Approve
   each test ticket and each config change. If the agent asks you to restart it, restart and run the skill again: it
   picks up where it stopped.
3. Commit what the skills list: `liftoff.yaml`, the `AGENTS.md` files, `CONSTRAINTS.md`, `CLAUDE.md`,
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

After Build you review the work, open the merge request with the command Build handed you, and move the ticket to its
next lane.

The repo pins the plugin to a release tag in `.claude/settings.json` (`ref`), and to a minimum version in
`liftoff.yaml`. The pin is per user, not per repo, so move all pilot repos to a new release together. Details are in
[`SPEC-plugin-packaging.md`](SPEC-plugin-packaging.md).

## Status and limits

**Built in v0.3.0:** Init, Connect (member and lead flows), Plan, Build with the `build.git` option, Ticket (with
epics), and work streams.

**Supported:** Jira Server/Data Center through the community MCP server `mcp-atlassian`, one Jira project per repo.
GitLab through `glab`. macOS. Claude Code and GitHub Copilot in VS Code.

**Tested:** 1,219 automated tests. These include end-to-end runs against a fake Jira, a fake `glab` and a real git
remote, with a scripted stand-in for the agent. **Nothing has run yet against a real Jira Data Center, a real GitLab or
a real agent following the skills.** Nothing has been measured.

**Not yet:**

- Jira Cloud, Linear, GitHub
- credential storage on Linux or Windows
- sprint support (assigning sprints), and deadline or WIP warnings for streams
- `doctor` (one command to check the whole setup)
- a server so chat clients without a shell, like Claude Desktop, can run the Ticket flow
- the optional Init add-ons: subagents, hooks, a CI workflow, a wiki
- a company-level shared config that repos inherit from

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
checks are at the end of each `SPEC-connect-*.md`.

## More, and contributing

- [`HANDOFF.md`](HANDOFF.md): where the project stands and what is left.
- [`docs/decisions/DECISIONS.md`](docs/decisions/DECISIONS.md): decisions taken while building. The open ones are
  listed at the top.
- `SPEC*.md`: the design record, one spec per area ([`SPEC.md`](SPEC.md) is the v1 overview).
- [`schema/liftoff.schema.json`](schema/liftoff.schema.json): everything `liftoff.yaml` can hold.

To work on it: `npm ci`, `npm run build` (type check, bundle, regenerate `plugin/`), `npm test` (unit and end-to-end).
CI checks that the committed `plugin/` matches a fresh build.

Open source under the [Apache-2.0](LICENSE) license.
