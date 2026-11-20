# Handbook practice draft: context hygiene

Status: **built (2026-11-20): the three pages ship in the base of the [living handbook](handbook.md) and the checks of section 3 run in
`brain-check`.** This file is the draft they came from. It turns the token research of
2026-11-20 into three practice pages, says how LiftOff would apply them, and proposes the checks the CLI can run without a
network. The pages are written for an engineer who has had no AI training.

**What was verified and what was not.** Every claim about Claude Code and the Anthropic API below was read on the vendor's own
pages (Claude Code docs: costs, prompt-caching, memory, skills, sub-agents, model-config, mcp, context-window, hooks,
best-practices; the API prompt-caching page) by the research agent. Everything about GitHub Copilot in VS Code comes from
search snippets only, because those hosts were blocked in the session: it is marked **unverified** and must be checked before a
page promises it. Numbers that change with a release (prices, limits, the models that keep a cache on an effort change) are
dated in the page, so that the "still true?" review has something to test.

**How this fits the handbook spec.** It adds one practice to the ten the base lists: `session-hygiene` and `context-on-demand` are
already in the table and are drafted here in full; `lean-output` is new (output and MCP), which makes the base eleven pages.
Each page is under 120 lines, uses the `## Why / ## When / ## How here / ## Example` sections (rule 13) and the `origin` and `base`
front matter (the `base` value is computed by `handbook-init`, so it is a placeholder here).

## 1. The pages

### `session-hygiene.md`

```markdown
---
title: Session hygiene
type: practice
updated: 2026-11-20
summary: One session per ticket, steady model and effort, state in files, a clean restart between tasks.
origin: liftoff@0.5.0
base: <computed by handbook-init>
---

## Why
An agent session is a conversation that is sent back to the model in full on every turn. What you pay for, and what the
model has to sift through, grows with everything said so far. Two things follow:
- A session that mixes unrelated tasks carries the first task's history into the second, so you pay for it and the model
  can be distracted by it.
- The provider keeps a cached copy of the start of the conversation. Reading from that cache is much cheaper than reading the
  text fresh (on the API: 0.05x to 0.1x of the normal input price, and 0.05x on Opus 5.5 and Sonnet 5.5; writing to it costs
  1.25x for a 5-minute cache and 2x for a 1-hour one; checked 2026-11-20). Anything that changes the start of the
  conversation throws the cache away and you pay full price to rebuild it.

## When
Always, as a habit. It matters most on long sessions and on tickets that take more than one sitting.

## How here
- **One session per ticket.** Between unrelated tasks run `/clear`; it costs nothing. Run `/rename` first if you may want
  to come back (`/resume`).
- **State lives in files, not in the chat.** The plan file `.liftoff/plans/<KEY>.md` and the brain hold what the next
  session needs. If something would be lost by a `/clear`, write it there first.
- **Choose the model and the effort at the start and keep them.** Changing the model in the middle of a session
  (`/model`) makes the next turn read everything again without the cache. Changing the effort level keeps the cache only on
  Fable 5.1 and later, Opus 5.5, Sonnet 5.5 and Haiku 5.5 (checked 2026-11-20). If the work really changed nature (from
  planning to a mechanical refactor), restart instead of switching.
- **The cache expires after 5 minutes of silence** by default. If you work in long pauses, the team may choose the 1-hour
  cache with `CLAUDE_CODE_PROMPT_CACHE_TTL=1h` (the setting `promptCacheTtl` exists as well). It costs more to write, so use it
  only if pauses are the norm.
- **Compact at a natural break, not after a pause.** `/compact focus on <what matters>` after a long silence reads the whole
  conversation with a cold cache, which is the expensive case. To drop a wrong path, `/rewind` goes back to an earlier point
  that is still cached.
- **Do not correct in a loop.** After two corrections that did not work, stop: `/rewind` or `/clear` and give a better first
  message. Repeated corrections add text and rarely add direction.
- **Many screenshots hurt:** when the limit is exceeded the oldest images are dropped and the cache breaks.
- **Scheduled loops and check-ins on idle sessions** resend all the context each time. Prefer a fresh session per run.
- Team detail (the team's real `/model` and effort defaults, its pause habits): add below.

## Example
Sara finishes PROJ-123 and the merge request is ready. She notes in the plan file that the retry logic was left for PROJ-130,
runs `/clear`, and starts PROJ-130 with "plan PROJ-130". The new session starts small and cached from its first turn.
Anti-example: she keeps going in the same session, asks for an unrelated dashboard fix, switches to a cheaper model to "save",
and the next turn reads the whole PROJ-123 history again, uncached.

Copilot in VS Code: whether `/clear`, `/rename` and the cache settings exist there, and how long its cache lives, is
**unverified**. Copilot has billed by token since 2026-06-01 (from a search snippet, unverified), so the same habit should
still pay off.
```

### `context-on-demand.md`

```markdown
---
title: Give the agent the context it needs, not the repository
type: practice
updated: 2026-11-20
summary: Short always-loaded rules, long guidance in skills and on-demand pages, named files in the prompt.
origin: liftoff@0.5.0
base: <computed by handbook-init>
---

## Why
Whatever is always loaded is read on every turn of every session. A long `CLAUDE.md` or `AGENTS.md` costs tokens on every
turn and, past a point, the agent follows it less closely. Specific input is cheaper than vague input: "improve the codebase"
makes the agent scan the repository, while a named file and a clear goal do not.

## When
When you write or edit `AGENTS.md`, `CLAUDE.md`, `CONSTRAINTS.md`, a skill, or the first message of a task.

## How here
- **Keep `CLAUDE.md` under 200 lines** (the vendor's advice; longer costs more and is followed less). `AGENTS.md` and
  `CONSTRAINTS.md` follow the same spirit: a few short rules, always loaded.
- **Put specialist guidance in a skill or a handbook page**, not in `CLAUDE.md`. A skill costs only its description until
  it is used; keep the description short (it is cut at 1,536 characters) and the `SKILL.md` under 500 lines.
- **`@import` does not save tokens.** An imported file is loaded in full. Do not split a big `CLAUDE.md` into imports
  expecting it to get cheaper.
- **Rules that apply only to some files** can use `paths:` so they load when those files are touched. They are lost after a
  compaction, so do not rely on them for something that must always hold.
- **Rules that must always hold belong in a hook or a check, not in capital letters.** "IMPORTANT" and "ALWAYS" do not make
  a rule stick; a hook does. A failing check the agent must pass before it stops (a Stop hook that exits 2) is stronger than a
  line of prose. Note that after 8 blocks in a row the system lets the agent stop anyway (checked 2026-11-20).
- **In the first message of a task name the module, the files and the goal**, and point at the ticket and the plan. Do not
  paste whole files the agent can read, and do not say "look at the codebase".
- **Keep the number of hooks small.** The vendor's guidance treats more than about forty as a warning sign: they turn into
  rigid preferences nobody remembers.
- Team detail (the repo's real size limits, which skills exist): add below.

## Example
Nina's `CLAUDE.md` has grown to 340 lines, half of it "how to write a migration". She moves that half into a skill with a
one-line description. Every session now starts smaller, and the migration guidance loads only when a migration is the task.

Anti-example: she splits the 340 lines into six `@import` files. Nothing gets cheaper; the six files load in full.

Copilot in VS Code: instruction files, skills and custom agents exist there (from search snippets); their exact loading rules,
size limits and whether a `paths:`-style filter exists are **unverified**.
```

### `lean-output.md`

```markdown
---
title: Keep tool output lean
type: practice
updated: 2026-11-20
summary: Filter logs before they enter the context, send noisy work to a subagent, keep few MCP servers.
origin: liftoff@0.5.0
base: <computed by handbook-init>
---

## Why
A raw test log or a large tool result lands in the context and is then reread on every turn. A passing test run can be
thousands of lines of which the agent needs a few. Tool definitions count too: a server that exposes many tools adds its
definitions to what the agent carries.

## When
When a command prints a lot (tests, builds, logs, a large `git diff`), when you add an MCP server, and when you ask for a
broad search.

## How here
- **Filter before it enters the context.** Ask for the failures only (`grep` for errors, or a runner's quiet mode), or limit
  the tail (`| tail -n 100`). A hook can rewrite a command this way (`PreToolUse` with `updatedInput`). Filter only commands
  whose output you know; cutting the line that explains the failure costs more than it saves.
- **Send verbose, self-contained work to a subagent**: running the full test suite, reading logs, searching documentation.
  The noise stays in its context and only a summary comes back. Do not use one for a small or iterative edit: each subagent
  starts from nothing, is often slower and counts on the same usage limits.
- **Choose the model for the job.** The routine work is for the middle model, architecture and subtle reasoning for the top
  one, simple subagents can use the small one (`model: haiku` in the subagent's definition; `CLAUDE_CODE_SUBAGENT_MODEL`
  forces one model for all subagents). The built-in Explore subagent runs on the parent's model: for a cheap one, define your
  own Explore with a small model. The small model gets subtle things wrong, so not for judgment.
- **Prefer a command-line tool (`gh`, `glab`) to an MCP server when one does the job**, and turn off the servers you are
  not using (`/mcp`). With tool search on (the default), tool definitions are deferred and only their names are loaded, so a
  dormant server costs little; keep that setting on. Turning a server off in the middle of a session breaks the cache when tool
  search is off.
- **An MCP result is capped** at 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`) with a warning at 10,000; if you hit it, ask for less.
- **Agent teams cost far more** (about 7x in plan mode, per the vendor's cost page). Use one only for work that is truly
  parallel.
- Team detail (the commands that are noisy in this repo and how to quiet them): add below.

## Example
The API test suite prints 4,000 lines. Marco's agent runs it through a subagent that returns "3 failures: names, first error
line of each". The main session keeps about 200 tokens of it instead of 40,000.

Anti-example: the agent runs the full suite in the main session, three times, to find which test fails.

The vendor's figures for tool search (definitions of 134K tokens cut by 85%, accuracy up from 79.5% to 88.1%) come from a
search snippet and are **unverified**: do not quote them. Whether VS Code Copilot hooks can rewrite or truncate output is
**unverified** and probably not.
```

## 2. How LiftOff applies them

Cost: **S** about a day, **M** a few days, **L** a week or more, in the repo's own scale (a small CLI check with its tests is S).

| Practice | Invisible in the flow | Deterministic CLI check | Suggestion with a one-line reason |
|---|---|---|---|
| Fresh session per ticket | Plan and Build already keep state in `.liftoff/plans/<KEY>.md`; Build's last step could name the plan as the handoff. **S** | Nothing to check. | After the merge request is handed back: "Ticket done: `/clear` starts the next one without paying for this history (handbook: session-hygiene)". **S** |
| Steady model and effort | None. A skill must not switch the model; skills with a `model:` in their front matter do change it, so LiftOff skills keep none. **S**, a test that no shipped `SKILL.md` has `model:` | Test over the shipped skills (above). **S** | One line when Plan starts: pick model and effort now and keep them. **S** |
| Long pauses | The lead may set `promptCacheTtl` in the repo's settings during Init, as a diff to approve. **S**; whether it should be the default is a team choice | None. | None; it is a team decision, not a reminder. |
| Instruction files short | None. | `context-size` warnings on `CLAUDE.md`, `AGENTS.md`, `CONSTRAINTS.md`, a skill's description and body (below). **M** | The finding itself, with the number and the handbook id. |
| Specialist guidance outside `CLAUDE.md` | Init could write a module's detail into its own `AGENTS.md` and the handbook, as it already does for modules. Already the design. | `context-size` above. | In the brain: "this part of `CLAUDE.md` is guidance: move it to a handbook page". **S** |
| Rules as hooks | Init's optional add-ons (hooks, a CI workflow, on the README's "not yet" list): a Stop hook that runs the repo's checks. **L**, and it needs an agent-parity answer | `hook-count` warning above a threshold. **S** | None. |
| Filter noisy output | A `PreToolUse` hook that tails known noisy commands. **M**; hooks reach VS Code in preview (unverified format) | None. | "This command prints a lot: filter it or use a subagent (handbook: lean-output)". **S** |
| Subagent model | Subagent files shipped with `model: haiku` for pure search. **M**; the clean-review subagent must NOT be small | None. | None. |
| MCP footprint | Connect already adds only the Jira server and limits its tools (`ENABLED_TOOLS`). **Done** | `mcp-count`: more than N servers in `.mcp.json`. **S** | None. |
| Cold-cache compact | None. | None. | When the engineer asks for `/compact` and the last turn was long ago: "the cache is cold, `/clear` and the plan file cost less". **S** if the host exposes the idle time; otherwise skip. |

The column to build first is the middle one, because it is the only one that is deterministic, testable and has no agent in it.

## 3. The deterministic checks

All run offline over files the repo already has; they fit the `Finding` shape of `src/brain/check.ts` (`level`, `code`, `file`,
`message`, `line`) and are warnings, never errors. They join the single health command, `brain-check`, under `brain.handbook`
(a no-op without it, as the handbook spec requires). Defaults below are the vendor's own advice; the lead can change them in
`brain.handbook.context`, the same way `maxRules` is set.

| Code | Looks at | Warns when | Message names |
|---|---|---|---|
| `context-size` | `CLAUDE.md`, root `AGENTS.md`, module `AGENTS.md`, `CONSTRAINTS.md` | more than `maxInstructionLines` lines (default 200) | the file, the count, the page `context-on-demand` |
| `skill-size` | each `SKILL.md` in the repo's `.claude/skills` and in the plugin | body over 500 lines, or front-matter `description` over 1,536 characters | the file and the limit |
| `skill-model` | each `SKILL.md` | a `model:` key in the front matter (it changes the model and breaks the cache) | the file, `session-hygiene` |
| `import-no-saving` | `CLAUDE.md`, `AGENTS.md` | `@path` imports of files over 100 lines in a file that is itself near the limit | the file ("imports load in full") |
| `hook-count` | `.claude/settings.json` | more than `maxHooks` hooks (default 40) | the count |
| `mcp-count` | `.mcp.json`, `.vscode/mcp.json` | more than `maxMcpServers` servers (default 5, a LiftOff choice, not a vendor figure) | the servers, `lean-output` |
| `page-size` | handbook pages | already in the spec (120 lines) | already in the spec |
| `emphasis` | `CLAUDE.md`, `AGENTS.md`, `CONSTRAINTS.md` | lines in capitals, or more than N of "IMPORTANT/ALWAYS/NEVER" | the lines; it is a hint that the rule wants a check |

Notes on what these are not:
- They count lines and characters. They do **not** measure tokens (the CLI has no tokenizer and no network). The messages say
  "lines", never "tokens".
- `skill-size` and `skill-model` run in this repo's tests too, on `plugin/skills/*`, so LiftOff holds itself to the limits it
  recommends. Today every shipped skill is under 260 lines and none sets `model:`.
- `/doctor prompt-audit`, `/context` and `PreModelSwitch` came up in the research as vendor tools. They are outside the CLI and
  could not be re-checked, so they are only candidates for a nudge, after the page is verified.

## 4. Risks and what not to automate

- **Do not switch models for the engineer.** A skill or hook that changes the model or the effort breaks the cache and may lower
  the quality of the work in progress. LiftOff may only suggest, and only at a boundary (ticket done, new session).
- **Do not run `/clear` or `/compact` by itself.** Both lose context the engineer may still want. They are the engineer's
  action; the suggestion carries the reason in one line.
- **Do not truncate output the agent has not seen before.** A filter that cuts the line that explains a failure makes the agent
  retry, which costs more. Filter only commands whose output is known and tested.
- **Do not put a small model on judgment work.** Search and summarising yes; the clean-review subagent, planning and
  ambiguity-spotting no.
- **Too many checks become noise.** Each warning above is informational and can be turned off per check; a pilot signal for
  "people stopped reading the health output" is the same one the handbook already tracks (nudge noise).
- **Thresholds age.** Lines, limits, models that keep a cache and prices are the vendor's and change. They live in the page
  text with a date (`checked 2026-11-20`) and in the lead's config; the "still true?" review is the way to refresh them. The
  CLI's defaults are tied to the plugin version.
- **Cheaper is not the goal.** The research found cases where saving makes things worse: compacting after a pause, lowering
  effort on a hard bug, dropping a useful MCP server, vague short prompts. Pages say so, and nothing here should be scored on
  tokens saved alone. If a metric is added, it pairs tokens with plan sections changed and corrections made (the pilot metrics
  that already exist).
- **Parity with Copilot is unproven.** Every page has a Copilot paragraph marked unverified. Do not ship the checks'
  Copilot-side claims, or the hook-based items, until someone has read the VS Code and GitHub docs from a machine that can
  reach them.
- **One thing the research could not settle:** the auto-compact threshold per model and the exact behaviour of the effort
  setting on every model. The pages avoid both.

## 5. Open questions

All three were decided on 2026-11-20 (a design review by an Opus agent, recorded in `DECISIONS.md`).

1. **`lean-output` is a page of its own**: the eleventh practice, so each page stays under 120 lines and a team can retire one without
   the other.
2. **The checks are on by default** as warnings whenever `brain.handbook` is set, and are tuned or turned off in
   `brain.handbook.context`: `{ maxInstructionLines: 200, maxHooks: 40, maxMcpServers: 5, skip: [<codes>] }`, or `context: false`.
3. **The Copilot paragraphs are not verified by an agent** (the vendor's hosts were blocked in the research session). Until a human with
   VS Code and the real docs has checked them (a new item of the pilot checklist), the pages say "not verified in VS Code: if the tool is
   not there, <fallback>" and quote no figure; the statement about per-token billing was taken out.
