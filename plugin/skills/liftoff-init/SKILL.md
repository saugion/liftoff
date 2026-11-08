---
name: liftoff-init
description: >
  Make a repository AI-native for Claude Code and GitHub Copilot from one team config: writes liftoff.yaml,
  AGENTS.md files, CONSTRAINTS.md and the thin per-agent files (CLAUDE.md, .github/copilot-instructions.md).
  Use when the user says "liftoff init", "init project", "set up this repo for AI agents", "apply the team config",
  or when a repo has a liftoff.yaml that was never applied on this machine.
license: Apache-2.0
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff.mjs" *)
---

# LiftOff Init

Turns a repo into an AI-native one. **No `liftoff.yaml` in the repo: interview mode.** One short interview, then you
write `liftoff.yaml`, the `AGENTS.md` files and `CONSTRAINTS.md`, and render the per-agent files.
**`liftoff.yaml` present: apply mode.** No questions: you create what is missing, render, and resolve file conflicts
with the user.

You are the instructions; the `liftoff` CLI decides everything deterministic (validation, the plugin pin, hashes,
rendering, safe writes). Never guess what the CLI can tell you. Read its JSON, not your expectations.

## Rules

- **Always:** route on the CLI's JSON (`status` and `code`), never on prose. Pass an absolute `--root`. Quote every
  path. Get a yes on the recap before writing anything. Show a diff before touching a hand-written file. Back up
  before replacing or appending (never overwrite an existing backup). Keep rules that matter on every task in the
  **root** `AGENTS.md`.
- **Never:** write credentials or tokens anywhere. Replace an existing `AGENTS.md` or `CONSTRAINTS.md`. Write through
  a symlinked `AGENTS.md`. Fold a personal (untracked or ignored) file, or one with secrets. Move or rename files in an
  existing repo. Delete a key from `liftoff.yaml`, or touch the schema, to make `validate` pass. Commit or push
  without being asked. Create anything the user did not select or approve.

## Running the CLI

The CLI is `bin/liftoff.mjs` at the root of the plugin, shared with the other LiftOff skills. Run it as
`node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff.mjs" <command> --root "<abs path>"`.
**If the path you are about to run still contains `${`, your host did not substitute it: build the absolute path
from the directory this SKILL.md was loaded from (the CLI is `../../bin/liftoff.mjs` from there).**

Commands: `validate`, `check-config`, `render [--overwrite <path>]...`. Stdout is always **one JSON document**; read it
whatever the exit code (exit 1 is a normal state, e.g. the config is missing). Exit 2 or stdout that is not JSON
means something is wrong with the environment: show `message` or stderr and stop.

Other conventions: ask the user with your structured question tool if you have one (in Claude Code that is
AskUserQuestion, which also keeps the CLI approvals alive); otherwise ask in chat. Show diffs as fenced `diff`
blocks. Do backups, copies and directory creation with your **file tools**, not `cp` or `mkdir` (Copilot on Windows
runs PowerShell).

## 0. Environment and root

1. Root = `git rev-parse --show-toplevel`. If that fails (no repo, or no `git`), use the current directory, remember
   there is no repo, and offer `git init` in the summary (never force it). Use the root as `--root` for every call.
2. `node --version` must be 22.12 or newer. If `node` is missing or older, stop with a clear message: the CLI would
   fail to start and print nothing.

## 0b. A symlinked AGENTS.md (both modes, before anything is written)

If the root `AGENTS.md`, or any module `AGENTS.md`, is a symlink, show what it points to. The common case is
`AGENTS.md -> CLAUDE.md`: folding into it would write through the link into `CLAUDE.md`, and `--overwrite CLAUDE.md`
would then destroy the only copy. Ask to replace the symlink with a regular file holding the target's content (back
it up first). Do not continue until none is a symlink. (The CLI's `agents-md-invalid` is the second line of defense.)

## 1. Route by `check-config`

Run `check-config`. Branch on `status` and on **every** entry of `reasons[].code` (it lists them all):

| Result | What you do |
|---|---|
| exit 2, `usage` / `internal`, or stdout that is not JSON | Show `message` or stderr. Stop. |
| `blocked` + `plugin-outdated` | Stop. Tell the user to update the plugin to at least `minimum`, and how: *Claude Code: run `/reload-plugins`, or `/plugin marketplace update liftoff`; VS Code: update or reload the plugin.* Change nothing. |
| `blocked` + `config-missing` | **Interview mode.** Keep `installedVersion` for step 5. If `hint.nearestRoot` is set **and `<nearestRoot>/liftoff.yaml` exists**, ask whether to use that root instead of starting a second config (this question comes before the interview and is not one of its four). |
| `blocked` + `config-invalid` | Show `errors` (`path`, `line`). Offer a fix **as a diff, with approval**. If `git ls-files --error-unmatch liftoff.yaml` says the file is tracked, say "ask the lead" instead of editing. |
| `blocked` + `not-applied` or `required-changed` | **Apply mode.** |
| `warn` + `optional-changed` | Apply mode, no prompt: apply, and report what changed. |
| `warn` + `unresolved-conflict` | Offer to resolve the listed files (step 8). Otherwise leave them. |
| `ok` | Still run `render` (step 8): hashes do not see a deleted or hand-edited generated file, or a missing module `AGENTS.md`. `render` is idempotent. Say "already up to date" only if every file comes back `unchanged`. |

## Interview mode (steps 2 to 5)

### 2. Detect

Before asking anything, read the manifests to pre-fill modules, stack and commands (`references/stack-commands.md`
next to this file): Gradle/Maven, `package.json` and its workspaces, Capacitor/React Native, test and e2e configs,
Dockerfile, CI files, IaC. `project.kind` is `existing` if a manifest or a source directory exists, else `new`. Show
what you found as the defaults.

### 3. Interview: one round of at most 4 questions, then one confirmation

1. Project name and a one-line purpose.
2. Modules, the stack per module, and (for a `new` project only) the layout: monorepo (`backend/ frontend/ shared/
   [infra/]`) or single-app. An existing repo keeps what it has.
3. Agents to target, multi-select: `claude-code`, `copilot`. Default: the one you are running in.
4. **Git in the Build skill** (a team rule, the lead decides): `assisted` (default) means the agent creates the
   branch, commits per plan section and pushes the branch, each group only after the engineer approves a dry-run;
   `manual` means the agent only edits files and runs checks, and **never** stages, commits, branches or pushes: it
   hands the engineer the branch name, the commit messages and the exact commands. In both cases the engineer opens
   the merge request and moves the ticket between lanes (always theirs). Ask, explain both in one line each, and
   write the answer.

Do **not** ask about: which sections are `required` (defaults: `constraints.required: true` and `build.required: true`, nothing else; a lead
edits by hand), constraint thresholds (use the template defaults), or extras (subagents, hooks, CI, wiki are not part
of this version). Then print a recap table (the config values and the files you will create) and **get a yes before
writing anything**.

### 4. Layout

`new`: create only the module folders that are in the config. `existing`: **never move or rename files**; modules map
to paths that already exist.

### 5. Write `liftoff.yaml`, then validate

Fill `assets/liftoff-yaml-template.yaml`:

| Placeholder | Value |
|---|---|
| `INSTALLED_VERSION` | `installedVersion` from `check-config` |
| `PLUGIN_MIN_VERSION` | its `major.minor` (e.g. `0.1`) |
| `PROJECT_NAME` | the name, with `\` and `"` escaped (it sits inside double quotes) |
| `PROJECT_KIND` | `new` or `existing` |
| `AGENT_TARGETS` | the chosen agents, comma-separated |
| `LANGUAGES`, `FRAMEWORKS` | comma-separated, or empty when unknown |
| `MODULE_ITEMS` | `[]` for a single-app repo, otherwise the items as a block starting on a new line: `\n    - id: api\n      path: src/api\n      description: HTTP layer` |
| `CONSTRAINTS_FILE` | `CONSTRAINTS.md` |
| `BUILD_GIT` | `assisted` or `manual`, the answer to question 4 |

Module rules:
- A single-app repo whose code sits at the root gets `modules.items` **empty** (the root `AGENTS.md` covers it).
  Never write a path of `.`, and never two items with the same path.
- `id` = kebab-case of the folder name (lowercase; `_` and `.` become `-`). If two folders share a name, use the full
  path (`apps/web` becomes `apps-web`).
- `path` is relative to the root, forward slashes, no `..`.

Then **write, run `validate`, fix, repeat**, at most 5 rounds. Fix only by correcting what you derived or what the user
gave; never delete a key to pass and never touch the schema. After 5 rounds, stop and show the errors. A `render-invalid`
later (for example a path collision) is handled the same way: show `path`, fix the config, validate, render again.

## 6. AGENTS.md files (both modes: create what is missing)

- **Before the first backup of the run**, make sure `<root>/.liftoff/.gitignore` exists and contains `*` (create it with
  your file tools if missing), so backups can never be committed. **A backup never overwrites an existing one**: use
  `.liftoff/backup/<path>`, or `<path>.1`, `.2`, ... if that exists.
- **Root:** fill `assets/agents-md-template.md`. Modules table (columns Module, Path, Stack, Description), commands table (columns Module, Task, Command; mark any command you did not run
  `(unverified)`: a command counts as checked only when its script, task or wrapper exists; run one only with the
  user's consent), the agent files list (`CLAUDE.md` and each module's `CLAUDE.md` for `claude-code`;
  `.github/copilot-instructions.md` for `copilot`). Remove a placeholder line that has nothing to put in it
  (`EXTRA_RULES`, `EXTRA_PATHS`). In apply mode with no `AGENTS.md` (a lead wrote the config first): fill it from the
  config; the purpose becomes `<!-- TODO: purpose -->`, with no question.
- **Each module:** fill `assets/module-agents-md-template.md` (stack, build/test/lint/run commands). In apply mode,
  detect only for module paths that have no `AGENTS.md` yet, write `TODO` where you cannot tell, and propose the new
  row of the root modules table **as a diff with approval**.
- **Rules that apply to every task go in the root's `## Rules that always apply`.** VS Code Copilot loads only the root
  `AGENTS.md` by default; module files hold local specifics only.
- **An existing `AGENTS.md` with any content is never replaced.** Show an additive diff (the missing sections
  appended), apply it on approval, back it up first.
- Interview mode with an existing `CLAUDE.md` and no `AGENTS.md`: fold it into the new `AGENTS.md` here (rules in step
  8), so the user sees **one** diff.

## 7. CONSTRAINTS.md

Create it from `assets/constraints-template.md` if it is missing. Defaults: Build `green`, coverage target `80%` (or
`n/a` with check `not configured` when the stack has no coverage tool; when the stack has one that is not set up yet, keep the
threshold and write `not configured` as the check). A cell that needs one command per module lists them all, each tagged with
its module (`./gradlew build` (api), `npm run build` (web)); a dimension with no tool yet is written `not configured`. An
existing one is never touched.

## 8. Render and resolve

Run `render`. Handle each entry of `files[]` by `action`:

- `created`, `refreshed`, `unchanged`, `skipped-symlink`: nothing to do; list them in the summary.
- `conflict` with `reason` `no-marker` or `hand-edited` (a hand-written `CLAUDE.md` or `copilot-instructions.md`):
  the CLI never merges, so **you fold the file into the single source**, one file at a time:
  1. **Personal file?** If `git ls-files --error-unmatch` / `git check-ignore` says the file is untracked or ignored,
     it is personal. Warn, offer `CLAUDE.local.md` instead, and do not fold.
  2. **Secrets?** If the content matches `ghp_`, `github_pat_`, `glpat-`, `lin_api_`, `xox` followed by a token, or a
     URL with a password, refuse to fold and say why.
  3. **Destination:** a module `CLAUDE.md` folds into that module's `AGENTS.md`. The root `CLAUDE.md` and
     `copilot-instructions.md` fold into the root `AGENTS.md`; rules that apply to every task go under
     `## Rules that always apply`.
  4. **Claude-only content** (`@path` imports, which Copilot reads as literal text; slash commands; subagent names):
     flag it and propose rewording or dropping it.
  5. Show the result as a diff, get approval, then **back up both the source file and the destination `AGENTS.md`**.
  6. Append the content wrapped in `<!-- liftoff: folded from <path> -->` ... `<!-- liftoff: end folded -->`. **If that
     opening marker is already in the destination, skip the fold** (a re-run after a failure must not duplicate it).
  7. **Batch:** run one `render --overwrite <path-a> --overwrite <path-b>` for every file the user approved.
  8. If the user declines, leave the file as it is; it stays reported as unresolved.
- `conflict` with `reason` `newer-generator`: tell the user to update the plugin (same wording as in step 1); do not overwrite.
- `conflict` with `reason` `symlink` or `not-regular`: report it, do not touch it.
- Fatal errors: `agents-md-missing` means go back to step 6 and render again; `agents-md-invalid` means step 0b;
  `render-invalid` means step 5; `path-escape` means stop and show `file`; `write-failed` means show `file` and
  `message`, and tell the user a second run will pick up where this one stopped. Anything else: show `code` and
  `message`, stop.

Also show the CLI's `notices` to the user (stale files left in place, a missing constraints file, ignored
`--overwrite`).

## 9. Recommend the plugin to teammates

Copy the fragment in `assets/marketplace-entry.json` into the repo's `.claude/settings.json`:

1. File absent: create it with exactly that fragment.
2. File present: parse it as JSON. If it does not parse, stop and show the error; never rewrite a file you cannot parse.
3. `extraKnownMarketplaces.liftoff`: add it **only if absent**. If one exists with a different `source`, report both and
   leave it.
4. `enabledPlugins["liftoff@liftoff"]`: add `true` **only if absent**. If it is `false`, report it and leave it (the
   user opted out).
5. Keep every other key untouched and **keep the file's indentation** (2 spaces if you cannot tell).
6. **Always show the result before writing** (a diff, or the full content for a new file), and write only on approval.

If the user declines the recommendation, skip this step: write nothing, and say in the summary that teammates will not be
prompted to install the plugin and must install it by hand. Only `.claude/settings.json` is written.

## 10. Verify and summarize

- Run `check-config` again: it should be `ok` (or `warn` only for conflicts the user kept).
- Every path named in `AGENTS.md` exists; the root `AGENTS.md` has `## Rules that always apply`; `liftoff.yaml` and
  `.claude/settings.json` parse; the files to commit are **not gitignored** (`git check-ignore`).
- Summary: files created, changed and skipped; conflicts left; the CLI's `notices`; unverified commands; the next step
  (commit `liftoff.yaml`, the `AGENTS.md` files, `CONSTRAINTS.md`, the generated `CLAUDE.md` and
  `.github/copilot-instructions.md`, and `.claude/settings.json`; `.liftoff/` ignores itself). Offer `git init` if there
  was no repo. **Never commit without asking.**

## Apply mode, in short

No questions (this version has no personal ones). Create the `AGENTS.md` files that are missing (step 6), run `render`
(step 8), resolve conflicts with the user, add the plugin recommendation if it is missing (step 9), verify (step 10).
A teammate whose agent is not in `agents.targets` gets no file for it: say so, and suggest asking the lead to add it.
Expect the agent to ask for approval of shell calls; those are not your questions.
