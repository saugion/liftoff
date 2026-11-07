# Spec: `plugin-packaging`

Module 5 of 5 in `SPEC.md`. Depends on `cli` and `init-flow`. Status: **draft, awaiting review** (2026-11-07).

## Objective

Ship LiftOff as **one Claude-format plugin**, published from a git marketplace, that installs in Claude Code and VS Code/Copilot (and, by hand, Cowork). Also own the committed `.claude/settings.json` entries that make a teammate who clones a repo get the plugin prompt, the version pinning that lets a team "stay behind" until the lead validates a release, and the release steps.

Out of scope: the CLI and skill content (other modules), Connect/Plan/Build/Close skills (later; they will live in the same plugin).

## What the docs say (verified 2026-11-07)

| Topic | Fact | Source |
|---|---|---|
| Manifest | `.claude-plugin/plugin.json` at the plugin root; `skills/`, `commands/`, `hooks/` at the plugin root, not inside `.claude-plugin/`. | Claude Code manifest reference |
| Version | A plugin's version is: `version` in `plugin.json` first, then the marketplace entry's `version`, then (git sources) the 12-char commit SHA. Updates are detected by comparing versions. | Claude Code plugin loading |
| Marketplace | `marketplace.json` with `name`, `owner`, `plugins[]`. A plugin `source` can be a relative path starting with `./`, or `github`/`url`/`git-subdir` with optional `ref` (tag) and `sha`. | Marketplace reference |
| Repo recommendation | `.claude/settings.json` with `extraKnownMarketplaces` (name → `{source: {source: "github", repo, ref?}}`) and `enabledPlugins` (`"<plugin>@<marketplace>": true`). Takes effect after the user trusts the folder. | Claude Code settings example |
| Skill paths | In plugin skills Claude Code substitutes `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PLUGIN_ROOT}` in the skill's markdown **and** in `allowed-tools` Bash rules (so a bundled script can run without a prompt). | Claude Code skills |
| VS Code | Agent plugins are supported ("Copilot, Claude, and legacy OpenPlugin formats"); needs `chat.plugins.enabled: true`; `chat.plugins.marketplaces` is **experimental**; a project can recommend plugins from `.claude/settings.json` or `.github/copilot/settings.json`. A skill's `name` must be kebab-case and equal its directory name or it is silently skipped. | VS Code agent-plugins docs |
| VS Code variables | `${CLAUDE_PLUGIN_ROOT}` is documented for MCP server and hook fields, **not** for skill text. | VS Code plugin reference |
| Cowork | Adds a marketplace by repo URL; skills in plugins work. No project settings file. | Anthropic support docs |

**Not verified:** that VS Code reads the exact `extraKnownMarketplaces` / `enabledPlugins` field names from `.claude/settings.json` (the VS Code page names the files and the behavior but not the fields; examples come from third-party repos). The pilot checklist covers it.

## Decisions

1. **One repo is the marketplace and the source.** The plugin root is a subfolder, `plugin/`, so installs contain only the plugin, not `src/`, `test/` or tooling. `marketplace.json` lists one plugin with `source: "./plugin"`.
2. **Names:** marketplace `liftoff`, plugin `liftoff` → settings key `liftoff@liftoff`. Skill `liftoff-init` in `plugin/skills/liftoff-init/` (name equals directory). In Claude Code it is `/liftoff:liftoff-init`.
3. **Version lives in one number:** `plugin.json` `version` = `package.json` `version` = the CLI's `installedVersion`. The marketplace entry has **no** `version` (plugin.json wins anyway; one place, no drift). Start at `0.1.0`; `liftoff.yaml` `plugin.version` is `0.1`.
4. **The CLI ships as a committed build artifact:** `plugin/skills/liftoff-init/scripts/liftoff.mjs`. A plugin installed from git runs no build, so the file is committed on every release. The skill calls it by absolute path (`init-flow`): in Claude Code via `${CLAUDE_SKILL_DIR}/scripts/liftoff.mjs`; in other hosts, resolved against the directory `SKILL.md` was loaded from.
5. **Pinning = a git tag.** Every release is tag `vX.Y.Z`. Init writes the marketplace entry with `ref: "v<installed version>"`, so a repo's teammates get exactly the release the lead validated and stay there until the lead edits the ref and bumps `plugin.version` (a *required change*, so teammates update, or get `plugin-outdated`). The pin in `liftoff.yaml` is a minimum; the `ref` in settings is the exact version. Init never rewrites an existing entry.
6. **No permission rule is committed.** Auto-approving the CLI is done in the **skill frontmatter**, scoped to the skill: `allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/liftoff.mjs *)`. A project-wide `permissions.allow` from a committed file would widen everyone's permissions ("Ask first"). VS Code has no documented equivalent; the pilot documents the approval prompts.
7. **Cowork** is install-by-hand (add the marketplace by repo URL). It is not a v1 success criterion.

## Repo layout (replaces the structure in `SPEC.md`)

```
.claude-plugin/marketplace.json         → name: liftoff, owner, plugins: [{ name: liftoff, source: "./plugin" }]
plugin/.claude-plugin/plugin.json       → name, version, description, author, license: Apache-2.0, repository
plugin/skills/liftoff-init/SKILL.md             → frontmatter: name: liftoff-init, description, allowed-tools
plugin/skills/liftoff-init/assets/*             → templates + marketplace-entry.json (generated)
plugin/skills/liftoff-init/references/*
plugin/skills/liftoff-init/scripts/liftoff.mjs  → built CLI (generated, committed)
src/  test/  schema/                    → TypeScript source, tests, JSON Schema
scripts/build.mjs                       → esbuild bundle + copy + marketplace-entry.json
package.json  tsconfig.json  LICENSE (Apache-2.0)  README.md
```

`marketplace-entry.json` (generated, in `assets/`), read by Init step 9:

```json
{ "marketplace": "liftoff", "plugin": "liftoff",
  "source": { "source": "github", "repo": "<owner>/<repo>", "ref": "v0.1.0" } }
```

## The settings entries Init writes (init-flow step 9)

Done by the skill with file tools (the CLI never writes `.claude/settings.json`). Merge rules:

1. File absent → create it with exactly the two keys below.
2. File present → parse as JSON. Parse error → stop and show it; never rewrite a file it cannot parse.
3. `extraKnownMarketplaces.liftoff`: set from `marketplace-entry.json` **only if absent**. If present with a different `source`, show both and ask; do not overwrite.
4. `enabledPlugins["liftoff@liftoff"]`: set `true` **only if absent**. If present as `false`, report it and leave it (the user opted out).
5. Everything else (`permissions`, `hooks`, …) is preserved byte-for-byte as values; formatting is normalized to 2-space JSON. Show the diff before writing.

```json
{
  "extraKnownMarketplaces": { "liftoff": { "source": { "source": "github", "repo": "<owner>/<repo>", "ref": "v0.1.0" } } },
  "enabledPlugins": { "liftoff@liftoff": true }
}
```

Only `.claude/settings.json` is written (both Claude Code and VS Code are documented to read it). `.github/copilot/settings.json` is not written in v1.

## Release process

1. Bump `version` in `package.json` and `plugin/.claude-plugin/plugin.json`.
2. `npm run build`: typecheck, esbuild bundle, copy to `plugin/skills/liftoff-init/scripts/liftoff.mjs`, regenerate `marketplace-entry.json` with `ref: "v<version>"`.
3. `npm test` (includes the packaging tests below).
4. Commit, tag `v<version>`, push both.
5. To adopt it, a team lead edits their repo's `ref` and `liftoff.yaml` `plugin.version`, and commits.

esbuild is pinned to an exact version so the artifact is reproducible.

## Testing Strategy

Automated (`test/packaging/*.test.ts`, no network):

- **One version:** `package.json` = `plugin.json` = `marketplace-entry.json` `ref` minus the `v`; the marketplace entry has no `version`.
- **Artifact is fresh:** rebuild into a temp dir; bytes equal the committed `liftoff.mjs`.
- **Artifact runs alone:** copy it to a directory without `node_modules`, run `check-config` on an empty temp root; `installedVersion` equals `plugin.json` `version`.
- **Manifests are valid:** `marketplace.json` and `plugin.json` parse, required fields present, `source: "./plugin"` resolves to a directory with `.claude-plugin/plugin.json`.
- **Skill is loadable:** `SKILL.md` frontmatter `name` equals its directory name, is kebab-case, and `allowed-tools` references `${CLAUDE_SKILL_DIR}/scripts/liftoff.mjs`.
- **Plugin stays small:** `plugin/` contains no `src/`, `test/`, `node_modules/` and is under 1 MB.
- **Settings merge fixtures** (the rules above, as a pure function the test calls on the same logic the skill text describes): absent file; existing file with `permissions`; unparseable file; existing different marketplace source; `enabledPlugins` already `false`; idempotent second run.

Manual (pilot checklist, Claude Code and VS Code/Copilot):
- In a clone of a repo with the committed `.claude/settings.json`, Claude Code prompts to install the marketplace/plugin after folder trust; VS Code (with `chat.plugins.enabled`) offers the plugin. **Confirms the VS Code field names.**
- Run `/liftoff:liftoff-init` (Claude Code) and the skill in VS Code. Claude: no approval prompt for the CLI. VS Code: skill loads despite the `allowed-tools` frontmatter field, and `liftoff-init` is invocable without clashing with VS Code's built-in `/init`.
- Stay-behind: tag `v0.1.0` and `v0.2.0`; a repo pinned to `v0.1.0` stays on it; after the lead bumps the `ref` and `plugin.version`, the teammate is prompted to update; a teammate on an older version gets `plugin-outdated`.
- Cowork: add the marketplace by URL, the skill appears.

## Boundaries

- **Always:** one version number in three places, checked by test; build the artifact before tagging; keep `plugin/` free of source and tooling.
- **Ask first:** a `permissions.allow` entry in committed settings; writing `.github/copilot/settings.json`; adding a second plugin or marketplace; adding a hook or MCP server to the plugin; a different license.
- **Never:** put credentials in the marketplace, plugin or settings; overwrite or reformat a settings file it cannot parse; rewrite an existing `extraKnownMarketplaces` or `enabledPlugins` entry silently; tag a release whose artifact differs from a fresh build.

## Success Criteria

- The plugin installs from the marketplace in Claude Code and in VS Code/Copilot (`SPEC.md`).
- A clone of a repo with the committed settings prompts for the plugin in both hosts (VS Code field names confirmed or the gap recorded).
- All packaging tests green; the committed artifact equals a fresh build; `installedVersion` equals the plugin version.
- A team pinned to a tag stays on it until its lead bumps the `ref` and `plugin.version`.

## Open Questions

1. **Repo location and visibility** (`<owner>/<repo>`): blocks `marketplace-entry.json`, the `repository` field and the `config-schema` `$schema` host. If private, teammates need git access; Claude Code and VS Code use their own git credentials, not LiftOff. Also needed: the `owner` name in `marketplace.json`.
2. **Schema host.** Proposed in `config-schema`: raw URL at a tag of this repo, e.g. `https://raw.githubusercontent.com/<owner>/<repo>/v0.1.0/schema/liftoff.schema.json`. Works for a public repo only; a private repo needs another host or no modeline.
3. **VS Code reads `extraKnownMarketplaces` / `enabledPlugins` from `.claude/settings.json`?** Documented for the file, not for the field names. Manual check; fallback is also writing `.github/copilot/settings.json` (Ask first).
4. ~~Skill name~~ — **decided 2026-11-07:** `liftoff-init` (directory and `name` together), to avoid VS Code's built-in `/init`. In Claude Code it is `/liftoff:liftoff-init`.
5. **`allowed-tools` frontmatter in VS Code**: undocumented there; verify the skill still loads. Fallback: drop it and document the approval prompts.
6. **`chat.plugins.marketplaces` is experimental.** The pilot must document the VS Code prerequisite (`chat.plugins.enabled`, and the marketplace setting if the settings.json route does not work).
7. **Cowork** layout from a zip upload is unconfirmed; v1 relies on adding the marketplace by URL.
