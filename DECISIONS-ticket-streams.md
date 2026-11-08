# Ticket flow and work streams: decisions taken in autopilot

1. **Both are in the MVP now** (your instruction), as one spec: `SPEC-ticket-streams.md`. Still no Close.
2. **No version bump.** `0.3.0` is unreleased, so Plan/Build, Ticket flow and streams ship together as `0.3.0`; `streams` requires `plugin.version >= 0.3`.
3. **`streams` shape is mine**: `streams.items[]` with `id`, `project`, `mode: kanban`, optional `module`, `epics`, `issueTypes` (README only said "id, tracker project key, mode, the code module"). A stream without `issueTypes` inherits the tracker's with a warning, because workflows differ per project.
4. **New `tracker.epicLinkField`** (optional) for the Epic Link custom field on Server/DC; the epic link is set after creation with `jira_update_issue` (the tested flow in the control-plane plugin; `jira_link_to_epic` is not used and not allowed).
5. **New CLI command `draft-tickets`** (read-only): validates a batch against the config and returns the exact `jira_create_issue` calls. Same "Ask first" caveat as the other new commands: I took it.
6. **No sprint support** anywhere (also not for the default sprint project): not modeled, as the README says Plan/Build/Close never assume one.
7. **Epics are listed in config (`epics`) or named by the user**; no discovery in this release.
