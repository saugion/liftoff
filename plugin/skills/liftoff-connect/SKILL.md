---
name: liftoff-connect
description: >
  Connect this machine to the team's issue tracker (Jira) and code host (GitLab) named in liftoff.yaml, and, for
  a lead, learn the team's conventions once and write them to liftoff.yaml. Use when the user says "liftoff
  connect", "connect jira", "connect gitlab", "set up my tracker", "liftoff connect lead" or "relearn
  conventions", "change a ticket template", or when a repo has a tracker or codeHost in liftoff.yaml and this machine is not connected yet.
license: Apache-2.0
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff.mjs" *)
---

# LiftOff Connect

Two flows in one skill. The **member flow** (this file) connects *this machine* to the tracker and the code host
that the repo's `liftoff.yaml` already names: prerequisites, a personal credential, the MCP entry, a check that it
works. The **lead flow** (`references/lead-onboarding.md`) is done once by the lead: it connects the lead's machine,
then learns how the team really uses its tracker and code host and writes it to `liftoff.yaml`.

You are the instructions. The `liftoff` CLI decides everything deterministic: `connect-info` returns every command
and every MCP entry you run. **Run what it returns, not what you remember. Never assemble a shell command or an MCP
entry yourself.** Every step checks before it acts, so the whole flow is safe to run again and skips what is done.

## Rules

- **Always:** run what `connect-info` returns; check before acting; get approval before installing software,
  writing a file or changing the keychain; show a diff before touching a committed file; have the user type any
  secret into their own terminal, in a window you do not drive.
- **Ask first:** a command that is not from `connect-info` (the fixed `glab` verification commands of step 6 are
  fine); a file other than the two MCP files and the `.gitignore` negation; any write to Jira.
- **Never:** see, ask for, accept, store or echo a token (it is never in the chat). Run `credential.keychain.add` or
  `gitlab.login` yourself. Pass a token as an argument. Dump the environment, or read the credential variable. Read
  a keychain item's value. Show the token option of the `glab` status command. Read `glab`'s config directory. Edit
  `liftoff.yaml` in the member flow. Disable SSL verification. Overwrite an MCP file you cannot parse. Replace a
  server other than `liftoff-jira`. Delete a Jira ticket. Commit or push.

## Running the CLI

The CLI is `bin/liftoff.mjs` at the root of the plugin, shared with the other LiftOff skills. Run it as
`node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff.mjs" <command> --root "<abs path>"`.
**If the path you are about to run still contains `${`, your host did not substitute it: build the absolute path
from the directory this SKILL.md was loaded from (the CLI is `../../bin/liftoff.mjs` from there).**

Commands used here: `connect-info`, `check-config`, `validate`, `render`. Stdout is always **one JSON document**;
read it whatever the exit code (exit 1 is a normal state, e.g. the config is missing). Exit 2 or stdout that is not
JSON means something is wrong with the environment: show `message` or stderr and stop.

Ask the user with your structured question tool if you have one (in Claude Code that is AskUserQuestion);
otherwise ask in chat. Show diffs as fenced `diff` blocks. Do file work with your **file tools**, not `cp` or
`mkdir`. Quote every path.

## 0. Environment and root

Root = `git rev-parse --show-toplevel`; if that fails, the current directory. `node --version` must be 22.12 or
newer, else stop with a clear message.

## 1. Read the connectors, and route on the state

Run `connect-info`. Then:

| Result | What you do |
|---|---|
| exit 2, `usage`, `internal`, or stdout that is not JSON | Show `message` or stderr. Stop. |
| `plugin-outdated` | Stop. Tell the user to update the plugin to at least the pin, and how: *Claude Code: run `/reload-plugins`, or `/plugin marketplace update liftoff`; VS Code: update or reload the plugin.* |
| `config-missing` | Suggest the Init skill. Stop. |
| `config-invalid` | Show `errors`. Stop. |
| `tracker` and `codeHost` both null (**no connector**) | Ask whether the user is the lead. Yes: follow `references/lead-onboarding.md` from L1. No: "ask your lead to run Connect first". Stop. |
| a connector, but `tracker.issueTypes` is empty or `codeHost.conventions` has nothing beyond its defaults (**lead work incomplete**) | Ask "are you the lead finishing onboarding?". Yes: follow the reference from **L3**. No: run the member flow below and tell the user the conventions are not learned yet. |
| a connector and the lead work done | The member flow below. |

If you enter the lead flow at L3 or later, the reference says what is still asked. The user can also say so outright ("liftoff connect lead", "relearn conventions", "change the Bug template", "define my own ticket template"): go to the reference (for one type: L4.2, L4.5 and L5 for that type).

Also run `check-config`. If it says `not-applied` or `required-changed` (typically the lead raised `plugin.version`
to add Connect), say so and suggest the Init skill first, but go on: Connect does not need it. The sequence for a
teammate after a lead adds a connector is: update the plugin, rerun Init, run Connect.

## 2. Prerequisites

For each entry of `prerequisites`: run its `check`. If a check fails but the user says the tool is installed, ask where (a different shell, PATH); do not install over it, and do not go on until the check passes or the user explicitly says to continue without it. For a missing one, show `why` and `install`, ask, and run
`install` only on approval (it installs software: never silently). Check again. If `brew` itself is missing, say so
and point to its installer; do not install it. Note: the Jira server is downloaded from PyPI on first start; on a
network that blocks PyPI the preflight (step 3.4) fails and the user may need a `UV_INDEX_URL`.

## 3. The Jira credential (only with a `tracker`)

1. **Is a token already available?** Run `credential.envCheck` (a presence test that prints nothing) and
   `credential.keychain.check` (prints nothing). If either succeeds: "found", without showing anything, go to 4.
2. **Otherwise, in the user's own terminal.** Show `credential.createToken`, then show `credential.keychain.add` in
   a copyable code block and say:
   - **Claude Code:** not with the `!` prefix (it runs inside the session, its output goes into the conversation).
     Open a **separate** Terminal or iTerm window.
   - **VS Code:** open a new terminal **yourself**, not the one the agent drives.
   - Type the token **only at the prompt** (it is not echoed, never in an argument or shell history), then reply
     only "done".
   - If the token was ever typed after `-w`, or into a chat message: **revoke** it in Jira now and make a new one.

   Then run `credential.keychain.check` again to confirm.
3. **You never see the token.** You do not run `credential.keychain.add`, do not ask for the token, do not accept it
   in the chat. If the user pastes one: stop, tell them to **revoke it in Jira now** and create a new one, and do not
   use the pasted value anywhere. The pasted copy stays in this session's history, so revoking is the fix; hold the other
   steps until the new token is stored.
4. **Preflight.** Run `credential.preflight`. It prints `uvx not found`, `no Jira token found (or the keychain is
   locked)`, or nothing (success); it never prints the token; it warms the `uv` cache and surfaces the macOS
   keychain dialog once, under the user's eyes. A failure sends the user back to the step it names.
5. **A server that is already running keeps the old token** (it is read at start). After a first add, or a rotation
   (`credential.keychain.remove`, then 3.2 again), tell the user to **reconnect `liftoff-jira`** (`/mcp` in Claude
   Code; restart the server in VS Code) before verifying.

## 4. The MCP entries

For each element of `mcp` (already one per agent in `agents`): merge `entry` into `file` under `serversKey` /
`server` (always `liftoff-jira`, a key LiftOff owns):

1. File absent: create it with only that key.
2. File present: parse as JSON; if it does not parse, stop and show the error, never rewrite it.
3. `liftoff-jira` absent: add it. Present and equal: nothing. Present and different: show the diff and replace it
   **on approval**, and tell the user to **let the lead know** (the repo's entry and the config disagree).
4. Every other server is untouched; keep the file's indentation (2 spaces if unknown).
5. Show the result before writing; never commit.

Both files are written whichever agent the user runs now, because both are committed for the team. If a file did not
exist, the lead never committed it: say so and suggest committing it. **Check `git check-ignore` on both files**
(`.vscode/` is often ignored): if ignored, propose a `!.vscode/mcp.json` negation in `.gitignore` as a diff.
Tell the user what comes next: **Claude Code** asks to approve the project server `liftoff-jira` the first time
(approve it; `/mcp` shows its status) and may need a new session; **VS Code** shows its own trust prompt.

## 5. Verify Jira

If the Jira tools are available in this session, call `jira_search` with the JQL `project = <tracker.project> ORDER
BY updated DESC` and a limit of 1 (the arguments are `jql` and `limit`). Success: report the project and the newest ticket key, or "connected; the project has no tickets yet" when the list is empty. Failure:
- `401` / `403` / authentication: the token is wrong or expired: rotate (3.5).
- `404` or "project not found": a **config problem**. Do not edit `liftoff.yaml`. Write the exact change you
  propose as a diff for the lead and say so.
- a config that already sets `tracker.server.sslVerify: false`: say so to the lead in the summary as a note, never change it;
- an SSL or certificate error: a **config problem** (`tracker.server.sslVerify`, or the machine's CA): propose it to
  the lead as a diff; never disable verification on your own.
- the server did not start: you cannot see its stderr, so run `credential.preflight` again: it names what is missing.

If the tools are **not** available, the server has not loaded yet: tell the user to approve and reconnect (or
restart the agent) and **run this skill again**; the second run skips steps 2-4 and finishes here.

## 6. GitLab (only with a `codeHost`)

1. Run `gitlab.status`. Logged in to `codeHost.host`: go on.
2. Not logged in: tell the user to run `gitlab.login` **in their own terminal** (same instructions as 3.2). `glab`
   keeps its token in the OS keychain; on a self-managed instance browser sign-in needs a per-host client id, so the
   realistic path is its masked token prompt. Never a token in the chat or in an argument. Run `gitlab.status` again.
3. **An exported `GITLAB_TOKEN`, `GITLAB_ACCESS_TOKEN` or `OAUTH_TOKEN` overrides the login.** If the status shows a
   different user or host than expected, **ask** whether one is exported in their shell profile (never print them).
4. Verify with the fixed commands (no config value in them): `glab repo view -F json` (reachable; note the default
   branch) and `glab mr list -P 1 -F json` (the API answers). If the repo's `origin` is not on `codeHost.host` (informational, nothing blocks), say
   so: a config or clone problem to hand to the lead.

## 7. Summary

Per connector: connected, or what is still needed. Files written (the MCP files), with the reminder to commit them
if the lead has not. If `check-config` is now `warn` or `blocked` only because of `tracker`, `codeHost` or `plugin`,
say that the Init skill applies it. Any config change you propose for the lead, ready to paste. **Never commit.**
