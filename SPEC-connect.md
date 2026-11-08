# Spec: LiftOff Connect (index + shared rules)

Roadmap item 2. Builds on v1 (`v0.1.0`: `SPEC.md` and the five module specs). Source of product decisions: `README.md`, section "2. Connect". This file is the **index and the shared rules** for the Connect module specs.

Status: **capability map and assumptions approved 2026-11-07** (PM). The four module specs were reviewed by fresh-context Opus agents on 2026-11-07 and their findings applied; they await the PM's approval, one by one. Nothing is implemented or committed yet.

## Objective

After Init, an engineer's agent can **read tickets from the team's issue tracker and work with its code host**, with the team's conventions already learned and stored in `liftoff.yaml`. Nothing is reimplemented: the tracker is reached through an MCP server, the code host through its official CLI, and LiftOff adds what those don't have: the team's conventions and the approval layer.

Connect has two audiences and two flows:
- **A lead**, once, at the real Init: connects the tools, then **learns the conventions** (reading map per issue type, ticket templates, workflow transitions, branch and MR conventions) and writes them to `liftoff.yaml`.
- **A teammate**, per machine: installs the prerequisites, stores a personal credential, and verifies the connection. Everything else comes from the committed config. No questions about conventions.

**Pilot scope (decided 2026-11-07):** Jira Server / Data Center, GitLab (cloud or self-managed), macOS, Claude Code and GitHub Copilot (VS Code). One tracker and one code host end to end. The connector model is written so Jira Cloud, Linear and GitHub slot in later without reworking it.

Success (this release):
- A lead goes from an Init'ed repo to a config with conventions for every issue type the team uses, with each ticket template proven by a test-created ticket, in < 30 min.
- A teammate on a repo whose lead already did it is connected in < 5 min, with no questions about conventions.
- **No credential is ever in the repo, in `liftoff.yaml`, in a command line, in the agent's chat, or in an MCP file.**
- The same `liftoff.yaml` produces working Jira access in Claude Code and in VS Code Copilot.

## Capability map

| Module id | Responsibility | Depends on |
|---|---|---|
| `connect-config` | Fill the reserved `tracker` and `codeHost` sections of `liftoff.yaml`: a connector model (`kind` per connector), the fields onboarding learns, validation, normalization, hashes, plugin pin. | `config-schema` (v1) |
| `connect-wiring` | `liftoff connect-info`: a pure command that turns the config into what the skill needs (MCP entries per agent, the credential contract, prerequisites, GitLab commands). Plus the plugin changes: one shared CLI for both skills, no MCP server in the plugin. | `connect-config`, `agent-render`, `cli` |
| `connect-member` | The `liftoff-connect` skill, member flow: prerequisites, personal credential, MCP wiring, GitLab login, verification. Writes no convention and no secret. | `connect-wiring` |
| `connect-lead` | The lead flow of the same skill (`references/lead-onboarding.md`): learn conventions from samples and metadata, test-create tickets, learn from errors, write the config. | `connect-config`, `connect-wiring`, `connect-member` |

Build order: `connect-config` → `connect-wiring` → `connect-member` → `connect-lead`.

Module specs: `SPEC-connect-<module-id>.md`. The release (plugin `0.2.0`) is the last task of the plan, not a module.

## Decisions (approved assumptions)

1. **Pilot: macOS only.** Linux and Windows credential providers are named in the connector model but not built.
2. **Jira DC** through the community server `sooperset/mcp-atlassian`, run with `uvx`, pinned to an exact version in the config. Token in the macOS Keychain (preferred) or in an environment variable the user already exports (accepted). Never a plain file, never the config.
3. **GitLab** through `glab` (shell), no MCP. `glab` keeps its own credentials. The GitLab built-in MCP is a later `mode`.
4. **The LiftOff CLI stays pure:** no network, no credentials, no child processes. Every call to Jira or GitLab is made by the agent, through the MCP server or `glab`; every write needs the user's approval.
5. **Filling `tracker` and `codeHost` is additive:** `liftoff: 1` stays. Configs that use them require `plugin.version` >= `0.2` (the new validator rejects a connector config pinned lower). A config pinned `"0.2"` read by a `0.1.x` install gets `plugin-outdated` from `check-config` and `render` (the pin-first read); `validate` skips the pin by design, which is harmless because the v1 skill routes through `check-config` first.
6. **MCP configuration is generated, committed and secret-free:** `.mcp.json` (Claude Code) and `.vscode/mcp.json` (VS Code), written by the skill from `connect-info` output. The plugin itself still ships **no MCP server and no hooks** (the v1 security property stands).
7. **One new skill**, `liftoff-connect`, in the same plugin, with two flows (member, lead). One new CLI command, `connect-info`.
8. **Out of scope here:** Plan, Build, Close, the Ticket flow (their own specs), `doctor`, Jira Cloud, Linear, GitHub, GitLab's built-in MCP, mTLS to Jira, Linux and Windows.
9. **The teammate sequence after a lead adds a connector** (the `required` flag does not exist on connector sections in this release, because "apply" means Init/render and would clear the warning without connecting anything): update the plugin to 0.2; rerun the Init skill (raising `plugin.version` changes the always-required `plugin` hash, so `check-config` is `blocked` with `required-changed` until then); run the Connect skill. The Connect skill treats `required-changed` and `not-applied` as "suggest Init, then go on".
10. **Deferred, written down:** the README's "comment conventions" per issue type; a company-pinned MCP *package* or mirror (only the version is pinned); several Jira projects per tracker; a GitLab `mode` and a `textFormat` (single-valued today, so no field); the `required` flag on connector sections.

## Facts these specs rest on (verified 2026-11-07)

| Topic | Fact |
|---|---|
| Claude Code `.mcp.json` | Project scope, shared through git. `${VAR}` and `${VAR:-default}` are expanded in `command`, `args`, `env`, `url`, `headers`. Only the braced forms are documented; bare `$VAR` is documented as literal in VS Code and not documented for Claude Code, so the launcher never writes the token variable after a `$` (it uses `printenv`). Project servers need the user's approval once. A server added with `claude mcp add` at local or user scope is stored in `~/.claude.json` (plain text). |
| VS Code | Native workspace file `.vscode/mcp.json`, top-level `servers`, `"type": "stdio"`, supports `${env:NAME}` and `${input:id}` (a `promptString` with `password: true` is stored by VS Code). The portable `.mcp.json` (`mcpServers`) is experimental in VS Code behind `chat.mcp.workspaceRootConfig.enabled`; there bare `$NAME` is literal text. |
| `mcp-atlassian` | `uvx mcp-atlassian`; Server/DC env: `JIRA_URL`, `JIRA_PERSONAL_TOKEN`, `JIRA_SSL_VERIFY`; `READ_ONLY_MODE`, `ENABLED_TOOLS` (comma-separated tool names); `MCP_ATLASSIAN_USE_SYSTEM_TRUSTSTORE` defaults to true. **Minimum version 0.22.0** (the three metadata tools exist from there), default pin 0.23.1. Tools are exposed only if they pass both `ENABLED_TOOLS` and `TOOLSETS`. The server loads a `.env` with override unless started with `--env-file`, so the launcher passes `--env-file /dev/null`. Tools used here: `jira_get_issue`, `jira_search`, `jira_get_project_issues`, `jira_create_issue`, `jira_update_issue`, `jira_search_fields`, `jira_get_field_options`, `jira_get_project_issue_types`, `jira_get_create_fields`, `jira_get_transitions`, `jira_transition_issue`, `jira_add_comment`. Comments and descriptions are written in Markdown and converted by the server. Custom field ids differ per instance. |
| `glab` | `glab auth login --hostname H`, `glab auth status --hostname H [-F json]`, `glab mr list --merged -F json -P N [-t BRANCH]`, `glab mr view -F json`, `glab repo view -F json`, `glab mr create` with `--target-branch`, `--label`, `--reviewer`, `--template`, `--description-file`. MR templates live in `.gitlab/merge_request_templates/`. |
| macOS Keychain | `security add-generic-password -U -a "$(id -un)" -s SERVICE -w` (no value after `-w`) prompts for the secret on the terminal, so it never appears in an argument or in shell history. `security find-generic-password -a "$(id -un)" -s SERVICE -w` prints it. |

## Project structure (additions to v1)

```
src/config/connectors.ts        → tracker/codeHost types, normalization of the two sections      (connect-config)
schema/liftoff.schema.json      → grows the two connector definitions (one schema file)           (connect-config)
src/config/version.ts           → compareVersions (moved from src/cli/version.ts)                (connect-config)
src/cli/connect-info.ts         → the `connect-info` command                                      (connect-wiring)
src/connect/                    → pure helpers: mcp entry, credential contract, shell quoting    (connect-wiring)
plugin/bin/liftoff.mjs          → the shared CLI bundle (moves from skills/liftoff-init/scripts)  (connect-wiring)
plugin/skills/liftoff-connect/  → SKILL.md, references/lead-onboarding.md, assets/             (connect-member, connect-lead)
test/connect/                   → tests per module
```

## Shared boundaries

- **Always:** keep the CLI pure; write every secret-bearing step as an instruction for the user's own terminal; get approval before any write to Jira, to a file, or to the keychain; show a diff before touching a committed file; pin the MCP server to an exact version.
- **Ask first:** a new CLI command beyond `connect-info`; a new top-level section; a breaking change to the config format (bump `liftoff:`); putting an MCP server or a hook in the plugin; a connector `mode` that routes credentials through LiftOff.
- **Never:** put a token, password or key in the repo, the config, an argument, an environment block of a committed file, or the chat; accept a token pasted into the chat (tell the user to revoke it and make a new one); run `glab auth login --token`; delete a Jira ticket; fix a teammate's problem by silently editing the committed config (propose the change to the lead).

## Success criteria (this release)

- `liftoff validate` accepts every valid connector fixture and rejects every invalid one, with a pointer.
- `liftoff connect-info` output for the fixture configs is byte-stable and contains no secret; its shell strings survive hostile config values (tests).
- A teammate on macOS with Claude Code completes the member flow on the pilot's Jira DC and GitLab, and the agent can read a ticket and list merge requests. Same for VS Code Copilot (Jira access at least).
- A lead completes the lead flow for the pilot's issue types, each template proven by a test ticket, and `liftoff.yaml` validates.
- The existing v1 behavior is unchanged: v1 fixtures keep their hashes, `check-config` does not raise a spurious change after the upgrade.

## Open questions

1. **Approve the new command** `connect-info` ("Ask first" in `SPEC-cli.md`).
2. **Approve moving the CLI** to `plugin/bin/liftoff.mjs` so two skills share one bundle (`SPEC-connect-wiring.md`), which changes the v1 skill's path wording and the packaging tests.
3. The default `mcp-atlassian` pin is 0.23.1 (latest, all 12 tools verified in its source); a release checklist script re-checks the tool names whenever the pin changes.
4. VS Code's trust prompt and behavior for a workspace MCP server that runs `sh -c`: verify in the pilot.
5. `glab` stores its token in the OS keychain by default (`--insecure-storage` forces a file); on a self-managed instance browser sign-in needs a per-host `client_id`, so the realistic path is its masked token prompt; an exported `GITLAB_TOKEN`, `GITLAB_ACCESS_TOKEN` or `OAUTH_TOKEN` overrides the login. All documented in the member flow.
