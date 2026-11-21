# A fake Jira to try LiftOff from zero (Docker)

For trying LiftOff the way a newcomer would, with no real Jira, GitLab or token: a fake Jira Data Center in a container
with a few tickets (PROJ-123..126, an epic STR-1). It starts with **no repo and no LiftOff setup**: you create the
project, run Init and Connect yourself. Nothing leaves your machine. It is the fake the end-to-end tests use; behaving
well here is **not** proof against a real Jira.

Requirements: Docker, Node 22.12+, Claude Code. Run from a clone of this repo (`<repo>` below).

## Set it all up with one script

```bash
scripts/fake-setup.sh          # about a minute the first time
```

It builds the plugin, starts the fake Jira in Docker on `https://127.0.0.1:8443` (project `PROJ`, token `agent-run-PAT-do-not-leak`: fake and public), creates
a small project with a git history and a bare remote in `~/liftoff-sandbox/my-app`, and prints the command that starts Claude Code with the plugin and the
fakes. An older `~/liftoff-sandbox` is moved aside (`~/liftoff-sandbox.old-<date>`), never deleted. `SANDBOX=<folder>` uses another place.
What the Jira holds now: `~/liftoff-sandbox/jira-state.json` (refreshed every second). To stop it: `scripts/fake-setup.sh --down`.

## Walk through it as a newcomer

The guided setup (see the README, "The setup guide, step by step"). You need a project folder with git and a remote to push to; the fake has no GitLab, so make a bare one.

1. **Run the script** (above) and copy the command it prints. It starts Claude Code in `my-app` with the plugin, the fake `uvx`, `security` and `glab`
   (the fake `security` keeps the token in a file instead of your real keychain, through `FAKE_KEYCHAIN_FILE`).
2. **Say what you want**, like a person who has never heard of LiftOff would. For example: "I want to set up liftoff for this project".
3. **The agent starts the guide and prints an address:** open it in the browser.
4. **Part 1, as the PO.** Name and purpose; Jira `https://127.0.0.1:8443`, token `agent-run-PAT-do-not-leak`. Press Connect: the certificate is not known,
   and the Jira is on this computer, so the page offers "skip the check": click it. Choose the project from the list (`PROJ`), choose ticket types, add one
   of your own (name it, say which Jira type it is), edit the templates, Create the files, then **Save and share**: a branch `liftoff/setup-po` is pushed to `remote.git`.
5. **Part 2, as the TL.** Open the project again (`/liftoff:liftoff-init`, or `liftoff-ui --root`): the page goes to the technical part. Confirm the
   modules, the assistants, git, a GitLab address (any), the quality bar, and save: `liftoff/setup-tl`.
6. **Every day:** *"create a story: ..."* (Ticket), *"plan PROJ-123"* (Plan). For the Jira fields and workflow, `/liftoff:liftoff-connect` as lead (the `glab`
   fake answers for `gitlab.company.local`, project `acme/billing`).
7. **The control panel** (all the sections, afterwards): `cd <repo> && npm run ui -- --root ~/liftoff-sandbox/my-app`.

Check with `/mcp` that `liftoff-jira` is connected once the guide has written `.mcp.json`. Restart Claude after a change: an MCP server that is already
running keeps its old settings.

## Other modes

`docker run ... liftoff-fake-jira node dist/agent/setup.mjs /sandbox brain` also writes a ready repo in `/sandbox/app`
(already Init'ed and Connected, with a small wiki): for scripted agent runs, not for a newcomer test. See `test/agent/setup.ts`.
The stand-in `uvx` does not check the Jira certificate when `liftoff.yaml` says `sslVerify: false`, which the "skip the check" click writes for a Jira on this computer. (The real `mcp-atlassian` would do the same: it reads no certificate file.)

## Stop, reset

```bash
docker rm -f lo-fake-jira     # the Jira is in memory: the tickets you created are lost
rm -rf ~/liftoff-sandbox      # start again on an empty folder
```

## Limits

- It speaks the few Jira REST calls the skills use, not the whole API (see `docs/pilot-checklist.md`, items 3 and 31).
- The port is fixed to 8443 because `liftoff.yaml` stores the URL. To change it, set `-e FAKE_JIRA_PORT=...` and publish that port.
- Not tried by a person yet: the two parts were driven by scripts against this fake and a real git remote, not by a person in a browser or a real Claude Code session.
