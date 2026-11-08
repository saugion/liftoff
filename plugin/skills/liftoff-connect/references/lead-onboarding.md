# Lead onboarding

Loaded by `SKILL.md` when step 1 routes the user here: no connector configured and the user is the lead, or a
connector configured but the lead work incomplete, or an explicit "liftoff connect lead" / "relearn conventions".
Run the CLI exactly as `SKILL.md` says; every rule of `SKILL.md` applies here too.

Done once, usually by the lead at the real Init, and **resumable**. It connects the lead's own machine (the member
flow), then learns how this team really uses its tracker and its code host, and writes that into `liftoff.yaml`, so
every teammate and every later skill reads one validated source. Real trackers are messy (workflow validators demand
fields the metadata does not declare, transitions differ per type), so a template only becomes reliable by
**trying it**: start from what exists, test-create one ticket per type, learn from the errors, repeat until each type
passes, then write.

**Resuming skips L1 and L2 only for what the config already holds.** If you enter at L3 or L4 and the config has the
tracker, still ask L1's question 3 (where the test tickets go) before L5: it is never stored. **Where it resumes comes from the config alone.** An issue type present in `tracker.issueTypes` has passed;
`codeHost.conventions` with anything beyond its defaults has been learned. A restart of the agent (normal in Claude
Code after the MCP file is written) costs nothing, and adding a connector or an issue type later is the same flow.

Conventions: approval before every write; diffs shown; structured questions when available; nothing committed.
**Every write to Jira is announced and approved one ticket at a time.** The lead may approve in advance every later
test ticket and entry that matches what they already specified; you still show each one, and apply it only if it
matches exactly, otherwise ask. Only the tools of the member flow's server
are available (no delete, move or assign tool exists): use no other.

## L1. Ask (one round, three questions)

1. The Jira DC base URL and the **real** project key (or "no tracker"). **Only one Jira project is supported** in this
   release; mention any others as open for later.
2. The GitLab host, defaulting to the host of `git remote get-url origin` (or "no code host").
3. Whether the test tickets of L5 go into the real project (with the `[LiftOff test]` prefix) or into a separate
   **test project** (its key is kept for the session only and **never written**). `tracker.project` is always the
   real project. A test project must share the issue-type, field-configuration and workflow schemes with the real
   one: compare `jira_get_create_fields` for both and warn on any difference, because required fields and workflows
   are per project.

Then a recap and a **yes before anything is written**.

## L2. Write the base config

Add, with a diff and approval, to `liftoff.yaml` by editing its text (comments stay): `tracker` and/or `codeHost`,
and raise `plugin.version` to the installed `major.minor` only if it is **below** `0.2` (`0.3` for a `streams` section); a pin that is already at or above that needs no change. The server version is the default
pin from `assets/defaults.json` (`jiraServerVersion`), never below the minimum the CLI enforces. The fragments are values of the top-level key named in their `# splice:` comment; insert the key as a new top-level section
right after `agents:` (or after `modules:` if present), never inside another section. The base fragments:

```yaml
# splice: tracker
kind: jira-dc
url: https://jira.company.local
project: PROJ
server: { version: "0.23.1" }
```

```yaml
# splice: codeHost
kind: gitlab
host: gitlab.company.local
```

Run `validate`; fix only what you wrote; at most 5 rounds. An existing `tracker` is never replaced: the flow resumes.

## L3. Connect this machine

Run steps 2-6 of the member flow for the connectors chosen (prerequisites, credential, preflight, MCP entries,
verify Jira, GitLab). Continue only when **each chosen connector** works; otherwise stop at the failing step. In
Claude Code the new server's tools usually appear only after a restart, so this step often ends with "restart and run
me again": the routing in step 1 of `SKILL.md` brings the user back here, at L3.

## L4. Learn the tracker (read only)

1. **Discover the types:** `jira_get_project_issue_types` for the project (it returns ids and names); ask the lead
   which ones the team uses (multi-select). Include `Epic` if people will create epics through the Ticket flow: its
   template is learned like any other type. Its **Epic Name** field (an instance-specific custom field that
   `jira_get_create_fields` lists as required) is different: every epic has its own name, so it does not go in
   `createFields`; record its field id once as `tracker.epicNameField`, and the Ticket flow fills it with the epic's
   title. For the test ticket use `[LiftOff test] Epic` as the value. Types already in `tracker.issueTypes` are skipped unless the lead asks to
   redo them.
2. **Where the template starts, per type** (ask; one question per type, or one for all): (a) **a sample** — one existing
   ticket key (the best example the lead has) or a **pasted example** (a ticket from another project), read like a
   sample, without calling Jira; (b) **a built-in default** (`assets/defaults/task.md`, `assets/defaults/story.md`,
   `assets/defaults/bug.md`, `assets/defaults/epic.md`) to edit and approve; (c) **the lead's own template** — the lead gives the sections they
   want (a list of titles, a pasted text, or a file path in the repo; read it with your file tools) and you shape it
   into a template. The defaults are only a start: if the lead does not like them, (c) is the answer, and nothing in
   the defaults is kept unless the lead keeps it.
3. **Read it:** `jira_get_issue` with `fields="*all"` and `expand=renderedFields`; `jira_get_create_fields` for the
   project and the type (it needs the `issue_type_id` from step 1 and returns `field_id`, `name`, `required` and
   `schema`, **not** the allowed values); `jira_get_field_options` (project key and issue type name) for the allowed
   values of the fields that matter; `jira_search_fields` to map field names to ids. Custom field ids differ per
   instance: always use the ids you read, never a remembered one. If `jira_get_create_fields` fails, fall back to
   `jira_search_fields` plus the first create error (slower, works). `jira_get_field_options` may answer the same list for
   every field id: if so, take the allowed values from the create error or from the lead instead.
4. **Propose the reading map** per type as a table for the lead to edit and approve. The acceptance-criteria entry is
   `heading:` (the section title in the description) or `field:`, for **every** type, not only Story: propose the
   section that plays that role in the template (Story "Acceptance criteria", Epic "Success criteria", Bug the
   section about what must be true after the fix) and ask; never propose "none" when the template has such a section.
   Propose as `fields` only the fields the lead wants Plan to show (the required ones, and those a sample has filled),
   not every optional field of the create screen. Where it is where the acceptance criteria
   live (`tracker.issueTypes[].readingMap.acceptanceCriteria`: a custom field whose name looks like "acceptance", else
   a heading in the description, matched case-insensitively) and which other fields matter
   (`tracker.issueTypes[].readingMap.fields`: id and label). Show the evidence ("the field 'Acceptance Criteria' is
   `customfield_10201`, filled in the sample").
5. **Propose the template** (`tracker.issueTypes[].template`) per type: the description skeleton of the sample (its
   headings, checklists and scenario labels kept, content stripped), the default, or the lead's own sections turned into
   a skeleton in the tracker's text format (each section a heading, a `{placeholder}` line saying what goes in it, the
   team's checklist and scenario conventions as the lead wrote them). If the lead defined their own sections, also ask
   which section holds the acceptance criteria and record it as `tracker.issueTypes[].readingMap.acceptanceCriteria`
   (Plan reads tickets with it). The lead edits and approves, as many rounds as they want. Read
   `assets/jira-dc-formatting.md` first: how Jira DC and the server convert text decides what survives.
6. **Ask for the `tracker.issueTypes[].branchType`** of each type (what `{type}` means in a branch name: Story
   `feature`, Bug `bugfix`, Task `chore`), defaulting from the type name and checked against the branch names found
   in L6.

### Changing a template later

"Change the Bug template", "redo the Story type": go straight to L4.2 and L4.5 for **that type only** (the lead may
redo a type that is already in `tracker.issueTypes`, or a stream's under `streams.items[].issueTypes`), then L5 for it:
a changed template is proven by a new test ticket like a new one, and replaces the old entry through a diff the lead
approves. Other types are untouched.

## L5. Test-create, learn from errors (writes to Jira, approved per ticket)

**On resume**, first search for earlier test tickets (`jira_search` with
`project = <key> AND summary ~ "\"LiftOff test\"" AND reporter = currentUser()`) and reuse or list what is found, so
an interruption never leaves orphans that are created again.

For each type, one ticket at a time:

1. Say exactly what will be created (project, type, summary `[LiftOff test] <type>`, description from the template,
   `tracker.issueTypes[].createFields` so far) and **ask**.
2. `jira_create_issue`. Read it back with `jira_get_issue` and `expand=renderedFields` and check the **rendered
   HTML**: headings (`<h2>`), lists and code blocks survived. (The server converts Markdown to wiki markup on write and
   back on read, so `##` in the raw read is normal; judge the rendering, or ask the lead to open the ticket; `assets/jira-dc-formatting.md` lists the known quirks.) If the
   rendering is wrong, stop and show the lead: there is no text-format field in this release. Name the signature
   (`renderedFields` holds one `<p>## Heading ...</p>` and no `<h2>`, while the raw text looks the same either way:
   only the rendered field tells), and offer: the lead opens the ticket and checks, the lead asks the Jira admin, or a
   retry with wiki markup (`h2.`) in all templates. A fix of the instance by the lead resets the attempt count for
   that type; a ticket the lead removed outside the flow is not an orphan (the resume search simply finds none).
3. On an error, read the message (Jira's, via the server), say what is wrong in a sentence (a required field the
   metadata did not declare, an invalid option, a permission), and propose the fix: a `createFields` entry (the value
   from `jira_get_field_options` or the lead) or a template change. Show the diff, get approval, retry. **At most 3
   attempts per type**, then stop and ask the lead.
4. **Walk the workflow** on the test ticket (moving a test ticket is part of the approved test: the lead's approval of the ticket covers it; if the names the lead gave do not exist on the instance, show the lists the instance offers and walk forward to learn the real ones) with `jira_get_transitions` (it takes only the issue key, so it lists only
   what is available from the **current** status: walking a real ticket is the only way to learn the roles) and
   `jira_transition_issue` (it accepts the transition name, case-insensitive), asking the lead at each state which
   transition plays `start`, `review` and `done` (`tracker.issueTypes[].transitions`). Record the names, and for a
   transition that needs fields (typically `resolution` on Done) record them in
   `tracker.issueTypes[].transitions.done.fields`; they are learned from errors, because the server does not return
   the screen fields. **The 3-attempt cap applies here too.** Conditions and validators can make a state
   unreachable: the lead then names the transition by hand and it is marked **unverified** in the summary.
   A role the workflow does not have (no done transition yet) is simply left out of `transitions`: no stub, and say
   so in the summary. The ticket ends in its final state when one is reachable (**closed, not deleted**: no delete
   tool is exposed); otherwise it stays in the last state reached and is listed for the lead to delete.
5. A type **passes** when the ticket was created and rendered right; its transitions are written as proven or as
   unverified. **Write its entry to `liftoff.yaml` now**: a diff of what was learned, approval, an edit of the text
   (comments stay), `validate` (at most 5 rounds, fix only what you wrote). An interruption therefore loses at most
   one type.

```yaml
# splice: tracker.issueTypes[]
name: Story
branchType: feature
readingMap:
  acceptanceCriteria: { heading: "Acceptance criteria" }
  fields:
    - { id: customfield_10016, label: Story points }
template: |
  ## Context
  ## Acceptance criteria
createFields:
  customfield_10400: { value: Team A }
transitions:
  start: { name: Start progress }
  review: { name: Ready for review }
  done: { name: Done, fields: { resolution: { name: Fixed } } }
```

Finally list the keys of every test ticket, so the lead can delete them.

## L6. Learn the code host (read only; no merge request is created)

1. `glab repo view -F json`: the default branch.
2. `glab mr list --merged -P 20 -F json`: infer from what exists and **show the evidence with counts**: the usual
   `target_branch` (`codeHost.conventions.targetBranch`), the branch-name shape around the ticket key
   (`codeHost.conventions.branchPattern`: `{type}/{key}-{slug}`), the title shape
   (`codeHost.conventions.titlePattern`: `{key}: {summary}`), the labels used most (`codeHost.conventions.labels`),
   the reviewers who appear most (`codeHost.conventions.reviewers`).
3. The repo's `.gitlab/merge_request_templates/`: prefer `Default.md` if it exists, otherwise ask which one is the
   team's default (`codeHost.conventions.mrTemplate`). A project-level default description set in GitLab's settings
   is invisible to the repo: ask.
4. No merged MRs yet, or the lead disagrees: ask, starting from these defaults: `targetBranch` the default branch from step 1, `branchPattern` `{type}/{key}-{slug}`, `titlePattern` `{key}: {summary}`, no labels, no reviewers, no `mrTemplate`. A label that is common but tied to a module or a type (backend, bug) is shown with its count and the lead decides whether it is a default for every MR. An `origin` path that differs from `glab repo view` is only noted.

Then **one diff for `codeHost.conventions`**, approval, edit, `validate` (same rules as L5.5).

```yaml
# splice: codeHost.conventions
targetBranch: main
branchPattern: "{type}/{key}-{slug}"
titlePattern: "{key}: {summary}"
mrTemplate: .gitlab/merge_request_templates/Default.md
labels: [backend]
reviewers: [alice, bob]
```

## L7. Apply (run it last, after every config edit, including L9)

Connector sections (`tracker`, `codeHost`, `streams`) have no `required` flag in this release. Run `check-config`: if the only changed sections are
`tracker`, `codeHost`, `streams` and `plugin`, run `render` (idempotent; connector sections render no files) with the lead's
approval, so the applied record matches and `check-config` returns to `ok` on the lead's machine. Otherwise hand off
to the Init skill.

## L8. Hand over

Which files to commit: `liftoff.yaml`, `.mcp.json`, `.vscode/mcp.json` (never committed for them); **run
`git check-ignore` on both MCP files** and propose a `!.vscode/mcp.json` negation if `.vscode/` is ignored. What a
teammate does next: update the plugin, rerun Init, run Connect. The table of types (passed / unverified transitions /
not done), the test-ticket keys, anything left open. After this flow, **a failure on a teammate's machine is never
fixed there**: the member flow proposes the config change to the lead.

## L9. Link a work stream (optional)

A time-boxed Kanban project, created by hand in Jira (**never created by LiftOff**: it needs admin rights). Ask: a
short id, the stream's Jira project key, the code module it feeds (an id of `modules.items`, or none), and its epics
(keys of that project, or none). Add the item to `streams.items` with a diff and approval, then `validate` (same
rules as L5.5). Raise `plugin.version` to `0.3` if it is lower. The stream's issue types are not the tracker's: run L4
and L5 for the **stream's project** (test tickets in that project, `[LiftOff test]`, closed not deleted) and write
each type under `streams.items[].issueTypes`. A stream with none of its own is read with the tracker's types and a
warning, so do this before the team relies on it. A stream needs no new MCP entry. Its issue types may repeat the tracker's (templates, reading maps, branch types, transitions): copy them under `streams.items[].issueTypes` by value, not by reference. Plan and Build never assume a
sprint or story points for a stream.

```yaml
# splice: streams.items[]
id: checkout-mvp
project: STR
mode: kanban
epics: [STR-1, STR-2]
issueTypes:
  - name: Task
    branchType: chore
    transitions:
      start: { name: In Progress }
      done: { name: Done }
```

## Boundaries

- **Always:** announce and get approval for each Jira write; prefix test tickets `[LiftOff test]`; read before
  writing; show evidence for every inferred convention; validate after every config edit; stop after 3 failed
  attempts for a type or for a transition.
- **Ask first:** creating tickets in the real project (rather than a test project); a write that is not a test
  ticket; changing `tracker.server.version`; adding a field to a template that the sample did not have.
- **Never:** delete a ticket; touch a ticket that is not a test ticket; create a merge request; invent a field id;
  write a credential, a token or **the lead's own login** into the config (`reviewers` the team uses are fine); write
  a test project's key into the config; skip `validate`; use a tool the server does not expose; edit another
  section's `required` flag; commit.
