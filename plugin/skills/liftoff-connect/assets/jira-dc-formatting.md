# Jira Server / Data Center: how descriptions are formatted

Read this before proposing a template (L4.5) or judging a test ticket's rendering (L5.2). Learned from a team that
runs the same stack (Jira DC through `mcp-atlassian`); verify each point on the lead's own instance.

- Jira DC renders **wiki markup**, not Markdown. The MCP server runs a Markdown-to-wiki pass on the description it
  is given and a wiki-to-Markdown pass on what it returns. So a ticket read through the server looks like Markdown
  (`##` headings), and a template written in Markdown is converted on create.
- Wiki constructs usually pass through untouched: `h2.` headings, `* ` bullets, `_italic_`, `{code}` blocks,
  `|| ||` tables, `[Label|url]` links, and the icons `(/)` and `(x)` that teams use for checklists.
- Quirks of the conversion (check each on the first test ticket):
  - a numbered list written as `# item` becomes a **heading**; write `1. item` and the server turns it into a list;
  - `*bold*` on a plain line becomes italic; `**bold**` becomes bold; inside a bullet `*bold*` stays bold;
  - underscores inside a word are escaped in the echo (`service\_alias`): normal, judge the rendered ticket only;
  - `{name}` is read as a macro: write path parameters as `$name`;
  - list markers must start at column 0, and a blank line goes between a heading and its content.
- Teams often mark checklist items `(x)` (not ticked) and `(/)` (ticked) and use `*Given*` / `*When*` / `*Then*`
  bullets under bold scenario labels inside "Acceptance criteria". Keep such conventions in the template exactly as
  the sample has them; they are part of how the team reads the ticket.
- Some fields are not text but pickers: a team or component is `{ "value": "..." }`, a priority `{ "name": "..." }`,
  labels a list. Learn them from `jira_get_field_options` and from create errors, and record them in
  `tracker.issueTypes[].createFields`.
- The epic link and the sprint are separate fields on Server/DC (custom field ids differ per instance). This release
  does not set them (that belongs to the Ticket flow); record their ids in `tracker.issueTypes[].readingMap.fields`
  if Plan should show them.
- An Epic on Server/DC usually needs an **Epic Name** custom field on create; its id differs per instance. Read it with
  `jira_get_create_fields` and record its id as `tracker.epicNameField` (not in `createFields`: every epic has its own
  name, and the Ticket flow fills it with the epic's title).
