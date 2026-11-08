# Spec: Plan and Build (MVP, roadmap item 3)

Builds on v0.2.0 (Init, Connect). Source of product decisions: `README.md`, sections "3. Plan", "4. Build", "Core principle". Written and approved autonomously on 2026-11-08 (see `DECISIONS-plan-build.md`; the PM reviews afterwards). **Close, the Ticket flow, work streams and `doctor` are out** (README pilot scope: "Init + Connect + Plan/Build first. Close joins once those hold").

## Objective

An engineer picks a ticket; the agent reads it **the way the team writes tickets** (the reading map learned by Connect), produces a **local implementation plan** the engineer approves in one step (Plan); then implements the approved plan, one section at a time, and prepares a branch and a merge request on **the team's conventions** (Build). The engineer reviews everything; every write to the tracker or the code host is shown first and applied only on approval.

Two skills (`liftoff-plan`, `liftoff-build`) and two pure CLI commands (`parse-ticket`, `plan`). Nothing is reimplemented: the ticket is fetched by the agent through the Jira MCP server, the code host is reached with `git` and `glab`. The CLI stays pure (no network, no credentials, no child process).

## Decisions

1. **Plan writes nothing outside the repo.** No tracker write, no branch. The plan is a Markdown file at `.liftoff/plans/<KEY>.md` (personal, self-ignored by `.liftoff/.gitignore`, never committed by accident).
2. **A plan is a numbered list of sections with checkboxes** and a small front matter (`ticket`, `status`, `approvedHash`). Format below; the CLI validates it and tracks approval and progress.
3. **Approval is a hash.** `plan --approve` records the hash of the plan body with checkbox state normalized away. Build refuses a plan that is not approved or that changed after approval (`stale`). Ticking checkboxes while building never makes it stale.
4. **Build asks twice, not once.** A first dry-run (create the branch, move the ticket to the `start` transition) and a second at the end (push, open the merge request). The README says "approved together"; the MR cannot be shown before the code exists, so each group is approved together.
5. **Reading map drives the reading.** `parse-ticket` applies `tracker.issueTypes[].readingMap` to the ticket JSON the agent fetched and reports what it found and what is missing. An issue type unknown to the config is read with defaults and a warning that points back to the Connect lead flow.
6. **Branch, title, labels, reviewers, target branch, MR template** come from `codeHost.conventions` through `parse-ticket`'s `build` object; the `glab mr create` command is built by the CLI and quoted with `shQuote`; the skill never assembles it.
7. **Git is a team option.** `build.git` in `liftoff.yaml` (`assisted` default, `manual`) decides who runs git writes; see `DECISIONS-ticket-streams.md` item 12. In `manual` the agent never writes to git and never opens the MR.
8. **Never:** merge, force-push, push to the target branch, skip hooks, delete a ticket or a branch, write to the tracker beyond the `start` transition, commit without the plan's approval, put a credential anywhere.

## CLI

Both commands read the config with the pin-first read, so `plugin-outdated`, `config-missing`, `config-invalid` are the fatal shape of `connect-info`. Two new error codes (kept out of `ErrorCode`, which belongs to v1): `no-tracker`, `ticket-invalid` (parse-ticket); `plan-missing`, `plan-invalid` (plan).

### `liftoff parse-ticket --root <abs> --file <ticket.json>`

`--file` is the JSON the agent got from `jira_get_issue` (`fields="*all"`, `expand=renderedFields`), saved with its file tools. Read-only.

```json
{ "ok": true,
  "ticket": { "key": "PROJ-123", "url": "https://jira.company.local/browse/PROJ-123", "summary": "...", "issueType": "Story", "status": "To Do", "description": "..." },
  "known": true,
  "reading": { "acceptanceCriteria": { "source": "heading|field|none", "text": "..." }, "fields": [ { "id": "customfield_10016", "label": "Story points", "value": "5" } ] },
  "warnings": [ { "code": "unknown-issue-type|no-acceptance-criteria|empty-description|field-missing", "message": "..." } ],
  "build": { "branch": "feature/PROJ-123-add-login", "title": "PROJ-123: Add login", "targetBranch": "main"|null,
            "labels": [], "reviewers": [], "mrTemplate": ".gitlab/...md"|null,
            "transitions": { "start": {"name": "...", "fields": {}}|null, "review": ...|null },
            "readOnly": false, "planFile": ".liftoff/plans/PROJ-123.md", "mrDescriptionFile": ".liftoff/plans/PROJ-123.mr.md",
            "mrCreate": "glab mr create ... "|null } }
```

Tolerant input: issue type at `issue_type.name`, `issuetype.name` or `fields.issuetype.name`; summary, description, status likewise at the top level or under `fields`; a custom field by id at the top level, under `fields`, or under `custom_fields`; a value that is `{value}`/`{name}`/a list is flattened to text. Acceptance criteria: by `field` the field's text; by `heading` the text under the first heading whose title equals the configured heading case-insensitively (Markdown `#`, Jira wiki `hN.`, HTML `<hN>`), until the next heading; none configured: the same search for "Acceptance criteria". `key` must match `^[A-Z][A-Z0-9_]+-[0-9]+$` and must belong to `tracker.project`, else `ticket-invalid`. No tracker in the config: `no-tracker`.

Branch: `branchPattern` (default `{key}-{slug}`) with `{key}`, `{type}` (`branchType`, else the issue type lowercased and slugified), `{slug}` (summary: lowercase ASCII, non-alphanumerics to `-`, collapsed, at most 40 chars, no leading or trailing `-`; empty becomes `work`). Title: `titlePattern` (default `{key}: {summary}`, summary cut at 120). `mrCreate` is `null` without a `codeHost`; otherwise `glab mr create --source-branch B --target-branch T --title TITLE --description-file F --label L... --reviewer R... --yes` (target omitted when not configured; every dynamic part single-quoted).

### `liftoff plan --root <abs> --key <KEY> [--approve]`

Validates `.liftoff/plans/<KEY>.md`, reports status and progress; with `--approve` records approval (writes only the front matter, and `.liftoff/.gitignore` if missing).

```markdown
---
ticket: PROJ-123
status: draft
---
# Plan: PROJ-123 Add login

## 1. Short title of the section
- [ ] one concrete step
- [ ] another step
```

Rules: front matter `ticket` equals `--key`; `status` is `draft` or `approved`; an `approved` plan has `approvedHash`; at least one section; headings `## N. title` numbered 1..n without gaps; each section has at least one checkbox item; no text that looks like a credential (the v1 guard). Output: `{ ok: true, key, path, status, approvedValid, stale, sections: [{n, title, done, total}], done, total }`. `approvedValid` is true when `status` is `approved` and the hash matches the body; `stale` when approved but the hash does not match. `--approve` on an invalid plan is `plan-invalid`; on a valid one sets `status: approved` and `approvedHash`. The hash is `sha256` of the body after the front matter with CRLF turned to LF, `[x]`/`[X]` turned to `[ ]`, trimmed.

## Skill `liftoff-plan`

1. Environment, root, `check-config` (same routing as Init/Connect: stop on `plugin-outdated`, `config-missing`, `config-invalid`; `not-applied` / `required-changed` says to run Init but goes on).
2. Needs a tracker: if `parse-ticket` reports `no-tracker`, point to the Connect skill. If the Jira tools are not available, say to run Connect and restart.
3. **Pick the ticket:** the key from the user, or `jira_search` (`project = <tracker.project> AND assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`, limit 10) and ask which.
4. **Read it:** `jira_get_issue` (`fields="*all"`, `expand=renderedFields`), save the JSON to `.liftoff/tmp/<KEY>.json` with file tools (create `.liftoff/.gitignore` with `*` first if missing), run `parse-ticket`. Show the reading (summary, acceptance criteria and where they came from, relevant fields) and every warning. A missing acceptance criterion is asked, never invented.
5. **Understand the code:** read the root `AGENTS.md`, `CONSTRAINTS.md`, the module `AGENTS.md` of the paths involved, then the code. Ask the engineer for anything the ticket leaves open (one round).
6. **Write the plan** in the format above with the file tools; each section independently reviewable, naming the files and the check that proves it; the last section runs the repo's checks. Run `plan`; fix until `ok`.
7. **Review:** show the plan, take edits, run `plan` again. **One approval for the whole plan:** on a yes, `plan --approve`. Tell the user the next step is the Build skill.

Never in Plan: write to the tracker, create a branch, change source code, commit.

## Skill `liftoff-build`

1. Environment, root, `check-config`. `git status` must be clean, else ask what to do (never stash or discard).
2. `plan --key`: no plan (`plan-missing`): "run Plan first". `plan-invalid`: show. `status` draft, or `stale`: stop, ask to re-approve through Plan. Otherwise continue; `done`/`total` show where it resumes.
3. `parse-ticket` on the saved ticket JSON (fetch again with `jira_get_issue` if the file is missing or the user asks).
4. **Dry-run 1** (one approval): the branch name, the base (the current branch, or `build.targetBranch`: ask), the `build.transitions.start` transition (or "not available: tracker is read-only / no `start` learned"). On a yes: `git switch -c`, then `jira_get_transitions` to confirm the transition is available, then `jira_transition_issue`. A branch that already exists: ask (resume it or choose another name), never reset it.
5. **Implement section by section:** follow `AGENTS.md` and `CONSTRAINTS.md`; after each section run the section's check, tick its checkboxes in the plan file, and make one commit (message: the ticket key, then the section title). A failing check is fixed or reported, never skipped (no `--no-verify`). A deviation from the plan is told to the engineer and written into the plan file, not done silently; a plan that needs a new section goes back to Plan (re-approval).
6. **Self-check before the MR:** run the repo's checks; compare the diff with the acceptance criteria and the plan; list anything not covered.
7. **MR description:** fill `build.mrTemplate` if there is one (else a short summary), add the ticket URL, the plan summary and the self-check result, write it to `build.mrDescriptionFile` with file tools.
8. **Dry-run 2** (one approval): the commits, `git push -u origin <branch>`, the exact `build.mrCreate` command, the title, the description. On a yes: push, then run `mrCreate` exactly as given. Report the MR URL. **The review transition and the ticket comment are Close, not Build.**
9. Summary: what was done, what was not, what to review first. Never merge, never push to the target branch, never force-push, never commit unapproved plans.

## Project structure

```
src/plan/ticket.ts       → readTicket (tolerant JSON → ticket), acceptance criteria extraction, slug
src/plan/build.ts        → branch, title, mrCreate, build object
src/plan/file.ts         → plan file parse, validate, hash, approve
src/cli/parse-ticket.ts, src/cli/plan.ts, src/cli/main.ts (+ --file, --key, --approve)
plugin/skills/liftoff-plan/SKILL.md, plugin/skills/liftoff-build/SKILL.md
test/plan/*.test.ts, test/fixtures/tickets/*.json
```

## Testing

Unit and CLI tests, no network. `parse-ticket`: each input shape (flat, `fields`, renderedFields HTML, wiki headings, field-based criteria, none); unknown issue type; wrong project; bad key; read-only tracker; hostile summary through `mrCreate` run in a real `sh` (`printf`) must arrive as one literal argument; pattern placeholders; slug edge cases. `plan`: missing, invalid cases (one each), draft, approve, stale after an edit, checkbox ticking keeps it valid, key path traversal, idempotent approve, credential-looking text rejected. Skills: loadable (name, license, exact `allowed-tools`), contract drift (every key and code named exists), every `jira_*` tool is in `JIRA_TOOLS`, the forbidden commands never appear in code spans, the rules are present, packaging file list.

## Boundaries

- **Always:** approve before any write outside the repo's working tree and `.liftoff/`; run what `parse-ticket` returns; keep the plan the source of truth for Build.
- **Ask first:** a new CLI command; a tool outside `JIRA_TOOLS`; writing to the tracker beyond the `start` transition.
- **Never:** see `SPEC-connect.md` shared boundaries, plus: merge, force-push, `--no-verify`, touch the target branch, build from an unapproved or stale plan.

## Open questions (for the pilot)

1. The exact JSON shape of `jira_get_issue` in `mcp-atlassian` 0.23.1 was not verified against a live server; the reader is tolerant and the pilot confirms where custom fields land.
2. Whether engineers want the plan committed (today it is personal and ignored).
3. Whether one MR per ticket is always right (large plans may want several).
4. Close (review transition, summary comment, PR link on the ticket) is the next feature.
