---
name: liftoff-init
description: >
  Make a repository AI-native for Claude Code and GitHub Copilot from one team config. A new project starts LiftOff's
  setup guide in the browser (a product owner, then a technical lead); a project with a team config applies it:
  AGENTS.md files, CONSTRAINTS.md and the thin per-agent files (CLAUDE.md, .github/copilot-instructions.md).
  Use when the user says "liftoff init", "init project", "set up this repo for AI agents", "apply the team config",
  or when a repo has a liftoff.yaml that was never applied on this machine.
license: Apache-2.0
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff-ui.mjs" *)
---

# LiftOff Init

Turns a repo into an AI-native one. **No `liftoff.yaml` in the repo, or one whose `project.setup` is `po`: guided
setup.** You do not interview anyone: you start LiftOff's setup guide, a page in the browser that asks a product owner
about the project and its Jira tickets, then a technical lead about the code, and saves both to the team on their yes.
**`liftoff.yaml` complete: apply mode.** No questions: you create what is missing, render, and resolve file conflicts
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

The setup guide is `bin/liftoff-ui.mjs`, next to the CLI (`../../bin/liftoff-ui.mjs` from here). It listens on this
computer only, and prints one `Open: <address>` line.

Commands: `validate`, `check-config`, `render [--overwrite <path>]...`, and, only when `liftoff.yaml` has a `brain` section, `brain-init [--write]` and `brain-check`. Stdout is always **one JSON document**; read it
whatever the exit code (exit 1 is a normal state, e.g. the config is missing). Exit 2 or stdout that is not JSON
means something is wrong with the environment: show `message` or stderr and stop.

Other conventions: ask the user with your structured question tool if you have one (in Claude Code that is
AskUserQuestion, which also keeps the CLI approvals alive); otherwise ask in chat. Show diffs as fenced `diff`
blocks. Do backups, copies and directory creation with your **file tools**, not `cp` or `mkdir` (Copilot on Windows
runs PowerShell).

## 0. Environment and root

1. Root = `git rev-parse --show-toplevel`. If that fails (no repo, or no `git`), use the current directory, remember
   there is no repo, and offer `git init` in the summary (never force it). **Not when folders directly below hold a `.git` of their own:** a plain
   `git init` is wrong there; the setup page offers a configuration repository for that. Use the root as `--root` for every call.
2. `node --version` must be 22.12 or newer. If `node` is missing or older, stop with a clear message: the CLI would
   fail to start and print nothing.

## 0b. A symlinked AGENTS.md (before anything is written)

(Detect a symlink with `test -L <path>` or `ls -l`.)

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
| `blocked` + `config-missing` | **Guided setup** (step 2). If `hint.nearestRoot` is set **and `<nearestRoot>/liftoff.yaml` exists**, first ask whether to use that root instead of starting a second config. |
| `blocked` + `config-invalid` | Show `errors` (`path`, `line`). Offer a fix **as a diff, with approval**. If `git ls-files --error-unmatch liftoff.yaml` says the file is tracked, say "ask the lead" instead of editing. |
| `blocked` + `not-applied` or `required-changed` | **Apply mode**, unless `liftoff.yaml` has `setup: po` under `project`: then **guided setup** first (step 2), the technical lead's part. |
| `warn` + `optional-changed` | Apply mode, no prompt: apply, and report what changed. |
| `warn` + `unresolved-conflict` | Offer to resolve the listed files (step 8). Otherwise leave them. |
| `ok` or `warn`, and `liftoff.yaml` has `setup: po` under `project` | **Guided setup** (step 2): the product owner's part is saved, the technical lead's is not. |
| `ok` | Still run `render` (step 8): hashes do not see a deleted or hand-edited generated file, or a missing module `AGENTS.md`. `render` is idempotent. Say "already up to date" only if every file comes back `unchanged`. |

## 2. Guided setup

The setup is a form, not a chat: a product owner can answer it without knowing anything technical. **Do not ask the
project questions yourself, and do not write `liftoff.yaml`, `AGENTS.md` or `CONSTRAINTS.md` in this mode:** the page
does, with the same templates, and shows the person every file before it is saved.

1. Start it in the background (your host's way of running a command without waiting for it):
   `node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff-ui.mjs" --root "<root>"`. Read its first lines: `Open: <address>`.
   Node older than 22.12, or no `Open:` line: show the error and stop.
2. Tell the user, in two sentences: open that address in the browser (it works only on this computer, for this
   session); it takes about ten minutes; a first-time setup asks about the project, Jira and the ticket templates, and
   a second person (the technical lead) finishes the technical part later. If `setup: po` is already in the file, say
   it is the technical part. Nothing leaves the computer until the last page, where they decide whether to save.
3. Wait. The page will say when it is done. If the user comes back with a problem, read what they describe; do not
   edit the files the page wrote.
4. When they say they finished, stop the background process, run `check-config` and report: `ok`, or what it says.
   Remind them that a branch `liftoff/setup-po` (or `-tl`) was saved and that the team gets it when it is merged.

## 6. AGENTS.md files (apply mode: create what is missing)

- **Before the first backup of the run**, make sure `<root>/.liftoff/.gitignore` exists and contains `*` (create it with
  your file tools if missing), so backups can never be committed. **A backup never overwrites an existing one**: use
  `.liftoff/backup/<path>`, or `<path>.1`, `.2`, ... if that exists.
- **Root:** fill `assets/agents-md-template.md`. Modules table (columns Module, Path, Stack, Description), commands table (columns Module, Task, Command; mark any command you did not run
  `(unverified)`; `references/stack-commands.md` lists what each manifest tells): a command counts as checked only when its script, task or wrapper exists; run one only with the
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

## 6b. The project brain (**only when `liftoff.yaml` has a `brain` section**)

No `brain` section: skip this whole step and every brain line in steps 10 and the apply-mode summary. Init never asks
about the brain and never writes the `brain` section: the lead adds it with the Brain skill (Setup).

1. Run `brain-init` without `--write`. Report `paths` and which `files` say `create`. The files are only added, never
   overwritten, and sit inside `<dir>` and `.liftoff/brain`.
2. Show the list first and ask once. Then run `brain-init --write`.
3. **The `proposals` are the lead's, not yours.** They change files the whole team shares (the pointer block in the root
   `AGENTS.md`, the Claude and VS Code settings, the `.gitattributes` line), and the lead decided them in the Brain
   skill's Setup, including which to decline. Init **never edits them**, so a teammate is never asked a team question.
   For each entry, look at the repo: if it is already there, say nothing; if it is missing, do not add it and put one
   line in the summary: "tell the lead: <what is missing, and what that means>". What it means:
   - `agentsMd` missing: the agents are not told the wiki exists.
   - `claudeSettings` missing (target `claude-code`): nothing stops an edit of a raw source; `brain-check` catches one
     afterwards (`source-changed`).
   - `vscodeSettings` missing (target `copilot`): the same; VS Code only asks for approval on `raw/` edits and cannot block them.
   - `gitattributes` missing: two branches that append to the same log file can conflict.
   A lead who wants them now runs the Brain skill (Setup, step 3).

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
- Fatal errors: `agents-md-missing` means create it (step 6) and render again; `agents-md-invalid` means step 0b;
  `render-invalid` means show `path` and ask the lead to fix `liftoff.yaml` (the control panel, or the setup guide); `path-escape` means stop and show `file`; `write-failed` means show `file` and
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

If the user declines the recommendation, skip this step (`check-config` does not depend on it and will not nag): write nothing, and say in the summary that teammates will not be
prompted to install the plugin and must install it by hand. Only `.claude/settings.json` is written.

## 10. Verify and summarize

- Run `check-config` again: it should be `ok` (or `warn` only for conflicts the user kept).
- Every path named in `AGENTS.md` exists; the root `AGENTS.md` has `## Rules that always apply` (an existing root file without it, in
  either mode: propose adding the heading as an additive diff with approval, never rewrite the file); `liftoff.yaml` and
  `.claude/settings.json` parse; the files to commit are **not gitignored** (`git check-ignore`).
- **Only when `brain` is set:** `git check-ignore` must say the brain folder (`brain.dir`, the `dir` in `brain-init`'s
  `paths`) is **not** ignored and `.liftoff/brain/hot.md` **is**. Run `brain-check` once and report it (a fresh clone
  of a team's brain is `ok`). The summary lists every "tell the lead" line from step 6b and says the personal layer
  under `.liftoff/brain` is never committed; the shared brain files came with the clone, so there is nothing of the brain to commit.
- Summary: files created, changed and skipped; conflicts left; the CLI's `notices`; unverified commands; the next step
  (commit `liftoff.yaml`, the `AGENTS.md` files, `CONSTRAINTS.md`, the generated `CLAUDE.md` and
  `.github/copilot-instructions.md`, and `.claude/settings.json`; `.liftoff/` ignores itself). Offer `git init` if there
  was no repo. **Never commit without asking.**
- **A teammate (apply mode) whose config has a `tracker`:** end the summary with the next step, in these words: "Next: connect to
  Jira. Say *connect me to Jira* (the Connect skill)". Do not tell them that Jira, `/liftoff-connect` or the Ticket and Plan skills
  "do not work until the server connects": Connect is what connects it.

## Apply mode, in short

No questions (this version has no personal ones). Create the `AGENTS.md` files that are missing (step 6), create the brain structure when `brain` is set (step 6b), run `render`
(step 8), resolve conflicts with the user, add the plugin recommendation if it is missing (step 9), verify (step 10).
A teammate whose agent is not in `agents.targets` gets no file for it: say so, and suggest asking the lead to add it.
Expect the agent to ask for approval of shell calls; those are not your questions.
