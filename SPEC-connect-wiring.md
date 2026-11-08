# Spec: `connect-wiring`

Module 2 of 4 in `SPEC-connect.md`. Depends on `connect-config`, `agent-render` and `cli` (v1). Status: **review findings applied (2026-11-07), awaiting final approval**.

Reviewed by a fresh-context Opus agent on 2026-11-07, who **ran** the launcher under bash, dash and zsh and read the `mcp-atlassian` wheels; its findings are applied here.

## Objective

Turn the connector sections of `liftoff.yaml` into everything a skill needs to connect a machine, **as data**, without LiftOff ever running a command, touching the network, or holding a credential:

1. the MCP server entry for Jira, per agent (Claude Code, Copilot), ready to be merged into the committed MCP files;
2. the **credential contract**: where the Jira token lives, and the exact commands to check, store, rotate and preflight it;
3. the **prerequisites** (`uv`, `glab`) with the command that checks each and how to install it;
4. the GitLab commands (login, status) for the configured host.

This is one new pure CLI command, `connect-info`. The skills (`connect-member`, `connect-lead`) run the commands it returns, with the user's approval; they never assemble a command or an MCP entry themselves. Also in this module: the **plugin changes** that two skills need (one shared CLI, still no MCP server and no hook in the plugin).

## Tech Stack

No new dependency. `src/connect/` is plain TypeScript. The tests use a real `sh` with fake `uvx` and `security` executables on a temp `PATH` (macOS and Linux CI).

**Server version.** `mcp-atlassian` **0.23.1** (latest on 2026-08-19) is the default pin; the **minimum is 0.22.0**: the three tools `jira_get_field_options`, `jira_get_project_issue_types` and `jira_get_create_fields` do not exist before it, and the lead flow needs them. The minimum is enforced by `connect-config` (`server.version` >= `MIN_JIRA_SERVER_VERSION`), the default lives in `src/connect/defaults.json`.

## Command

```
liftoff connect-info --root <abs path>        exit 0 ok, 1 fatal (same shape as `render`), 2 usage
```

Reads the config with the **pin-first read** (`readConfigWithPin`), so an outdated plugin gets `plugin-outdated`, an invalid config `config-invalid`, a missing one `config-missing`, all as the fatal shape `{ ok: false, errors: [{ code, message, ... }] }`. It never reads `.liftoff/`, never writes, never looks at the network.

### Output

```json
{
  "ok": true, "root": "/abs/repo", "installedVersion": "0.2.0",
  "agents": ["claude-code", "copilot"],
  "tracker": { "...normalized TrackerConfig..." },
  "codeHost": { "...normalized CodeHostConfig..." },
  "mcp": [
    { "agent": "claude-code", "file": ".mcp.json", "serversKey": "mcpServers", "server": "liftoff-jira",
      "entry": { "command": "sh", "args": ["-c", "<launcher>"], "env": { "JIRA_URL": "https://jira.company.local", "JIRA_SSL_VERIFY": "true", "READ_ONLY_MODE": "false", "ENABLED_TOOLS": "jira_get_issue,...", "TOOLSETS": "jira_issues,..." } } },
    { "agent": "copilot", "file": ".vscode/mcp.json", "serversKey": "servers", "server": "liftoff-jira",
      "entry": { "type": "stdio", "command": "sh", "args": ["-c", "<launcher>"], "env": { "...same..." } } }
  ],
  "credential": {
    "envVar": "LIFTOFF_JIRA_TOKEN",
    "envCheck": "[ -n \"$(printenv LIFTOFF_JIRA_TOKEN)\" ]",
    "keychain": {
      "service": "liftoff-jira@jira.company.local",
      "check":  "security find-generic-password -a \"$(id -un)\" -s 'liftoff-jira@jira.company.local' >/dev/null 2>&1",
      "add":    "security add-generic-password -U -a \"$(id -un)\" -s 'liftoff-jira@jira.company.local' -w",
      "remove": "security delete-generic-password -a \"$(id -un)\" -s 'liftoff-jira@jira.company.local'"
    },
    "preflight": "sh -c '<launcher with its last line replaced, see below>'",
    "createToken": "In Jira: your profile, Personal Access Tokens, Create token (an admin may have to enable PATs). English text for the user."
  },
  "prerequisites": [
    { "id": "uv",   "why": "runs the Jira MCP server", "check": "uvx --version",  "install": "brew install uv" },
    { "id": "glab", "why": "GitLab access",            "check": "glab --version", "install": "brew install glab" }
  ],
  "gitlab": { "host": "gitlab.company.local", "login": "glab auth login --hostname gitlab.company.local",
              "status": "glab auth status --hostname gitlab.company.local -F json" }
}
```

- `tracker`, `codeHost`, `credential`, `gitlab` are `null` when the config has no such connector; `mcp` is `[]` without a tracker; `prerequisites` lists only what the configured connectors need. `glab`'s flags were verified against glab 1.124; the minimum version is fixed when implementing and goes into the entry.
- `mcp` has one entry per agent in `agents.targets`, sorted by agent (so a consumer never filters it again).
- **The commands are strings built by the CLI**, so the skill and the tests share one source. Every dynamic part is single-quoted by `shQuote`, on top of the pattern restrictions of `connect-config`. The keychain service name is built from the **normalized, lowercased host** (and port), so changing the case of the URL never orphans anyone's keychain item.
- `keychain.add` uses `-U` (update if it exists): rotation is one step and a rerun never fails with "already exists".
- Output is deterministic for a given config and plugin version. No timestamps, no machine data.

### The launcher (the one non-obvious piece)

The MCP entry runs `sh -c <launcher>`. The launcher resolves the token **at server start, inside the server's own process**, so it appears in no argument, no committed file and no log:

```sh
command -v uvx >/dev/null || { echo "liftoff: uvx not found (brew install uv)" >&2; exit 1; }
T="$(printenv LIFTOFF_JIRA_TOKEN)"
[ -n "$T" ] || T="$(security find-generic-password -a "$(id -un)" -s 'liftoff-jira@jira.company.local' -w 2>/dev/null)"
[ -n "$T" ] || { echo "liftoff: no Jira token found (or the keychain is locked); run the LiftOff Connect skill" >&2; exit 1; }
JIRA_PERSONAL_TOKEN="$T" exec uvx mcp-atlassian@0.23.1 --env-file /dev/null
```

(written on one line, joined with `; `, in the JSON.) Properties, each tested (the reviewer ran all of them under bash 3.2 posix, dash, bash, zsh-as-sh and zsh):
- An exported `LIFTOFF_JIRA_TOKEN` wins over the keychain: the accepted env-var route. Without `security` (Linux) the keychain step fails silently and the "no token" message follows.
- The token goes only into the **environment of the `exec`'d process**, never into an argument (`ps` shows `uvx mcp-atlassian@0.23.1 --env-file /dev/null`). `T` is not exported.
- **`--env-file /dev/null` is essential.** Without it the server calls `load_dotenv(override=True)`, which walks up from the package's location and would pick up a `~/.env` or `/.env` and **silently replace** `JIRA_URL`, `ENABLED_TOOLS`, `READ_ONLY_MODE` and even the token: that defeats the allowlist and read-only guarantees and could send the token to another host. (`--env-file` accepts any existing non-directory path; `/dev/null` passes.)
- **No `${...}` and no `$LIFTOFF` anywhere in the entry.** Claude Code documents only `${VAR}` and `${VAR:-default}` expansion, and VS Code documents bare `$NAME` as literal, but Claude Code never says a bare `$VAR` is left alone. So the variable is read with `printenv LIFTOFF_JIRA_TOKEN`, which no host can expand; the only `$` left are `$T`, `$(...)`, which both hosts leave to the shell.
- Failure is loud and says what to do. The agent **cannot see** the server's stderr (neither host documents where it appears), which is why `credential.preflight` exists.
- `exec` replaces the shell, so the server is the process the host supervises.

### The preflight

`credential.preflight` is `sh -c` of the **same script with the last line replaced** by `exec uvx mcp-atlassian@0.23.1 --version >/dev/null`. It prints one of: `liftoff: uvx not found ...`, `liftoff: no Jira token found ...`, or nothing and exit 0. It never prints the token, it warms the `uv` cache (a first start may otherwise exceed the host's MCP startup timeout), and it surfaces the macOS keychain access dialog once, under the user's eyes, before the host starts the server. The member flow runs it before writing the MCP files and before asking the user to restart.

### The `env` block

`JIRA_URL` (`tracker.url`), `JIRA_SSL_VERIFY` (`"true"`/`"false"` from `server.sslVerify`), `READ_ONLY_MODE` (`"true"`/`"false"` from `server.readOnly`), `ENABLED_TOOLS` (the allowlist `JIRA_TOOLS`) and **`TOOLSETS`** (the toolsets those tools belong to, derived from `JIRA_TOOLS`). A tool is exposed only if it passes **both** filters, and `jira_get_project_issue_types` / `jira_get_create_fields` live in `jira_projects`, a non-default toolset; the server warns that its default will change from "all" to six core toolsets, so a pin bump would silently hide them unless `TOOLSETS` is explicit.

`JIRA_TOOLS` (12), with their toolsets:

| Toolset | Tools |
|---|---|
| `jira_issues` | `jira_get_issue`, `jira_search`, `jira_get_project_issues`, `jira_create_issue`, `jira_update_issue` |
| `jira_fields` | `jira_search_fields`, `jira_get_field_options` |
| `jira_comments` | `jira_add_comment` |
| `jira_transitions` | `jira_get_transitions`, `jira_transition_issue` |
| `jira_projects` | `jira_get_project_issue_types`, `jira_get_create_fields` |

`TOOLSETS = jira_issues,jira_fields,jira_comments,jira_transitions,jira_projects`. The list deliberately leaves out delete, move, assign, batch, links, worklog, attachments and Confluence. A skill that names a tool outside it fails the drift tests of the skill specs, because the server would not expose it. Anything not in `env` is the server's default, including `MCP_ATLASSIAN_USE_SYSTEM_TRUSTSTORE=true` (internal CAs work through the OS trust store). `JIRA_PROJECTS_FILTER` is **not** set: the lead flow may use a separate test project.

### Where each agent's entry goes (the skill merges, this module only supplies)

| Agent | File | Servers key | Entry |
|---|---|---|---|
| `claude-code` | `.mcp.json` | `mcpServers` | `command`, `args`, `env` (no `type`: stdio is the default) |
| `copilot` | `.vscode/mcp.json` | `servers` | the same, plus `"type": "stdio"` (required in VS Code) |

The server id is always `liftoff-jira`: a key LiftOff owns. Merge rules for the skill (the same spirit as the `.claude/settings.json` rules of v1):
1. File absent: create it with only that key.
2. File present: parse as JSON; if it does not parse, stop and show the error, never rewrite it.
3. `liftoff-jira` absent: add it. Present and equal: nothing. Present and different: show the diff and replace it **on approval** (it is LiftOff's key; the lead changed the config).
4. Every other server in the file is untouched, byte-semantically; keep the file's indentation (2 spaces if unknown).
5. Always show the result before writing; never commit.

The portable `.mcp.json` in VS Code (experimental) is not used: `.vscode/mcp.json` is VS Code's native file.

## Plugin changes (this module owns them)

The v1 plugin has one skill and its CLI at `plugin/skills/liftoff-init/scripts/liftoff.mjs`. Two skills must share one CLI, not carry two 560 KB copies:

1. **The bundle moves to `plugin/bin/liftoff.mjs`.** `scripts/build.mjs` writes it there, **and the old file is removed with an explicit `git rm`** (the build never deletes; the file-set test catches a leftover). `${CLAUDE_PLUGIN_ROOT}` is substituted in plugin skills (body and `allowed-tools`) in Claude Code, "including resources shared between the plugin's skills" (docs).
2. **Both skills use** `node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff.mjs" <command> --root "<abs path>"` and the frontmatter rule `allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff.mjs" *)`. The fallback sentence for hosts that do not substitute the variable (VS Code) **keeps its exact v1 wording** ("still contains `${`", "the directory this SKILL.md was loaded from", which the packaging test matches) and adds that the CLI is `../../bin/liftoff.mjs` from there.
3. **Still no MCP server and no hook in the plugin.** `plugin.json` keeps no `mcpServers`/`hooks`; the packaging test stays. The Jira server is configured in the **repo's** MCP files, which the lead commits.
4. **Version `0.2.0`** (`package.json` and `plugin.json`), released with `npm run release` as in v1.
5. **`scripts/build.mjs`** also: writes `plugin/skills/liftoff-connect/assets/defaults.json` from `src/connect/defaults.json` (owned by `connect-lead`); changes the `thirdPartyNotices` header to "bundled into bin/liftoff.mjs".
6. **Workflows.** `git diff --exit-code -- plugin` ignores files that were never committed, and this release adds new generated files (`plugin/bin/liftoff.mjs`, `assets/defaults.json`). `ci.yml` and `release-check.yml` get a second check, `test -z "$(git status --porcelain -- plugin)"`, and `workflows.test.ts` expects it.
7. **Tests that change** (`test/packaging/packaging.test.ts`): `ARTIFACT` moves; the skills directory listing and the referenced-files check work per skill directory (two skills); the "exactly the expected set of files" list; the skill-loadable and contract-drift tests run for both skills.
8. **Amendments to approved v1 specs**, listed so they are approved on purpose: `SPEC-plugin-packaging.md` (Decision 4, the layout tree, Decision 6's rule, the "exactly the expected files" test); `SPEC-init-flow.md` (the CLI path wording); `SPEC-cli.md` (line 15, "Skills run `node "<skill-dir>/scripts/liftoff.mjs"`", and the command table gains `connect-info`; "v1 commands ... nothing else" is superseded); `SPEC.md` (the project-structure tree).

## Project Structure

```
src/connect/shell.ts        → shQuote
src/connect/launcher.ts     → the launcher and preflight strings
src/connect/info.ts         → buildInfo(config, installedVersion): the connect-info value (pure)
src/connect/tools.ts        → JIRA_TOOLS, TOOLSETS
src/connect/defaults.json   → { "jiraServerVersion": "0.23.1" }   (the minimum, 0.22.0, is MIN_JIRA_SERVER_VERSION in connect-config)
src/cli/connect-info.ts     → the command (readConfigWithPin → buildInfo → JSON)
src/cli/main.ts             → registers `connect-info`; USAGE updated
scripts/build.mjs           → output moves to plugin/bin/liftoff.mjs; writes defaults.json for the lead module
.github/workflows/*.yml     → the untracked-files check
test/connect/*.test.ts
test/fixtures/connect/<case>/liftoff.yaml + expected.json      (golden)
```

## Code Style

```ts
// Single-quote for the shell. Pattern validation is the first defence, this is the second.
export const shQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;
```

Small pure functions; `buildInfo(config, installedVersion)` takes data and returns data.

## Testing Strategy

- **Golden:** `connect-info` for fixtures: Jira only; GitLab only; both; neither; claude-code only; copilot only; both agents; `readOnly: true`; `sslVerify: false`; a `url` with a port and a context path (service name keeps host and port, drops the path, lowercases the host). The golden is produced with `buildInfo(config, "0.0.0-test")` and compared **without `root`**, so `npm run release` (which bumps the version and runs the tests) never breaks it. Byte-stable across two runs.
- **No secrets, no expansion** (checked on the **parsed** string values, not the serialized JSON): the launcher equals an exact golden string; no `${` and no `$LIFTOFF` anywhere in an entry; `env` never contains a token variable.
- **Shell safety:** `shQuote` against hostile strings (`a'b`, `$(x)`, backticks, newlines, `;`, `*`, an empty string, a backslash-quote) under `sh`, `dash`, `zsh`: `sh -c "printf %s <quoted>"` prints each literally. The built commands run with a hostile value forced into the config *object* (bypassing the schema) must not execute.
- **The launcher, with a real `sh`, a fake `uvx` and a fake `security` on `PATH`:** (a) env var set: `uvx` receives `JIRA_PERSONAL_TOKEN` equal to it and the keychain stub is not called; (b) env unset, keychain returns a token: used; (c) neither: exit 1, the message on stderr, `uvx` not called; (d) `uvx` missing: exit 1 with the install hint; (e) in every success case the token is **not** in the fake `uvx`'s argv or `ps` line, and `T` is not in its environment; (f) a token with spaces, quotes, `$`, backticks, `\`, `;`, `*` arrives intact; (g) **the argv ends with `--env-file /dev/null`**; (h) a `.env` file in the working directory and in `HOME` cannot change what the fake server receives (the fake `uvx` is given the real server's `.env` search behavior in a stub).
- **The preflight:** the same cases (a)-(d) report their message and exit code; with a token it prints nothing, exits 0, never prints the token, and its last command is `uvx mcp-atlassian@<ver> --version`.
- **Allowlist:** `ENABLED_TOOLS` equals `JIRA_TOOLS` joined; `TOOLSETS` equals the toolsets of those tools (derived, with a test that every tool maps to one); `JIRA_TOOLS` has no delete/move/assign/batch tool; every name is `jira_` snake case.
- **Version:** the default pin is >= the minimum; the schema rejects a pin below `0.22.0` (`connect-config`).
- **Failure shapes:** missing config, invalid config, outdated plugin, `--overwrite` rejected, unknown flag: coded errors, exit 1/2, one JSON document.
- **Plugin:** the packaging tests as listed in "Plugin changes", 7.
- The static guard keeps passing: `src/` has no network, no `child_process`.

## Boundaries

- **Always:** keep `connect-info` pure and read-only; quote every dynamic part; keep the token out of every argument, committed file and `${...}`; pin the server version; keep the tool allowlist minimal; end the launcher with `--env-file /dev/null`.
- **Ask first:** a second command; adding a tool to `JIRA_TOOLS`; a different token source in the launcher; putting an MCP server or hook in the plugin; setting `JIRA_PROJECTS_FILTER`.
- **Never:** put a literal token, or a reference to one that a host could expand, in an entry; run a command from the CLI; write a repo file from the CLI; change `READ_ONLY_MODE`, `ENABLED_TOOLS` or `TOOLSETS` from anywhere but the config.

## Success Criteria

- Golden, launcher and preflight tests pass; the plugin packaging tests pass with the moved CLI; CI green on Node 22 and 24, including the untracked-files check.
- In a repo with a configured tracker, the entry merged into `.mcp.json` starts `mcp-atlassian` in Claude Code, and the same entry in `.vscode/mcp.json` in VS Code, with the token from the keychain or `LIFTOFF_JIRA_TOKEN`; the server's `tools/list` contains all 12 `JIRA_TOOLS` (pilot check).
- `ps` during a session shows no token; a `~/.env` containing `JIRA_URL=...` changes nothing.

## Open Questions

1. **PATH under VS Code.** A GUI-launched VS Code may not see `uvx` (Homebrew's `bin`); VS Code resolves the login-shell environment at startup, which should cover it. The preflight and the launcher's message make a failure obvious; confirm in the pilot.
2. **Keychain prompts.** The first `security find-generic-password -w` from a new process may show a macOS access dialog ("always allow"); the preflight triggers it once. A locked keychain (for example over SSH) reads as "no token found": the message now says so.
3. **`sh -c` servers.** Neither host documents a prompt or a refusal for a server whose command is `sh`; verify in the pilot.
4. **The env-var route exposes the token to the agent's own shell** (it is in the environment of every command the agent runs). The member spec forbids `env`, `printenv` and friends, and uses `credential.envCheck` (a presence check that prints nothing). The keychain route does not have this exposure; the member flow prefers it.
5. **`uvx pkg@version` syntax** was not executed by the reviewer; verified by the first real run.
6. **Linux and Windows** need a credential provider for the launcher (`secret-tool`, Credential Manager) and a non-`sh` launcher; the `credential` object is shaped to take them (`keychain` becomes a per-OS map).
