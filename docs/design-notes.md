# Design notes

What is not obvious from the code, kept after the per-module specs were removed (they are in the git history before
the commit "docs: remove the specs"). Tests are the contract; this is the reasoning behind a few choices.

## The shape of the product

- **The CLI is pure.** No network, no credentials, no child process (a test scans `src/` and the bundle). Every call to
  Jira or GitLab is made by the agent, through the MCP server or `glab`; every write needs the engineer's approval.
  The skills are instructions; the CLI decides what is deterministic and returns the exact commands and calls.
- **One config, rendered per agent.** `liftoff.yaml` is the single source; `AGENTS.md` holds the rules; `CLAUDE.md` and
  `.github/copilot-instructions.md` are thin generated files that point at it. Hooks and subagents are not used in the
  core flow because they differ between agents.
- **Required sections.** Each section is hashed; a section marked `required: true` blocks a teammate's LiftOff until
  they re-apply (Init, no questions); an optional section only warns. Connector sections (`tracker`, `codeHost`,
  `streams`) have no `required` flag: "apply" renders files and would clear the warning without connecting anything.
- **Additive format.** `liftoff: 1` never changed. A section a newer plugin understands needs `plugin.version` at or
  above the version that introduced it (connectors 0.2, `streams` and `build` 0.3); an older plugin reads the pin first
  and says "update".
- **The merge request and the ticket's lane are the engineer's**, in every git mode. `build.git` only decides who
  creates the branch, commits and pushes.

## Why the Jira server is started the way it is

The MCP entry is `sh -c <launcher>`. The launcher resolves the token when the server starts, inside the server's own
process, so it is in no argument, committed file or log:

- an exported `LIFTOFF_JIRA_TOKEN` wins over the keychain; the token goes only into the environment of the `exec`'d
  process (`ps` shows `uvx mcp-atlassian@<version> --env-file /dev/null`);
- **`--env-file /dev/null` is essential.** Without it the server loads a `.env` with override from wherever it runs and
  could silently replace `JIRA_URL`, `ENABLED_TOOLS`, `READ_ONLY_MODE` and even the token;
- the variable is read with `printenv`, never written after a `$`, because Claude Code documents only `${VAR}`
  expansion and VS Code documents bare `$NAME` as literal;
- `ENABLED_TOOLS` and `TOOLSETS` are both set (a tool is exposed only if it passes both); the allowlist is the 12 tools in
  `src/connect/tools.ts`, deliberately without delete, move, assign, batch, links, worklog, attachments;
- a preflight (the same script ending in `--version`) warms the `uv` cache and surfaces the macOS keychain dialog once,
  under the user's eyes, because the agent cannot see the server's stderr.

Never: a token in the chat, in an argument, with `--token`, or typed by the agent. The user types it in their own
terminal. The accepted environment-variable route exposes the token to the agent's own shell; the keychain does not.

## Facts about the outside tools (verified 2026-11-07)

| Topic | Fact |
|---|---|
| Claude Code `.mcp.json` | Project scope, shared through git. `${VAR}` and `${VAR:-default}` are expanded in `command`, `args`, `env`, `url`, `headers`. Only the braced forms are documented; bare `$VAR` is documented as literal in VS Code and not documented for Claude Code, so the launcher never writes the token variable after a `$` (it uses `printenv`). Project servers need the user's approval once. A server added with `claude mcp add` at local or user scope is stored in `~/.claude.json` (plain text). |
| VS Code | Native workspace file `.vscode/mcp.json`, top-level `servers`, `"type": "stdio"`, supports `${env:NAME}` and `${input:id}` (a `promptString` with `password: true` is stored by VS Code). The portable `.mcp.json` (`mcpServers`) is experimental in VS Code behind `chat.mcp.workspaceRootConfig.enabled`; there bare `$NAME` is literal text. |
| `mcp-atlassian` | `uvx mcp-atlassian`; Server/DC env: `JIRA_URL`, `JIRA_PERSONAL_TOKEN`, `JIRA_SSL_VERIFY`; `READ_ONLY_MODE`, `ENABLED_TOOLS` (comma-separated tool names); `MCP_ATLASSIAN_USE_SYSTEM_TRUSTSTORE` defaults to true. **Minimum version 0.22.0** (the three metadata tools exist from there), default pin 0.23.1. Tools are exposed only if they pass both `ENABLED_TOOLS` and `TOOLSETS`. The server loads a `.env` with override unless started with `--env-file`, so the launcher passes `--env-file /dev/null`. Tools used here: `jira_get_issue`, `jira_search`, `jira_get_project_issues`, `jira_create_issue`, `jira_update_issue`, `jira_search_fields`, `jira_get_field_options`, `jira_get_project_issue_types`, `jira_get_create_fields`, `jira_get_transitions`, `jira_transition_issue`, `jira_add_comment`. Comments and descriptions are written in Markdown and converted by the server. Custom field ids differ per instance. |
| `glab` | `glab auth login --hostname H`, `glab auth status --hostname H [-F json]`, `glab mr list --merged -F json -P N [-t BRANCH]`, `glab mr view -F json`, `glab repo view -F json`, `glab mr create` with `--target-branch`, `--label`, `--reviewer`, `--template`, `--description-file`. MR templates live in `.gitlab/merge_request_templates/`. |
| macOS Keychain | `security add-generic-password -U -a "$(id -un)" -s SERVICE -w` (no value after `-w`) prompts for the secret on the terminal, so it never appears in an argument or in shell history. `security find-generic-password -a "$(id -un)" -s SERVICE -w` prints it. |


## Choices to know about

- Test tickets for onboarding are prefixed `[LiftOff test]`, created one at a time with approval, closed and never
  deleted (no delete tool is exposed). A test project's key is never written to the config.
- One Jira project per repo for the team's tracker; a Kanban work stream is a second project linked in `streams`. A
  ticket lives in one project, so work across a stream's module and a team module is one ticket per project.
- The Epic Link is set after creation with `jira_update_issue` on the instance's Epic Link field
  (`tracker.epicLinkField`); `jira_link_to_epic` is not used (a team reports it succeeds without setting the field on
  Server/DC). Sprints are not assigned.
- The plan lives in `.liftoff/plans/<KEY>.md`: personal, ignored by git. Approval is a hash of the plan with checkbox
  state removed, so ticking boxes keeps it valid and editing the content makes it stale.
- Jira DC renders wiki markup and the MCP server converts Markdown on write and back on read; the quirks are in
  `plugin/skills/liftoff-connect/assets/jira-dc-formatting.md`.
