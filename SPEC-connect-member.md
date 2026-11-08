# Spec: `connect-member`

Module 3 of 4 in `SPEC-connect.md`. Depends on `connect-wiring`. Status: **review findings applied (2026-11-07), awaiting final approval**.

Reviewed by a fresh-context Opus agent on 2026-11-07 (it read the `mcp-atlassian` source and the `glab`, Claude Code and VS Code docs); its findings are applied here.

## Objective

The **member flow** of the new `liftoff-connect` Agent Skill: connect *this machine* to the tracker and the code host that the repo's `liftoff.yaml` already names. It installs nothing silently, stores a credential only through the user's own terminal, writes the MCP entry the repo's agents need, and proves both connections work.

It asks **no question about conventions** (they are in the committed config) and **writes no convention and no secret**. A teammate who clones a connected repo is done in minutes.

The skill is instructions only. Everything it runs comes from `liftoff connect-info` (commands as strings, MCP entries as data), so the skill and the CLI cannot drift and the skill never assembles a shell command.

## Behavior

Conventions as in `liftoff-init`: ask the user with the structured question tool if the agent has one, otherwise in chat; show diffs as fenced `diff` blocks; use file tools (not `cp`/`mkdir`) for file work; every path quoted; the CLI is `node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff.mjs" <command> --root "<abs>"` with the fallback sentence for hosts that do not substitute the variable. Every step **checks before it acts**, so the whole flow is safe to run again and skips what is done.

### 0. Environment and root
The repo top level by `git rev-parse --show-toplevel` (no repo: the current directory); `node --version` >= 22.12, else stop.

### 1. Read the connectors, and route on the state of the config
Run `connect-info`. **Exit 2, `usage`/`internal`, or stdout that is not JSON:** show the message and stop. Fatal codes: `plugin-outdated` (stop; say how to update in each host, as in `liftoff-init`), `config-missing` (suggest the Init skill; stop), `config-invalid` (show `errors`; stop). If `check-config` says `not-applied` or `required-changed` (typically the lead raised `plugin.version` to add Connect), say so and suggest the Init skill first, but go on: Connect does not need it. The sequence for a teammate after the lead adds a connector is: update the plugin to 0.2, rerun Init, run Connect.

Then route **on the state, not on whether a connector exists**:
- **No connector configured** (`tracker` and `codeHost` both null): the repo has no Connect yet. Ask whether the user is the lead; if yes, follow `references/lead-onboarding.md` from L1; if not, say "ask your lead to run Connect first" and stop.
- **A connector is configured but the lead work is incomplete** (`tracker.issueTypes` is empty, or `codeHost.conventions` has nothing beyond its defaults): ask "are you the lead finishing onboarding?"; if yes, follow the reference from **L3** (the machine is connected by then, or this flow connects it first); if not, run the member flow below and tell the user that the conventions are not learned yet.
- **A connector is configured and the lead work is done:** the member flow below.
- The user can also say so outright ("liftoff connect lead", "relearn conventions"): go to the reference.

### 2. Prerequisites
For each entry of `prerequisites`: run its `check`. For a missing one, show `why` and `install`, ask, and run `install` only on approval (it installs software: never silently). Check again. If `brew` itself is missing, say so and point to its installer; do not install it. Note for later: `uvx` downloads the Jira server from PyPI on first start; on a network that blocks PyPI the preflight (step 3) will fail, and the user may need a `UV_INDEX_URL`.

### 3. The Jira credential (only with a `tracker`)
1. **Is a token already available?** Run `credential.envCheck` (a presence test that prints nothing) and `credential.keychain.check` (no `-w`, prints nothing). If either succeeds: "found", without showing it, and go to the preflight.
2. **Otherwise, in the user's own terminal.** Show `credential.createToken`, then show the `credential.keychain.add` command in a copyable code block and say:
   - **Claude Code:** not with the `!` prefix (that runs inside the session, its output goes into the conversation, and interactive prompts are unreliable there). Open a **separate** Terminal or iTerm window.
   - **VS Code:** open a new terminal **yourself**, not the one the agent drives.
   - Type the token **only at the prompt** (it is not echoed and never appears in an argument or in shell history), then reply only "done".
   - If you ever typed the token after `-w`, or into a chat message: revoke it in Jira now and make a new one.
   Then run `credential.keychain.check` again to confirm.
3. **The agent never sees the token.** It does not run `credential.keychain.add` itself, does not ask for the token, and does not accept it in the chat. If the user pastes one: stop, tell them to **revoke it in Jira now** and create a new one, and do not use the pasted value anywhere.
4. **Preflight.** Run `credential.preflight`. It prints `uvx not found`, `no Jira token found (or the keychain is locked)`, or nothing (success); it never prints the token; it warms the `uv` cache and surfaces the macOS keychain access dialog once, under the user's eyes. A failure sends the user back to the step it names.
5. **A server that is already running keeps the old token** (the launcher reads it at start). After a first `add`, or a rotation (`credential.keychain.remove`, then step 2 again), tell the user to **reconnect `liftoff-jira`** (`/mcp` in Claude Code; restart the server in VS Code) before verifying.

### 4. The MCP entries
For each element of `mcp` (already one per agent in `agents.targets`): apply the merge rules of `SPEC-connect-wiring.md` to `file` with `entry` under `serversKey` / `server` (`liftoff-jira`): create, nothing to do, or a diff replaced on approval; never touch another server; unparsable file: stop. Both files are written whichever agent the user runs now, because both are committed for the team. When the member replaces a different `liftoff-jira`, say so and **tell them to let the lead know** (the repo's entry and the config disagree).

- If a file did not exist, the lead never committed it: say so and suggest committing it (never commit for them).
- **Check `git check-ignore` on both files** (as `liftoff-init` does): `.vscode/` is often gitignored; if a file is ignored, propose a `!.vscode/mcp.json` negation in `.gitignore` as a diff.
- Tell the user what comes next: **Claude Code** asks to approve the project server `liftoff-jira` the first time (approve it; `/mcp` shows its status) and may need a new session after the file changed; **VS Code** shows its own trust prompt for the workspace server.

### 5. Verify Jira
If the Jira tools are available in this session, call `jira_search` with the JQL `project = <tracker.project> ORDER BY updated DESC` and a limit of 1. Success: report the project and the newest ticket key. Failure:
- `401` / `403` / authentication: the token is wrong or expired: rotate (step 3.5).
- `404` or "project not found": a **config problem**. Do not edit `liftoff.yaml`. Write the exact change you propose as a diff for the lead and say so.
- an SSL or certificate error: a **config problem** (`tracker.server.sslVerify`, or the machine's CA): propose it to the lead as a diff; never disable verification on your own.
- the server did not start: the agent cannot see the server's stderr, so run `credential.preflight` again: it names what is missing.
If the tools are **not** available: the server has not loaded yet. Tell the user to approve and reconnect (or restart the agent) and **run the skill again**: the second run skips steps 2-4 and finishes here.

### 6. GitLab (only with a `codeHost`)
1. Run `gitlab.status`. Logged in to `gitlab.host`: go on.
2. Not logged in: tell the user to run `gitlab.login` **in their own terminal** (same instructions as step 3.2). `glab` stores its token in the OS keychain by default (`--insecure-storage` forces a plain file); on a self-managed instance, browser sign-in needs a per-host `client_id`, so the realistic path is `glab`'s own masked token prompt. Never `--token`, never a token in the chat or in an argument. Run `gitlab.status` again.
3. **An exported `GITLAB_TOKEN`, `GITLAB_ACCESS_TOKEN` or `OAUTH_TOKEN` overrides the login.** If `gitlab.status` shows a different user or host than the user expects, **ask** whether one of these is exported in their shell profile (never print them).
4. Verify in the repo with the skill's own fixed commands (no config value in them): `glab repo view -F json` (reachable; note the default branch) and `glab mr list -P 1 -F json` (the API answers). If the repo's `origin` is not on `gitlab.host`, say so: a config or clone problem to hand to the lead.

### 7. Summary
Per connector: connected / what is still needed. Files written (the MCP files), with the reminder to commit them if the lead has not. If `check-config` is now `warn` or `blocked` only because of `tracker`, `codeHost` or `plugin`, say that the Init skill applies it. Any proposed config change for the lead, ready to paste. **Never commit.**

## Project Structure

```
plugin/skills/liftoff-connect/SKILL.md          → frontmatter + the member flow; routes the lead cases to references/
plugin/skills/liftoff-connect/references/       → lead-onboarding.md (connect-lead)
```

Frontmatter: `name: liftoff-connect`, a `description` that names the triggers ("connect jira", "connect gitlab", "liftoff connect", "liftoff connect lead", "relearn conventions", "set up my tracker"), `license: Apache-2.0`, `allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff.mjs" *)`. The other commands (`security`, `uvx`, `glab`, `brew`) are deliberately **not** pre-approved: each one is something the user should see. (Pre-approving the read-only `mcp__liftoff-jira__*` tools to cut prompts in the lead flow is an option for the pilot to evaluate; writes keep prompting.) `${CLAUDE_PLUGIN_ROOT}` appears only in `SKILL.md`, never in `references/` (substitution is documented only for the skill body and `allowed-tools`).

## Code Style

Same register as `liftoff-init`: imperative, numbered, each step ends with what to show the user. Tool names appear in backticks exactly as the server exposes them.

## Testing Strategy

The skill is agent behavior. Two layers, as for `init-flow`.

**Automated:**
1. **Skill loads:** the packaging test, now for both skills: `name` equals the directory and is kebab-case, `license`, the exact quoted `allowed-tools` rule, the body shows the same command prefix and the fallback sentence, every referenced file exists (including `references/` and `assets/` paths of each skill).
2. **Contract drift (reads the CLI source):** every key of `connect-info` that the skill relies on (`prerequisites`, `credential.envCheck`, `credential.keychain.{check,add,remove}`, `credential.preflight`, `credential.createToken`, `mcp`, `gitlab.{login,status}`, `agents`, `tracker.project`, `tracker.issueTypes`, `codeHost.conventions`) is named in the skill; every fatal code the skill can meet from `connect-info` is handled; every `jira_*` tool the skill names is in `JIRA_TOOLS`. A second check: every key named in the skill exists in the golden fixture output.
3. **No secret-bearing command is hardcoded.** The skill never contains, **inside a fenced code block or as a backticked runnable command**, `security add-generic-password`, `security find-generic-password` with `-w` or `-g`, `--token`, `LIFTOFF_JIRA_TOKEN=`, `uvx mcp-atlassian`, `glab auth login`, `glab auth status -t`, `printenv`, `env`: those come from `connect-info`. The **rules** that forbid them are written with the contract keys (`credential.keychain.add`, `gitlab.login`) and prose, so the rule and the check do not contradict each other. The skill does contain "never in the chat" and "revoke".
4. The routing table in step 1 names every state (no connector; connector with incomplete lead work; done; lead triggers) and every failure shape (exit 2, `usage`, `internal`, non-JSON).

**Manual checklist (macOS, Claude Code first, then VS Code Copilot), on the pilot's Jira DC and GitLab:**
- fresh machine: `uv` and `glab` missing: the skill offers the install, runs it only on approval; a network that blocks PyPI;
- token in the keychain; token via `LIFTOFF_JIRA_TOKEN`; no token (the skill walks the user through it, in a separate terminal); a pasted token (the skill refuses and says to revoke); someone types the command with the token after `-w` or uses `!`: the skill's warning is understood;
- the preflight, and the keychain dialog on its first run; a rotation while the server is running (reconnect, then verify);
- MCP file absent / present and equal / present with a different `liftoff-jira` / present but unparsable / present with other servers (untouched) / **gitignored** (`.vscode/`);
- Claude Code: the approval prompt, then a working `jira_search`; whether the tools appear in the same session after the file was written or only after a restart; VS Code: the trust prompt, then the same; with `chat.mcp.workspaceRootConfig.enabled` on, whether both `.mcp.json` and `.vscode/mcp.json` load (two servers);
- a wrong token (`401`) and the rotation; a wrong project key (the proposal for the lead, no edit); an SSL error;
- `glab` not logged in; logged in to another host; the repo's `origin` on another host; `GITLAB_TOKEN` exported; whether `glab auth status -F json` shows any part of the token;
- a restart in the middle of the lead flow (routing resumes it);
- running the skill twice: the second run does nothing it already did;
- grep the Claude transcripts (`~/.claude/projects/**/*.jsonl`) and the MCP logs for the token; `ps -Eww` during a session: no token anywhere.
Results are recorded; a failure becomes a task.

## Boundaries

- **Always:** run what `connect-info` returns, not what you remember; check before acting; get approval before installing software, writing a file or changing the keychain; have the user type any secret into their own terminal, in a window the agent does not drive.
- **Ask first:** adding a command the skill runs that is not from `connect-info` or the fixed `glab` verification commands; writing a file other than the two MCP files (and the `.gitignore` negation); any write to Jira.
- **Never:** see, ask for, accept, store or echo a token; run `credential.keychain.add` or `gitlab.login` yourself; pass a token as an argument or with `--token`; run `env`, `printenv`, `set`, `export -p`, or read the credential variable; read a keychain item's value (`-w` or `-g`); show `glab auth status` with its token option; read `glab`'s config directory; edit `liftoff.yaml` in the member flow; disable SSL verification; overwrite an MCP file you cannot parse; replace a server other than `liftoff-jira`; commit. (Optional hardening in Claude Code: project deny rules for those commands. It is policy only: the keychain item is readable by any process the user runs, the agent included.)

## Success Criteria

- On a machine with nothing installed, a teammate reaches "Jira connected" and "GitLab connected" following the skill, in < 5 minutes plus install time, on Claude Code; VS Code reaches the same for Jira.
- At no point is a token visible to the agent, in the chat, in a file in the repo, or in `ps`.
- The second run is a no-op that reports "already connected".
- A config problem is reported to the lead as a proposed diff, never fixed silently.
- A user who restarts the agent in the middle of the lead flow lands back in it.
- The automated skill tests pass and fail when a code, key or tool name drifts.

## Open Questions

1. **Tool availability in the same session.** Neither host's docs say whether a `.mcp.json` written mid-session is picked up without a restart. The flow assumes not and ends step 5 with "run me again"; confirm in the pilot and word step 4 accordingly.
2. **Who commits the MCP files.** The lead flow tells the lead to commit them; a member who finds them absent only gets a suggestion.
3. **`!` in Claude Code with an interactive prompt** was not verified; the skill avoids it by telling the user to use a separate window.
4. **A teammate on a repo with a tracker but whose agent is not in `agents.targets`** gets no MCP file for it: the skill says so and suggests the lead add the agent.
5. **`.vscode/mcp.json` is labelled "deprecated" in VS Code's guided flow** while the portable `.mcp.json` is still experimental; track it and revisit if VS Code changes its native file.
