# Spec: `connect-lead`

Module 4 of 4 in `SPEC-connect.md`. Depends on `connect-config`, `connect-wiring`, `connect-member`. Status: **review findings applied (2026-11-07), awaiting final approval**.

Reviewed by a fresh-context Opus agent on 2026-11-07 (it read the `mcp-atlassian` source and the `glab` docs); its findings are applied here.

## Objective

The **lead flow** of the `liftoff-connect` skill: done once, usually by the lead at the real Init, and **resumable**. It connects the lead's own machine (the member flow), then **learns how this team really uses its tracker and its code host** and writes that into `liftoff.yaml`, so every teammate and every later skill (Plan, Build, Close, Ticket flow) reads one validated source.

README, "Onboarding validation": real trackers are messy (workflow validators demand fields the metadata does not declare, transitions differ per type), so a template only becomes reliable by **trying it**. The flow is: start from what exists, test-create one ticket per type, learn from the errors, repeat until each type passes, then write.

It is a reference document, `references/lead-onboarding.md`, loaded by `SKILL.md` when the member flow's step 1 routes the user here: no connector configured and the user is the lead, **or a connector configured but the lead work incomplete**, or an explicit "liftoff connect lead" / "relearn conventions". The reference never contains `${CLAUDE_PLUGIN_ROOT}`: it says "run the CLI exactly as in SKILL.md".

**Where it resumes comes from the config alone:** an issue type that is present in `tracker.issueTypes` has passed; `codeHost.conventions` with anything beyond defaults has been learned. A restart of the agent (normal in Claude Code after the MCP file is written) therefore costs nothing, and adding a connector or an issue type later is the same flow.

## Behavior

Conventions as in the member flow (approval before every write, diffs shown, structured questions when available, nothing committed). Every write to Jira is **announced and approved one ticket at a time**.

### L1. Ask (one round, three questions)
1. The Jira DC base URL and the **real** project key (or "no tracker"). **Only one Jira project is supported** in this release; mention any others as open for later.
2. The GitLab host, defaulting to the host of `git remote get-url origin` (or "no code host").
3. Whether the test tickets of L5 go into the real project (with the `[LiftOff test]` prefix) or into a separate **test project** (its key is kept for the session only and **never written**). `tracker.project` is always the real project. A test project must share the issue-type, field-configuration and workflow schemes with the real one: compare `jira_get_create_fields` for both and warn on any difference, because required fields and workflows are per project.
Then a recap and a **yes before anything is written**.

### L2. Write the base config
Add, with a diff and approval, to `liftoff.yaml` by editing its text (comments stay): `tracker` (`kind: jira-dc`, `url`, `project`, `server.version` = the default pin from `assets/defaults.json`, never below the minimum) and/or `codeHost` (`kind: gitlab`, `host`), and raise `plugin.version` to the installed `major.minor` if it is below `0.2`. Run `validate`; fix only what you wrote; at most 5 rounds. An existing `tracker` is never replaced: the flow resumes.

### L3. Connect this machine
Run steps 2-6 of the member flow for the connectors chosen (prerequisites, credential, preflight, MCP entries, verify Jira, GitLab). Continue only when **each chosen connector** works; otherwise stop at the failing step. In Claude Code the new server's tools usually appear only after a restart, so this step often ends with "restart and run me again": the routing in the member flow's step 1 brings the user back here, at L3.

### L4. Learn the tracker (read only)
1. **Discover the types:** `jira_get_project_issue_types` for the project (it returns ids and names); ask the lead which ones the team uses (multi-select). Types already in `tracker.issueTypes` are skipped unless the lead asks to redo them.
2. **A sample per type:** ask for one existing ticket key per type (the best example the lead has). No sample for a type: offer the built-in default (`assets/defaults/task.md`, `story.md`, `bug.md`) to edit and approve. A **pasted example** (a ticket from another project) is accepted as text: read it like a sample, without calling Jira.
3. **Read it:** `jira_get_issue` with `fields="*all"` and `expand=renderedFields`; `jira_get_create_fields` for the project and the type (it needs the `issue_type_id` from step 1 and returns `field_id`, `name`, `required` and `schema`, **not** the allowed values); `jira_get_field_options` (project key and issue type name) for the allowed values of the fields that matter; `jira_search_fields` to map field names to ids. Custom field ids differ per instance: always use the ids you read, never a remembered one.
4. **Propose the reading map** per type as a table for the lead to edit and approve: where the acceptance criteria live (a custom field whose name looks like "acceptance", else a heading in the description, matched case-insensitively), and which other fields matter (`readingMap.fields`: id and a label). Show the evidence ("the field 'Acceptance Criteria' is `customfield_10201`, filled in the sample").
5. **Propose the template** per type: the description skeleton of the sample (its headings, content stripped) or the default; the lead edits and approves.
6. **Ask for the `branchType`** of each type (what `{type}` means in a branch name: Story `feature`, Bug `bugfix`, Task `chore`), defaulting from the type name and checked against the branch names found in L6.

### L5. Test-create, learn from errors (writes to Jira, approved per ticket)
**On resume**, first search for earlier test tickets (`jira_search` with `project = <key> AND summary ~ "\"LiftOff test\"" AND reporter = currentUser()`) and reuse or list what is found, so an interruption never leaves orphans that are created again.

For each type, one ticket at a time:
1. Say exactly what will be created (project, type, summary `[LiftOff test] <type>`, description from the template, `createFields` so far) and **ask**.
2. `jira_create_issue`. Read it back with `jira_get_issue` and `expand=renderedFields` and check the **rendered HTML**: headings (`<h2>`), lists and code blocks survived. (The server converts Markdown to wiki markup on write and back on read, so `##` in the raw read is normal; judge the rendering, or ask the lead to open the ticket.) If the rendering is wrong, stop and show the lead: there is no text-format field in this release.
3. On an error, read the message (Jira's, via the server), say what is wrong in a sentence (a required field the metadata did not declare, an invalid option, a permission), and propose the fix: a `createFields` entry (the value from `jira_get_field_options` or the lead) or a template change. Show the diff, get approval, retry. **At most 3 attempts per type**, then stop and ask the lead.
4. **Walk the workflow** on the test ticket with `jira_get_transitions` (it takes only the issue key, so it lists only what is available from the **current** status: walking a real ticket is the only way to learn the roles) and `jira_transition_issue` (it accepts the transition name, case-insensitive), asking the lead at each state which transition plays `start`, `review` and `done`. Record the names, and for a transition that needs fields (typically `resolution` on Done) record them in `transitions.<role>.fields`; they are learned from errors, because the server does not return the screen fields. **The 3-attempt cap applies here too.** Conditions and validators (assignee, permissions) can make a state unreachable: the lead then names the transition by hand and it is marked **unverified** in the summary. Intermediate states are not recorded: Close finds them at run time with `jira_get_transitions`. The ticket ends in its final state when reachable: the delete tool is **not exposed**, so tickets are closed, not deleted.
5. A type **passes** when the ticket was created and rendered right; its transitions are written as proven or as unverified (named by the lead). **Write its entry to `liftoff.yaml` now**: a diff of what was learned (`readingMap`, `template`, `createFields`, `transitions`, `branchType`), approval, an edit of the text (comments stay), `validate` (at most 5 rounds, fix only what you wrote). An interruption therefore loses at most one type.
Finally list the keys of every test ticket, so the lead can delete them.

### L6. Learn the code host (read only; no merge request is created)
1. `glab repo view -F json`: the default branch.
2. `glab mr list --merged -P 20 -F json`: infer from what exists and **show the evidence with counts**: the usual `target_branch` (`targetBranch`), the branch-name shape around the ticket key (`branchPattern`: `{type}/{key}-{slug}`), the title shape (`titlePattern`: `{key}: {summary}`), the labels used most (`labels`), the reviewers who appear most (`reviewers`).
3. The repo's `.gitlab/merge_request_templates/`: prefer `Default.md` if it exists, otherwise ask which one is the team's default (`mrTemplate`). A project-level default description set in GitLab's settings is invisible to the repo: ask.
4. No merged MRs yet, or the lead disagrees: ask, with the built-in defaults as the starting point.
Then **one diff for `codeHost.conventions`**, approval, edit, `validate` (same rules as L5.5).

### L7. Apply
Connector sections have no `required` flag in this release. Run `check-config`: if the only changed sections are `tracker`, `codeHost` and `plugin`, run `render` (idempotent; connector sections render no files) with the lead's approval, so the applied record matches and `check-config` returns to `ok` on the lead's machine. Otherwise hand off to the Init skill.

### L8. Hand over
Which files to commit: `liftoff.yaml`, `.mcp.json`, `.vscode/mcp.json` (never committed for them); **run `git check-ignore` on both MCP files** and propose a `!.vscode/mcp.json` negation if `.vscode/` is ignored. What a teammate does next: update the plugin, rerun Init, run Connect. The table of types (passed / unverified transitions / not done), the test-ticket keys, anything left open. After this flow, **a failure on a teammate's machine is never fixed there**: the member flow proposes the config change to the lead (this file's job is to make that rare).

## Project Structure

```
plugin/skills/liftoff-connect/references/lead-onboarding.md   → the flow above (SKILL.md links to it, loaded on demand)
plugin/skills/liftoff-connect/assets/defaults/task.md, story.md, bug.md   → built-in templates
plugin/skills/liftoff-connect/assets/defaults.json            → { "jiraServerVersion": "<default pin>" }, generated by the build from src/connect/defaults.json
src/connect/defaults.json                                     → the one place the default pin lives
```

## Code Style

The reference doc contains **fenced `yaml` blocks** for every config fragment the flow writes (the base `tracker`, one issue type, `transitions` with `fields`, the `codeHost` conventions). They are the only place the skill learns the shape, and a test validates them. Each block starts with a comment declaring its splice point and uses concrete values, no `<placeholders>`.

````markdown
```yaml
# splice: tracker
kind: jira-dc
url: https://jira.company.local
project: PROJ
server: { version: "0.23.1" }
```
````

## Testing Strategy

**Automated:**
1. **YAML blocks validate:** every ` ```yaml ` block in `lead-onboarding.md` is spliced at the point its first comment names, into a minimal valid config with `plugin.version: "0.2"`, and passes `validateConfig`.
2. **Schema paths exist:** every backticked config path in the reference (`tracker.issueTypes[].readingMap.acceptanceCriteria`, `codeHost.conventions.branchPattern`, ...) resolves in `schema/liftoff.schema.json`, **traversing `if`/`then`/`anyOf`**. A renamed field fails the test.
3. **Tools:** every `jira_*` name in the reference and in `SKILL.md` is in `JIRA_TOOLS`; the reference names no delete, move or assign tool. The reference contains no `${CLAUDE_PLUGIN_ROOT}`.
4. **Assets and files:** the three default templates exist, hold no secret (the v1 secret guard on their text); `assets/defaults.json` equals `src/connect/defaults.json`; every file the reference refers to exists; the new files are in the "exactly the expected files" packaging test.
5. **Rules present:** the reference states the `[LiftOff test]` prefix, approval per ticket, the 3-attempt cap (also for transitions), "closed, not deleted", that no MR is created, that only one project is supported, and the resume search for orphan tickets.
6. **Release checklist (needs the network, so a script, not a unit test):** check every `JIRA_TOOLS` name against the pinned tag's `servers/jira.py` of `mcp-atlassian`; run it before releasing a new pin.

**Manual (the pilot's Jira DC and GitLab, Claude Code first, then VS Code):**
- discovery lists the project's types; a type with a sample; a type with none (default template); a pasted example;
- a create that fails on a required field the metadata did not declare: the flow reads the error, proposes `createFields`, the retry passes;
- the rendering check on `renderedFields`; the transition walk, including a Done that needs `resolution`; a state that is unreachable (the lead names it, marked unverified); the 3-attempt cap stops and asks; test tickets end closed and their keys are listed;
- a test project on a **different scheme** (the warning); one project only;
- GitLab inference shows counts; a repo with no merged MRs falls back to defaults;
- the final `liftoff.yaml` validates; `render` brings `check-config` back to `ok` on the lead's machine; a teammate then runs update, Init, Connect and is never asked about conventions;
- **restart in the middle**: after L2/L3 (the tools need a restart), the second run lands back in the lead flow at L3/L4; interrupt in L5 and run again: it resumes, reuses or lists earlier test tickets, never re-tests a passed type without being asked, never duplicates an issue type;
- `.vscode/` gitignored (the negation is proposed);
- count how many test tickets the lead created on the real project, and how long it took.

## Boundaries

- **Always:** announce and get approval for each Jira write; prefix test tickets `[LiftOff test]`; read before writing; show evidence for every inferred convention; validate after every config edit; stop after 3 failed attempts for a type or for a transition.
- **Ask first:** creating tickets in the real project (rather than a test project); a write that is not a test ticket; changing `server.version`; adding a field to a template that the sample did not have.
- **Never:** delete a ticket; touch a ticket that is not a test ticket; create a merge request; invent a field id; write a credential, a token or **the lead's own login** into the config (`reviewers` and user-picker values the team uses are fine); write a test project's key into the config; skip `validate`; use a tool outside `JIRA_TOOLS`; edit another section's `required` flag; commit.

## Success Criteria

- A lead gets from "Init'ed repo" to a validated `liftoff.yaml` with the pilot's issue types in < 30 minutes, **including a restart of the agent in the middle**.
- Every issue type written to the config was proven by a created, correctly rendered ticket; its transitions are proven or explicitly marked unverified; every test ticket is closed where reachable and listed.
- The GitLab conventions in the config each have visible evidence or an explicit answer from the lead.
- A teammate then connects with the member flow and is never asked about conventions.
- The automated tests pass and fail when a schema path, a tool name or a YAML fragment drifts.

## Open Questions

1. ~~Transition fields~~ — `transitions.<role>` is `{ name, fields? }` in `SPEC-connect-config.md`.
2. **`jira_get_create_fields` coverage** differs by Jira version and project configuration; when it fails, the flow falls back to `jira_search_fields` plus the first create error, which is slower but works.
3. **How many test tickets on the real project** is acceptable is the lead's call (L1 asks); a test project is the safer default.
4. **Cleaning up.** LiftOff does not delete tickets; the lead deletes the listed keys. A `delete` tool would be a separate "Ask first" decision.
5. **Heuristics** (finding the acceptance-criteria field, the branch pattern) are the agent's judgment on evidence; the lead's approval is the safety net, and the manual run measures how often the proposals need correcting.
6. **Deferred, written down:** several Jira projects; the README's comment conventions per issue type; the MR-to-ticket link (the remote-link tool is not in `JIRA_TOOLS`, so Close will need an "Ask first" addition).
7. **Unverified transitions** leave Close to discover intermediate steps at run time; if that proves fragile in the pilot, record the full path per type.
