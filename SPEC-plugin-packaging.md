# Spec: `plugin-packaging`

Module 5 of 5 in `SPEC.md`. Depends on `cli` and `init-flow`. Status: **review findings applied (2026-11-07), awaiting final approval**.

Reviewed by a fresh-context Opus agent on 2026-11-07; its findings are applied here.

Repo: **https://github.com/saugion/liftoff** (public, default branch `main`). Marketplace and plugin both live there.

## Objective

Ship LiftOff as **one Claude-format plugin**, published from a git marketplace, that installs in Claude Code and VS Code/Copilot (and, by hand, Cowork). Also own the committed `.claude/settings.json` entries that make a teammate who clones a repo load the plugin, the version pinning by git tag, and the release steps.

Out of scope: the CLI and skill content (other modules); Connect/Plan/Build/Close skills (later, same plugin).

## What the docs say (verified 2026-11-07)

| Topic | Fact |
|---|---|
| Manifest | `.claude-plugin/plugin.json` at the plugin root; `skills/` etc. at the plugin root, not inside `.claude-plugin/`. |
| Marketplace | `marketplace.json` needs `name`, `owner` (with `owner.name`) and `plugins[]`. A plugin `source` of `"./plugin"` resolves from the marketplace root. It works when the marketplace is added as `github`/`git`, not by a bare `marketplace.json` URL. `liftoff` is not a reserved name. |
| Version | `version` in `plugin.json` wins, then the entry's `version`, then the commit SHA. Updates are detected by comparing versions. No `version` on the marketplace entry is the documented advice. |
| Repo recommendation | `.claude/settings.json` with `extraKnownMarketplaces` (name → `{source: {source: "github", repo, ref?}}`) and `enabledPlugins` (`"<plugin>@<marketplace>": true`). With a relative-path plugin, Claude Code registers the marketplace **after the folder-trust dialog** and the plugin loads; the docs describe no separate "install?" prompt. |
| Marketplace sources | Have `repo`, `ref`, `path`, `sparsePaths`; **no `sha`** (`sha` exists only on plugin sources). A non-relative plugin source would not auto-install from repo settings alone. |
| Per user, not per repo | There is **one checkout of a marketplace per user** (`known_marketplaces.json` is per user). If the `source` in settings differs from what is checked out, Claude Code re-fetches in the background and shows "Plugins changed. Run /reload-plugins". Auto-update is **off** by default for third-party marketplaces. |
| Skill paths | Claude Code substitutes `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PLUGIN_ROOT}` in the SKILL.md body **and** in `allowed-tools` Bash rules. Rules match the **literal command text** (quotes are not normalized). The `allowed-tools` grant **lasts only until the user's next message**. Workspace trust does not gate `allowed-tools`. |
| VS Code | Agent plugins support Claude format; needs `chat.plugins.enabled: true`; `chat.plugins.marketplaces` is experimental. The VS Code plugin reference **names `extraKnownMarketplaces` and `enabledPlugins`** in `.claude/settings.json` and `.github/copilot/settings.json`, same JSON shape, and supports relative-path entries. `${CLAUDE_PLUGIN_ROOT}` is documented only for MCP and hook fields; `${CLAUDE_SKILL_DIR}` is **not** documented, so VS Code passes it through unchanged. `allowed-tools` is an optional experimental Agent Skills field and should not stop a skill loading. A skill `name` must be kebab-case and equal its directory. |
| Cowork | Adds a marketplace by repo URL; skills in plugins work. No project settings file. A Cowork install syncs into Claude Code as `liftoff@synced`; the marketplace copy wins and the synced one shows "not loaded". |

## Decisions

1. **One repo is the marketplace and the source.** The plugin root is a subfolder, `plugin/`, so the install cache holds only the plugin. `marketplace.json` lists one plugin with `source: "./plugin"`. (Users still clone the whole repo into their marketplaces folder; `sparsePaths` could trim that, see Open Questions.)
2. **Names:** marketplace `liftoff`, plugin `liftoff` → settings key `liftoff@liftoff`. Skill `liftoff-init` in `plugin/skills/liftoff-init/` (name equals directory); `/liftoff:liftoff-init` in Claude Code. `marketplace.json` `owner.name`: `saugion`.
3. **One version number:** `plugin.json` `version` = `package.json` `version` = the CLI's `installedVersion` = the tag without `v`. The marketplace entry has no `version`. Start at `0.1.0`; `liftoff.yaml` `plugin.version` is `0.1`, so **patch releases (0.1.1) are never a required change**; a minor bump is.
4. **The CLI ships as a committed build artifact:** `plugin/skills/liftoff-init/scripts/liftoff.mjs` (a plugin installed from git runs no build). **Exact SKILL.md wording** for the path:
   > The CLI is `scripts/liftoff.mjs` next to this SKILL.md. Run it as `node "${CLAUDE_SKILL_DIR}/scripts/liftoff.mjs" <command> --root "<abs path>"`. If the path you are about to run still contains `${`, your host did not substitute it: build the absolute path from the directory this SKILL.md was loaded from.
5. **Pinning = a git tag, with limits stated.** Every release is tag `vX.Y.Z`. Init writes the settings entry with `ref: "v<installed version>"`; a repo's teammates get the release the lead validated until the lead edits the `ref` and `liftoff.yaml` `plugin.version`. Limits, from the docs:
   - The pin is **per user**: two repos with different refs make the user's single marketplace checkout swap on every switch; last repo opened wins. **Move all pilot repos to a new ref together.**
   - A marketplace `sha` cannot be pinned (no such field), and switching to a non-relative plugin source would break auto-install. So the relative path stays and **tags must be immutable** (see Release process).
   - What a teammate sees when the lead bumps the `ref`: they pull and start a session; the cached old version loads; a background re-fetch runs; "Plugins changed. Run /reload-plugins" appears. Until they reload, `check-config` says `plugin-outdated`. If the re-fetch fails (offline, no git access) they stay on the old version.
   - The `plugin-outdated` text that skills show must say what to do: *Claude Code: run `/reload-plugins`, or `/plugin marketplace update liftoff`; VS Code: update or reload the plugin.*
6. **Auto-approving the CLI, scoped to the skill, with known limits.** Frontmatter: `allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/scripts/liftoff.mjs" *)` (quoted, to match the exact command form in decision 4). Limits to document, not to fix: the grant ends at the user's next message, so after any plain-chat question every CLI call prompts again (in Claude Code the skill uses the structured question tool, which keeps the turn alive; other hosts will prompt); a "don't ask again" approval saves a rule with the **versioned** cache path and stops matching after each upgrade; VS Code has no documented equivalent. No `permissions.allow` is ever committed (it would widen everyone's permissions).
7. **Security properties:** the plugin has **no hooks and no MCP servers**, so it runs code only when a user invokes the skill; this is a stated property, changing it is "Ask first". Repos that adopt LiftOff should put a CODEOWNERS rule on `.claude/settings.json` (a PR repointing `repo` to another marketplace would load after trust).
8. **Licensing travels with the install.** `build.mjs` copies `LICENSE` into `plugin/` and keeps third-party notices (esbuild `legalComments: "eof"`, or a generated `plugin/THIRD_PARTY_NOTICES`): `yaml` (ISC) and `ajv` and its dependencies (MIT, BSD-3) require attribution when redistributed. `plugin.json` has `license: Apache-2.0`; SKILL.md frontmatter has `license: Apache-2.0`.
9. **Cowork** is install-by-hand (add the marketplace by repo URL); not a v1 success criterion.

## Repo layout (replaces the structure in `SPEC.md`)

```
.claude-plugin/marketplace.json         → name: liftoff, owner: { name: saugion }, plugins: [{ name: liftoff, source: "./plugin" }]
.gitattributes                          → plugin/** text eol=lf
.github/workflows/release-check.yml     → on v* tag pushes (see Release process)
plugin/.claude-plugin/plugin.json       → name, version, description, author, license: Apache-2.0, repository
plugin/LICENSE, plugin/THIRD_PARTY_NOTICES (or legal comments in the bundle)
plugin/skills/liftoff-init/SKILL.md     → frontmatter: name: liftoff-init, description, license, allowed-tools
plugin/skills/liftoff-init/assets/*     → templates + marketplace-entry.json (generated)
plugin/skills/liftoff-init/references/*
plugin/skills/liftoff-init/scripts/liftoff.mjs  → built CLI (generated, committed)
src/  test/  schema/                    → TypeScript source, tests, JSON Schema
scripts/build.mjs  scripts/release.mjs
package.json  package-lock.json  tsconfig.json  LICENSE (Apache-2.0)  README.md
```

`plugin/` never contains `package.json`, a lockfile, `src/`, `test/` or `node_modules/` (Claude Code would run a dependency install in a folder with a `package.json`).

`marketplace-entry.json` (generated into `assets/`) is **exactly the settings fragment** the skill copies, both keys:

```json
{
  "extraKnownMarketplaces": { "liftoff": { "source": { "source": "github", "repo": "saugion/liftoff", "ref": "v0.1.0" } } },
  "enabledPlugins": { "liftoff@liftoff": true }
}
```

## The settings entries Init writes (init-flow step 9)

Done by the skill with file tools (the CLI never writes `.claude/settings.json`). Rules:

1. File absent → create it with exactly the fragment above.
2. File present → parse as JSON. Parse error → stop and show it; never rewrite a file it cannot parse.
3. `extraKnownMarketplaces.liftoff`: add **only if absent**. If present with a different `source`, **report both and leave it** (never rewrite an existing entry; the lead edits by hand).
4. `enabledPlugins["liftoff@liftoff"]`: add `true` **only if absent**. If present as `false`, report and leave it.
5. Keep all other keys untouched and **keep the file's indentation** (detect it; default 2 spaces) so the diff stays small.
6. **Always show the result before writing**: the diff if the file exists, the full new content if it does not.

Only `.claude/settings.json` is written; `.github/copilot/settings.json` is not (both hosts are documented to read the former).

## Prerequisites and lifecycle

- **Access:** the repo is public, so no credentials are needed. (If it ever goes private, Claude Code clones with non-interactive git: SSH key in ssh-agent, or HTTPS with a stored credential such as `gh auth login && gh auth setup-git`; set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` without a GitHub SSH key. VS Code needs a GitHub sign-in with read access.)
- **VS Code:** `chat.plugins.enabled: true` (pilot prerequisite), and the experimental marketplace setting if the settings.json route does not work.
- **First install (the lead):** `/plugin marketplace add saugion/liftoff#v0.1.0`, so `installedVersion` matches a real tag, not untagged code from `main`. Teammates only clone and trust the folder.
- **Adopting a release:** the lead edits `ref` and `liftoff.yaml` `plugin.version`, commits; teammates see the reload notice.
- **Personal opt-out:** `"liftoff@liftoff": false` in `.claude/settings.local.json`.
- **Rollback:** the lead reverts `ref` and `plugin.version`.
- **Removal:** delete the two keys; the per-user marketplace stays registered until `/plugin marketplace remove liftoff`.

## Release process

One script, `npm run release <x.y.z>`, which refuses to run on a dirty tree and then: bumps `package.json` and `plugin.json`; `npm ci`; builds (typecheck, esbuild, copy the artifact, copy LICENSE and notices, regenerate `marketplace-entry.json` with `ref: "v<x.y.z>"`); runs `npm test`; commits; tags `vX.Y.Z`. Pushing the commit and the tag stays a manual step.

Safeguards that make "never tag a stale artifact" real:
- **CI** (`release-check.yml`, Linux, authoritative): on `v*` tag pushes, checks tag = `plugin.json` version and runs the artifact-freshness test. If it fails, the tag is deleted **before anyone pins it**.
- **GitHub tag ruleset** blocking update and deletion of `v*` tags once published. Created when the repo starts receiving code (a repo setting, not a file); not done by this spec.
- Build reproducibility: esbuild pinned to an exact version, `npm ci` from the lockfile, `.gitattributes` forcing LF on `plugin/**`, the comparison build run from the repo root so embedded path comments match.

To adopt a release, a team lead edits `ref` and `plugin.version` (above).

## Testing Strategy

Automated (`test/packaging/*.test.ts`, no network; CI on Linux is the authority):

- **One version:** `package.json` = `plugin.json` = `marketplace-entry.json` `ref` minus `v`; the marketplace entry has no `version`.
- **Artifact is fresh:** after `npm ci`, rebuild into a temp dir from the repo root; bytes equal the committed `liftoff.mjs` (LF line endings).
- **Artifact runs alone:** copy it to a directory without `node_modules`, run `check-config` on an empty temp root; `installedVersion` equals `plugin.json` `version`.
- **Manifests are valid:** `marketplace.json` and `plugin.json` parse with the required fields; `source: "./plugin"` resolves to a directory with `.claude-plugin/plugin.json`.
- **Skill is loadable:** `SKILL.md` `name` equals its directory, kebab-case; `license` and `allowed-tools` present; `allowed-tools` has the exact quoted rule from Decision 6; the body contains **both** the `${CLAUDE_SKILL_DIR}` form and the "contains `${`" fallback sentence.
- **Plugin stays small and clean:** `plugin/` has no `src/`, `test/`, `node_modules/`, `package.json` or lockfile, and is under 1 MB; `plugin/LICENSE` and the third-party notices exist.
- **Fragment matches:** `marketplace-entry.json` equals the fragment in this spec with `ref` set from the version.

The settings **merge is agent behavior** (the skill merges with its own file tools), so it is covered by the manual checklist, not by unit tests of a function the agent never calls.

Manual (pilot checklist, Claude Code and VS Code/Copilot):
- A clone of a repo with the committed `.claude/settings.json` registers the marketplace after folder trust and loads the plugin in Claude Code; the same in VS Code (with `chat.plugins.enabled`). **Record whether any prompt appears.**
- `/liftoff:liftoff-init` in Claude Code: the first CLI call of the turn needs no approval prompt; after a plain-chat question the prompts return (expected). VS Code: the skill loads despite `allowed-tools`, `liftoff-init` is invocable without clashing with the built-in `/init`, and the fallback path wording works (`${CLAUDE_SKILL_DIR}` left unsubstituted).
- **Two repos, two refs:** open both in turn; the checkout swaps; note the behavior.
- **Ref bump:** tag `v0.1.0` and `v0.2.0`; lead bumps `ref` and `plugin.version`; the teammate sees the reload notice; before reloading `check-config` says `plugin-outdated` with the new message; after `/reload-plugins` it is `ok`. Check whether VS Code re-fetches when the `ref` changes.
- **Settings merge cases:** absent file; existing file with `permissions`; unparsable file; existing different marketplace `source`; `enabledPlugins` already `false`; second run is idempotent; indentation preserved; the result is shown before writing.
- A "don't ask again" approval stops matching after an upgrade (documented, confirm).
- Cowork: add the marketplace by URL, the skill appears.

## Boundaries

- **Always:** one version number in three places, checked by test; build and test before tagging; keep `plugin/` free of source and tooling; keep tags immutable once published.
- **Ask first:** a `permissions.allow` entry in committed settings; writing `.github/copilot/settings.json`; adding a hook or MCP server to the plugin (breaks the security property); a second plugin or marketplace; a different license; a CLI command that writes settings.
- **Never:** credentials in the marketplace, plugin or settings; rewrite or reformat a settings file it cannot parse; rewrite an existing `extraKnownMarketplaces` or `enabledPlugins` entry; tag a release whose artifact differs from a fresh build; delete or move a published tag.

## Success Criteria

- The plugin installs from the marketplace in Claude Code and in VS Code/Copilot (`SPEC.md`).
- A clone of a repo with the committed settings loads the plugin after folder trust in both hosts.
- All packaging tests green in CI; the committed artifact equals a fresh build; `installedVersion` equals the plugin version.
- Pinning works **per user**: with a single repo, a teammate stays on the pinned release until the lead bumps `ref` and `plugin.version`, then sees the reload notice; with two repos on different refs, the last one opened wins (documented).

## Open Questions

1. ~~Repo location and visibility~~ — **settled:** `saugion/liftoff`, public. The `owner.name` in `marketplace.json` is `saugion` unless a display name is preferred.
2. ~~Schema host~~ — **settled:** raw URL at a tag, `https://raw.githubusercontent.com/saugion/liftoff/v<version>/schema/liftoff.schema.json`; Init can write the `$schema` modeline (`init-flow` and `config-schema` updated).
3. ~~VS Code field names~~ — **verified** in the VS Code plugin reference.
4. ~~Skill name~~ — decided: `liftoff-init`.
5. **Does VS Code re-fetch when the `ref` changes?** Pilot check.
6. **`sparsePaths: [".claude-plugin", "plugin"]`** in the settings source would shrink the marketplace clone; check Claude Code and VS Code tolerate it before adding.
7. **Does Claude Code accept a commit SHA as `ref`?** Undocumented; would give an immutable pin without relying on tag rules.
8. **`chat.plugins.marketplaces` is experimental** in VS Code; the pilot documents the prerequisite.
9. **Cowork** layout from a zip upload is unconfirmed; v1 relies on adding the marketplace by URL.
