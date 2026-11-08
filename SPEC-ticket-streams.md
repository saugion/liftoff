# Spec: Ticket flow and work streams (MVP scope, added 2026-11-08)

Builds on 0.3.0 (Init, Connect, Plan, Build). Source of product decisions: `README.md`, sections "Ticket flow" and "Work streams". Written and approved autonomously (see `docs/decisions/DECISIONS.md`). Ships in the same release as Plan/Build (still `0.3.0`, unreleased). **Close stays out.**

## Objective

1. **Ticket flow.** The PO/PM (or the engineer filing a bug or proposing a task) creates tickets **on the team's templates**: a batch is drafted, checked against the config, shown together, edited one by one, **approved once**, then created. The template the writer uses is the same one Plan reads with, so tickets created here are readable by Plan by construction. Includes **breaking an epic into tickets**.
2. **Work streams.** A time-boxed Kanban Jira project is **linked** in `liftoff.yaml` (never created by LiftOff). Ticket flow creates its tickets there; Plan and Build work on them with no sprint or story-point assumption, with the stream's own issue types and transitions, and with the code module the stream feeds.

## Config: `streams` (additive; `liftoff: 1` stays)

```yaml
tracker: { kind: jira-dc, url: ..., project: PROJ, server: {...}, epicLinkField: customfield_10451, issueTypes: [...] }
streams:
  items:
    - id: checkout-mvp            # kebab-case, unique
      project: STR                # the Jira project of the stream, unique, not tracker.project
      mode: kanban                # only value
      module: backend             # optional: an id of modules.items
      epics: [STR-1, STR-2]       # optional: epics of the stream (keys of this project)
      issueTypes: [...]           # optional: same shape as tracker.issueTypes; absent = the tracker's are used
```

Rules (in code unless noted): `streams` needs a non-empty `tracker`; `plugin.version` >= `0.3` when `items` is non-empty (`MIN_STREAMS_PLUGIN`); `id` kebab-case (schema), unique; `project` matches the tracker project pattern (schema), unique across streams and different from `tracker.project`; `module` exists in `modules.items`; each epic key is `<project>-<n>`; `issueTypes` follow the same checks as the tracker's. **No `required` flag** (as for connectors). `tracker.epicLinkField` (new, optional, `^[A-Za-z0-9_]+$`): the instance's Epic Link custom field on Server/DC, used to attach a ticket to an epic after creation. Normalization: `items: []`, per item `epics: []`, `issueTypes: []` filled with defaults like the tracker's; `{}` stays `{}`.

`projectsOf(config)` is the one accessor that resolves a project key to `{ project, stream?, issueTypes, inherited }` (a stream without its own `issueTypes` inherits the tracker's, `inherited: true`).

## CLI

- **`parse-ticket`** (changed): the key may belong to `tracker.project` or to any stream project (else `ticket-invalid`). Output gains `stream: { id, mode, module, epics } | null` and the issue types come from `projectsOf`. New warning `types-inherited` when a stream ticket is read with the tracker's types. Nothing else changes.
- **`draft-tickets --file <drafts.json>`** (new, read-only, pure). Input:

```json
{ "project": "PROJ", "tickets": [
  { "type": "Story", "summary": "...", "description": "...", "priority": "High", "labels": ["a"], "epic": "STR-1", "fields": { "customfield_17064": { "value": "Team" } } } ] }
```

`project` is the tracker's project or a stream's project (default `tracker.project`). Output: `{ ok, project, stream, tickets: [{ index, ok, errors: [..], warnings: [..], call: { tool: "jira_create_issue", args }, after: [ { tool, args } ], preview }] , allOk }`. Checks per ticket: type is in the project's `issueTypes` (case-insensitive; with none configured: error `no-issue-types`, run Connect); summary 1-255 chars, one line; description present and at most 32 000 chars; labels have no space, comma or control character; priority one of a non-empty word; `epic` is `<project>-<n>`, and for a stream is in its `epics` when it lists any; an `epic` needs `tracker.epicLinkField`; `fields` keys are `^[A-Za-z0-9_]+$`; no text that looks like a credential; **template conformance**: every heading of the type's `template` appears (case-insensitive) as a heading of the description, else warning `template-section-missing` per heading; a read-only tracker is the fatal `tracker-read-only`. `call.args` = `project_key`, `issue_type` (the config's spelling), `summary`, `description`, `additional_fields` = the type's `createFields`, overlaid by the ticket's `fields`, plus `labels` and `priority: { name }` when given. `after` holds `jira_update_issue` with `fields: { <epicLinkField>: <epic> }` and `issue_key: "<created key>"` literally as the placeholder the skill replaces. The CLI never calls anything. New error codes (own union): `ticket-draft-invalid`, `tracker-read-only`.

## Skill `liftoff-ticket`

1. Environment, root, `check-config` (same routing). Needs a tracker with issue types; else the Connect skill.
2. **Target:** the team's tracker project or one of the `streams` (ask when streams exist). For a stream: the module it feeds, its epics, "Kanban: no sprint, no story points".
3. **What:** a bug, a task, a story, or **break down an epic**. Epic: read it (`jira_get_issue` + `parse-ticket`; the epic must be in the stream's `epics` or the user names it), ask the engineer/PO for scope gaps in one round, propose the split.
4. **Draft** each ticket with the type's `template` from `parse`/config (read via `connect-info`'s `tracker`/`streams`, or `liftoff.yaml`), in the Jira DC text format (`../liftoff-connect/assets/jira-dc-formatting.md`), ticket text in English if the team's tickets are; never invent facts, mark unknowns `_TBD_`; save the drafts file to `.liftoff/tmp/` and run `draft-tickets`; fix `errors` until `allOk`; show `warnings`.
5. **Batch review:** all tickets shown together (title, type, priority, labels, epic, description), editable one by one, **approved once** by an explicit yes. Dry-run = exactly the `call` of each ticket.
6. **Create** each ticket with its `call.args` as given, in order; then each `after` with the real key; report keys and URLs. On a failure stop, list created and not created, and before any retry search for the summary to avoid duplicates. **Never delete or edit a ticket the flow did not create.** No sprint assignment (not modeled; Kanban has none).

## Plan/Build changes

Plan and Build read `stream` from `parse-ticket`: with a stream, they state that the work is Kanban (no sprint, no points), use `stream.module` as the first module to read, and use the stream's transitions (already resolved by `parse-ticket`). Plan's ticket search JQL uses the chosen project (tracker or stream).

## Lead flow addition (Connect skill, L9)

Optional, after L8: "link a work stream": ask the stream id, its Jira project key, the module it feeds, its epics; write the `streams` item (diff, approval, `validate`); learn the stream project's issue types with the same L4-L5 loop (test tickets in the stream project, `[LiftOff test]`), written into `streams.items[].issueTypes`; connection needs no new MCP entry.

## Tests

Unit: schema fixtures (valid/invalid with `# expect:`), hashes of v1 fixtures unchanged, normalization, `projectsOf`; `parse-ticket` with a stream key; `draft-tickets` (each rule, exact `call` shape, shell-free JSON, hostile text stays data, conformance warnings); skill tests (drift, rules, YAML fragments, schema paths). E2E (fake Jira gains a Kanban project, `jira_create_issue`, `jira_update_issue`, `jira_search` by project): epic read, split into 3 tickets, `draft-tickets`, batch create through MCP, Epic Link set, Jira holds the tickets; then Plan and Build on a stream ticket with the stream's own transitions.

## Boundaries

- **Always:** one approval for the batch; create only what was shown; read-only tracker means no creation.
- **Never:** create a Jira project or a board; delete tickets; assign sprints; invent an epic; create in a project that is neither the tracker's nor a stream's.

## Open questions

1. Several Jira projects per tracker beyond streams; Epic Link for Cloud (parent field); text format per type; sub-tasks per module; sprint assignment for sprint teams (the control-plane plugin does all of these): out of this release.
2. Whether a stream's epics should be discovered with `jira_search` instead of listed.
