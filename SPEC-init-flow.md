# Spec: `init-flow`

Module 4 of 5 in `SPEC.md`. Depends on `cli`. Status: **review findings applied (2026-11-07), awaiting final approval**.

Reviewed by a fresh-context Opus agent on 2026-11-07; its findings are applied here. Two small amendments followed in approved specs: `SPEC-cli.md` (`check-config` read failures come back as a `CheckResult`; new code `agents-md-invalid`) and `SPEC-agent-render.md` ("Existing files" now says fold, then `--overwrite`).

## Objective

The **Init Agent Skill** (`plugin/skills/liftoff-init/SKILL.md`), forked from the personal `project-init` skill and rebuilt around `liftoff.yaml` and the `liftoff` CLI. One flow, in Claude Code or GitHub Copilot, turns a repo into an AI-native one:

- **No config in the repo → interview mode.** One short interview, then the skill writes `liftoff.yaml`, the `AGENTS.md` files and `CONSTRAINTS.md`, and renders the per-agent files.
- **Config present → apply mode.** No interview, no questions (v1 has no personal questions). The skill creates what is missing, renders, and resolves file conflicts with the user.

The skill is instructions only. Everything deterministic (validate, plugin pin, hashes, rendering, safe writes) is done by the CLI. The skill decides nothing the CLI can decide.

Success: zero to AI-ready in < 10 min without a team config, ~1 min with one (the pilot's Init-time metric); a teammate cloning a repo with a config gets the same files with no questions.

## Scope: what v1 Init does and does not do

**In (v1 core):** mode detection, stack/module detection, the interview, `liftoff.yaml`, root and per-module `AGENTS.md`, `CONSTRAINTS.md` with defaults, `liftoff render` (per-agent files), the plugin-recommendation settings file (owned by `plugin-packaging`), verification, summary.

**Deferred past v1 (decided 2026-11-07):** subagent suggestion and generation, the `implement` orchestrator, formatter hook, `.mcp.json` and permission presets, CI workflow, wiki, Graphify, and **reorganizing an existing repo's folders** (steps 6-8, 10, 12 of `project-init`). They are Claude-Code-only or need agent-specific features, they add most of the Init time, and the pilot's key signal (Plan/Build usage) belongs to roadmap items 2-3. They return as optional add-ons.

## Behavior

The skill text relies only on what every agent has: reading and writing files, the shell, and asking the user. "Ask the user" means the structured question tool if the agent has one, otherwise chat.

Conventions for every step:
- `<cli>` = `node "<abs path to liftoff.mjs>"`. The skill resolves `scripts/liftoff.mjs` against the directory it loaded `SKILL.md` from (shell cwd is the repo, so a relative path would not resolve) and calls it by absolute path. **Every path is quoted** (spaces, Windows). The exact `SKILL.md` wording (the `${CLAUDE_SKILL_DIR}` form, and the fallback when a host does not substitute it) is fixed in `SPEC-plugin-packaging.md` Decision 4.
- Backups, copies and directory creation use the agent's **file tools**, not `cp`/`mkdir` (Copilot on Windows runs PowerShell).
- `--root R` is always the absolute repo top level.

### 0. Environment and root
- Root = `git rev-parse --show-toplevel` (the **skill** may call git, the CLI may not). No git, or `git` missing: treat as "no repo", use the current directory, offer `git init` in the summary.
- `node --version` must be >= 22.12. `node` missing or older: stop with a clear message (the bundle would otherwise fail to parse and print nothing).

### 0b. Symlinked `AGENTS.md` (both modes, before anything else is written)
If the root or any module `AGENTS.md` is a symlink, show what it points to. The common case is `AGENTS.md -> CLAUDE.md`: folding into it would write through the link into `CLAUDE.md`, and `--overwrite CLAUDE.md` would then destroy the only copy. Ask to replace it with a regular file holding the target's content (back it up first). Do not continue until none is a symlink. The CLI's `agents-md-invalid` check is the second line of defense.

### 1. Route by `check-config`
Run `<cli> check-config --root R` and branch on `status` and **every** `reasons[].code` (the CLI collects all of them), never on prose:

| Result | Action |
|---|---|
| exit 2, `usage`/`internal`, or stdout that is not JSON | Show `message` or stderr. Stop. |
| `blocked` + `plugin-outdated` | Stop. Tell the user to update the plugin to at least `minimum`, and how: *Claude Code: run `/reload-plugins`, or `/plugin marketplace update liftoff`; VS Code: update or reload the plugin.* Change nothing. |
| `blocked` + `config-missing` | Interview mode. Read `installedVersion` for step 5. If `hint.nearestRoot` is set **and `<nearestRoot>/liftoff.yaml` exists**, ask whether to use that root instead of starting a second config. |
| `blocked` + `config-invalid` | Show `errors` (`path`, `line`). Offer a fix **as a diff, with approval**. If `git ls-files --error-unmatch liftoff.yaml` says the file is tracked, say "ask the lead" instead of editing. |
| `blocked` + `not-applied` or `required-changed` | Apply mode. |
| `warn` + `optional-changed` | Apply mode, no prompt: apply and report what changed. |
| `warn` + `unresolved-conflict` | Offer to resolve the listed files (step 8). Otherwise leave them. |
| `ok` | Still run `render` (step 8): hashes don't see a deleted or hand-edited rendered file or a missing module `AGENTS.md`. `render` is idempotent. Say "already up to date" only if every file comes back `unchanged`. |

### 2. Detect
- **Interview mode:** read manifests to pre-fill modules, stack and commands (`references/stack-commands.md`, copied from `project-init`): Gradle/Maven, `package.json` workspaces, Capacitor/React Native, test and e2e configs, Dockerfile, CI, IaC. `project.kind` = `existing` if a manifest or source directory exists, else `new`. Show findings as defaults.
- **Apply mode:** detect only for module paths that have no `AGENTS.md` yet.

### 3. Interview (interview mode)
**One question round (at most 4 questions), then one confirmation:**
1. Project name and one-line purpose.
2. Modules, stack per module, and layout for `new` projects (monorepo `backend/ frontend/ shared/ [infra/]` or single-app). Existing repos keep what they have.
3. Agents to target, multi-select (`claude-code`, `copilot`). Default: the one the user is running.

Not asked in v1: which sections are `required` (defaults: `constraints.required: true`, nothing else; a lead edits by hand), constraint thresholds (template defaults), extras. Then print a recap table (config values and files to create) and get a **yes before writing anything**.

### 4. Layout (interview mode)
`new`: create only the module folders in the config. `existing`: **never move or rename files**; modules map to paths that exist.

### 5. Write `liftoff.yaml`, validate
Fill `assets/liftoff-yaml-template.yaml`: `liftoff: 1`; `plugin.version` = `major.minor` of `installedVersion`; `project.name`, `project.kind`; `agents.targets`; `stack`; `modules.items[]`; `constraints: { required: true, file: CONSTRAINTS.md }`. `tracker` and `codeHost` are omitted. The purpose goes to `AGENTS.md`, not the config. Start the file with the modeline `# yaml-language-server: $schema=https://raw.githubusercontent.com/saugion/liftoff/v<installed version>/schema/liftoff.schema.json` (autocomplete and errors in VS Code with the Red Hat YAML extension).

Module rules:
- A single-app repo whose code sits at the root gets **`modules.items` empty** (the root `AGENTS.md` covers it). Never emit a path of `.`, and never two items with the same path.
- `id` = kebab-case of the folder name (lowercase; `_` and `.` become `-`). If two folders share a name, use the full path (`apps/web` → `apps-web`).

Then **write → `<cli> validate --root R` → fix → repeat**, at most 5 rounds. Fix only by correcting what the skill derived or the user gave; never delete a key to pass, never touch the schema. After 5 rounds, stop and show the errors. A later `render-invalid` (e.g. a path collision) is handled the same way: show `path`, fix the config, re-validate, re-run render.

### 6. `AGENTS.md` files
- **Before the first backup of the run**, make sure `<root>/.liftoff/.gitignore` exists containing `*` (same content the CLI writes), so backups can never be committed. **Backups never overwrite an existing one**: `.liftoff/backup/<path>`, else `<path>.1`, `.2`, …
- Root, from `assets/agents-md-template.md`. Sections: overview, modules table, commands, **`## Rules that always apply`**, quality bar (points to `CONSTRAINTS.md`), conventions, key paths, the list of rendered agent files. Apply mode with no `AGENTS.md` (a lead authored the config first): fill from the config; purpose becomes `<!-- TODO: purpose -->`, no question.
- Each module, from `assets/module-agents-md-template.md` (stack, build/test/lint/run commands, local rules). Apply mode with a new module: detect that module only, `TODO` where unknown, and propose the new row of the root modules table **as a diff with approval** (the table is how VS Code Copilot learns a module exists).
- **Rule from `agent-render` Decision 5:** VS Code Copilot loads only the root `AGENTS.md` by default. Anything an agent must follow on every task goes in the root's `## Rules that always apply`; module files hold local specifics only. The root template tells agents to **read a module's `AGENTS.md` before working under its path** (a cheap cross-agent mitigation of that limit).
- **Existing `AGENTS.md`** ("non-trivial" = any non-whitespace content) is never replaced: show an additive diff (missing sections appended), apply on approval, back up first.
- Interview mode with an existing `CLAUDE.md` and no `AGENTS.md`: fold it into the new `AGENTS.md` here (rules in step 8), so the user sees **one** diff.

Template changes versus `project-init`: no Agents table or `/implement` text; no `Owner:` line; key paths drop `.claude/agents/`, `.claude/skills/implement/` and `.scratch/`; the context7 line is dropped (not every agent has it); the "do not load nested AGENTS.md" line is replaced as above.

### 7. `CONSTRAINTS.md`
Create from `assets/constraints-template.md` if missing. An existing one is untouched.

### 8. Render and resolve
Run `<cli> render --root R` and handle each `files[]` entry by `action`:

- `created`, `refreshed`, `unchanged`, `skipped-symlink`: nothing to do; list in the summary.
- `conflict` with reason `no-marker` or `hand-edited` (a hand-written `CLAUDE.md` or `copilot-instructions.md`): the CLI never merges, so the skill **folds the file into the single source**:
  1. **Personal file check:** if `git ls-files --error-unmatch` / `git check-ignore` says the file is untracked or ignored, it is personal. Warn, offer `CLAUDE.local.md` instead, and do not fold.
  2. **Secret scan:** if the content matches the `config-schema` secret-guard patterns (`ghp_`, `github_pat_`, `glpat-`, `lin_api_`, `xox`, URLs with userinfo), refuse to fold and say why.
  3. **Destination:** a module `CLAUDE.md` folds into that module's `AGENTS.md`; the root `CLAUDE.md` and `copilot-instructions.md` fold into the root `AGENTS.md`, with rules that apply to every task under `## Rules that always apply`.
  4. **Claude-only content** (`@path` imports, which Copilot reads as literal text; slash commands; subagent names): flag it and propose rewording or dropping.
  5. Show the result as a diff, get approval, **back up both the source file and the destination `AGENTS.md`** (never overwriting an earlier backup).
  6. Append, wrapped in `<!-- liftoff: folded from <path> -->` … `<!-- liftoff: end folded -->`. **If that marker already exists, skip the fold** (so a re-run after a failure does not duplicate it).
  7. **Batch** every approved file into one `<cli> render --root R --overwrite <a> --overwrite <b>`.
  8. If the user declines, leave the file; it stays reported as unresolved.
- `conflict` with reason `newer-generator`: tell the user to update the plugin; do not overwrite.
- `conflict` with reason `symlink` or `not-regular`: report, do not touch.
- Fatal `agents-md-missing`: back to step 6, then re-run. `agents-md-invalid`: step 0b. `render-invalid`: step 5. Any other fatal error: show `code` and `message`, stop.

### 9. Plugin recommendation
Copy the fragment from `assets/marketplace-entry.json` into `.claude/settings.json` by the six rules in `SPEC-plugin-packaging.md`: add only if absent; a different existing marketplace `source`, or `enabledPlugins: false`, is reported and left; keep the file's indentation; an unparsable file stops the step; **always show the result before writing** (the diff, or the full content for a new file).

### 10. Verify and summarize
- `<cli> check-config --root R` returns `ok` (or `warn` only for conflicts the user kept).
- Every path named in `AGENTS.md` exists; root `AGENTS.md` has `## Rules that always apply`; `liftoff.yaml` and `.claude/settings.json` parse; files to be committed are **not gitignored** (`git check-ignore`).
- A stack command is "checked" when its script, task or wrapper **exists**. It is executed only with the user's consent; otherwise mark it `(unverified)`.
- Summary: files created, changed, skipped, conflicts left, **the CLI's `notices`** (stale files, missing `constraints.file`), unverified commands, next step (commit `liftoff.yaml`, `AGENTS.md` files, `CONSTRAINTS.md`, the rendered files and `.claude/settings.json`; `.liftoff/` is self-ignored). Offer `git init` if there was no repo. **Never commit without asking.**

## Apply mode and personal questions

README promises that a teammate is asked only personal things: credentials, agent choice, code host CLI. In v1 none exist: no credentials, no personal overrides of default sections (CLI spec), no code host. So **v1 apply mode asks nothing** except to resolve conflicts. Expect agent *approval prompts* for each shell call (5-8 clicks by default in both agents); these are not skill questions. `plugin-packaging` scopes an `allowed-tools` rule to the skill, which removes the prompt for the CLI calls of a turn in Claude Code only (the grant ends at the user's next message, so after any plain-chat question the prompts return). A teammate whose agent is not in `agents.targets` gets no file for it; the skill says so and suggests asking the lead to add it.

## Project Structure

```
plugin/skills/liftoff-init/SKILL.md
plugin/skills/liftoff-init/assets/liftoff-yaml-template.yaml
plugin/skills/liftoff-init/assets/agents-md-template.md          (fork of project-init, cleaned as listed above)
plugin/skills/liftoff-init/assets/module-agents-md-template.md
plugin/skills/liftoff-init/assets/constraints-template.md
plugin/skills/liftoff-init/assets/marketplace-entry.json         (generated by the build, see plugin-packaging)
plugin/skills/liftoff-init/references/stack-commands.md          (copied from project-init)
test/skills/template-drift.test.ts
```

`project-init` itself is left untouched; this skill copies only what v1 needs.

## Testing Strategy

The skill is agent behavior and can't be unit-tested. Two layers:

1. **Automated, tiny:** `template-drift.test.ts` (a) fills `liftoff-yaml-template.yaml` with sample values and asserts `validateConfig` accepts it; (b) asserts the strings `Owner:`, `.claude/agents`, `/implement`, `.scratch`, `context7` and `Do not load nested` are **absent** from the AGENTS templates.
2. **Manual checklist, run in Claude Code and in VS Code Copilot** (`SPEC.md` Testing Strategy), each on a real repo. Record time and the number of approval prompts.
   - empty new repo, interview mode: ends with `liftoff.yaml`, root and module `AGENTS.md`, `CONSTRAINTS.md`, per-agent files, `.claude/settings.json`; time it (< 10 min);
   - clone it, run Init again as a teammate: zero questions, `ok` (~1 min plus approval prompts);
   - re-run on an up-to-date repo: "already up to date", nothing written;
   - delete a rendered file, re-run: it is recreated;
   - teammate after an **optional** change by the lead: applied with no prompt;
   - lead edits `liftoff.yaml` (adds a module), re-run: the new module's `AGENTS.md` and `CLAUDE.md` appear, a root modules-table row is proposed as a diff;
   - **lead-authored config with no `AGENTS.md`**: files created from the config, purpose `TODO`;
   - existing repo with a hand-written `CLAUDE.md`: folded into `AGENTS.md`, backups in `.liftoff/backup/`, then `--overwrite`; a hand-written **module** `CLAUDE.md` folds into that module's `AGENTS.md`;
   - **reverse symlink** `AGENTS.md -> CLAUDE.md`: Init stops at step 0b, nothing lost;
   - fold interrupted (make `render` fail with `write-failed`), re-run: no duplicate block, the first backup is kept;
   - untracked/ignored `CLAUDE.md`: not folded, `CLAUDE.local.md` offered; file with a token pattern: not folded;
   - decline the fold: file untouched, `check-config` returns `warn`;
   - plugin older than the pin: Init stops, changes nothing; missing or old Node: stops with a clear message;
   - invalid `liftoff.yaml`: errors with line numbers, a fix offered as a diff, no silent writes;
   - single-app repo with code at the root: `modules.items` empty, no `render-invalid`;
   - no git repo: `git init` offered, never forced; nothing committed automatically.

## Boundaries

- **Always:** route on the CLI's `status` and codes; pass an absolute `--root`; quote paths; get a yes on the recap before writing; show a diff before touching any hand-written file; back up before replacing or appending (never overwriting a backup); keep always-needed rules in the root `AGENTS.md`.
- **Ask first:** adding a question to the interview (cap: 4 plus the confirmation); re-adding a deferred extra; any file outside the list in "Scope"; changing the `liftoff.yaml` fields Init writes (schema change).
- **Never:** write credentials or tokens anywhere; replace an existing `AGENTS.md` or `CONSTRAINTS.md`; write through a symlinked `AGENTS.md`; fold a personal (untracked/ignored) file or one containing secrets; move or rename files in an existing repo; weaken the schema or delete a config key to pass `validate`; commit or push without being asked; create anything the user did not select or approve; guess an answer the CLI can give.

## Success Criteria

- Init on a new empty repo ends with `liftoff.yaml`, root `AGENTS.md`, `CONSTRAINTS.md`, per-agent files and `.claude/settings.json`, in Claude Code and in VS Code Copilot.
- Re-running Init on a repo with a config asks no questions in v1, and on an up-to-date repo writes nothing.
- A hand-written `CLAUDE.md` or `copilot-instructions.md` is never lost: it is folded into `AGENTS.md` with approval and backed up, a re-run never duplicates it, and a reverse-symlinked `AGENTS.md` cannot wipe instructions.
- Template-drift test green; the manual checklist passes in both agents and the Init times are recorded.

## Open Questions

1. ~~Deferred extras~~ — decided 2026-11-07 (see Scope). The README's Init section (lines 52-57) is reworded when v1 ships.
2. ~~Where `liftoff.mjs` lives~~ — settled in `SPEC-plugin-packaging.md`: committed at `plugin/skills/liftoff-init/scripts/liftoff.mjs`; Claude Code uses `${CLAUDE_SKILL_DIR}/scripts/liftoff.mjs` and `allowed-tools` in the skill frontmatter for the no-prompt case; other hosts resolve against `SKILL.md`'s directory. Still to check in VS Code and Cowork (its manual checklist).
3. **Teammate's agent not in `targets`.** v1: a note only. A personal `agents` override is later.
4. **A kept hand-written file keeps `check-config` at `warn`** (no "accepted conflict" in the CLI). Accepted for the pilot; a `cli` follow-up if it annoys people.
5. ~~README's `AGENTS.local.md`~~ — decided 2026-11-07: out of v1; README reworded.
6. **Question tools differ by agent.** Check in the manual run that Copilot handles a one-round, 3-4 question interview acceptably.
7. ~~`$schema` modeline~~ — settled: raw URL at the release tag (`saugion/liftoff`, public).
8. ~~`plugin-packaging` owns the settings entries and the repo~~ — settled in `SPEC-plugin-packaging.md` (`saugion/liftoff`).
9. **Fold content is judgment.** Steps 8.1-8.4 depend on the agent reading a file well; the pilot checklist is the only test. If it proves flaky, a CLI helper for the secret scan is the first candidate.
