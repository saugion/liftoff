# Spec: LiftOff v1 (index + shared rules)

Source of truth for product decisions: `README.md`. This file specs **v1 = roadmap item 1** (Init, multi-agent output, `liftoff.yaml` read/write) and is the index of the module specs.

**Decision change vs README:** the runtime is a **CLI** (TypeScript library + `liftoff` binary, bundled into one file shipped inside the plugin; no `npx`, no npm publish), not an MCP server. Skills call it through the shell. An MCP wrapper over the same library is deferred to roadmap item 4 (Ticket flow for PO/PM in chat clients). README must be updated to match (see Open Questions).

## Objective

A software engineer runs one flow in Claude Code or GitHub Copilot and turns a new repo into an AI-native one: module structure, root and per-module `AGENTS.md`, `CONSTRAINTS.md`, per-agent files, and a committed `liftoff.yaml`. A teammate who clones the repo gets the same setup with no interview.

Users: the pilot group (the PM and 3–5 close colleagues, mixed Claude Code and Copilot, on 1–2 new projects).

Success (v1):
- Zero to AI-ready repo in < 10 min without a team config, ~1 min with one.
- The same `liftoff.yaml` renders correct files for both agents.
- A teammate with the config present is asked no questions (v1 has no personal ones), only to resolve file conflicts.

## Capability map

| Module id | Responsibility | Depends on |
|---|---|---|
| `config-schema` | `liftoff.yaml` + JSON Schema. Read, write, validate. Required/default fields. Version hash. | — |
| `agent-render` | From the team config alone, render the thin per-agent files (Claude Code, Copilot) that point to `AGENTS.md`. `AGENTS.md` is referenced, never read or written. | config-schema |
| `cli` | `liftoff` binary and library API. v1 commands: `check-config`, `validate`, `render`. Pure: no network, no credentials. | config-schema, agent-render |
| `init-flow` | Init Agent Skill, built on `project-init`. Detects new/existing repo. Full interview without config, applies the config if found. Writes `liftoff.yaml`. | cli |
| `plugin-packaging` | `.claude-plugin/plugin.json`, marketplace repo, `.claude/settings.json` (`extraKnownMarketplaces` + `enabledPlugins`), plugin version pin check. | cli, init-flow |

Build order: `config-schema` → `agent-render` → `cli` → `init-flow` → `plugin-packaging`

Module specs: `SPEC-<module-id>.md`, written in this order after the map is approved.

## v1 scope assumptions

1. `liftoff.yaml` holds what Init needs: stack, modules, target agents, constraints, plugin version. Tracker and code host sections exist in the schema as optional reserved fields, filled by roadmap item 2.
2. `extends` (central config by git URL) is **out** of v1.
3. In: config version/hash check and plugin pin check, blocking only when the change is *required*. Every future work command (ticket flow etc.) runs `check-config` first; in v1 `validate` ignores the pin and the applied record (Init loops on it) and `render` ignores config changes (it resolves them), blocking only on `plugin-outdated`. Out: diff-before-overwrite UI (the Init skill shows diffs for `conflict`s), `warn_on_config_update` beyond a hand-edited personal flag.
4. `doctor` is out of v1.
5. Out entirely: Connect, Plan, Build, Close, Ticket flow, MCP server.

## Tech Stack

- TypeScript on Node (>=22.12, engines), ESM. Typecheck with `tsc --noEmit`; build with esbuild into one bundled file `dist/liftoff.mjs` (see `SPEC-cli.md`). No linter in v1.
- YAML parse/write with comment preservation; JSON Schema validation. Library choices (candidates: `yaml`, Ajv) and the test runner (candidate: Vitest) **to be verified with current docs before the module specs fix them.**
- Skills: Agent Skills (`SKILL.md`), shipped in one Claude-format plugin, installable in Claude Code, Claude Desktop/Cowork and VS Code/Copilot.

## Commands (proposed, to be fixed when the repo is scaffolded)

```
Build:   npm run build        (esbuild → dist/liftoff.mjs)
Test:    npm test
Typecheck: npm run typecheck
CLI:     node dist/liftoff.mjs check-config | validate | render --root <abs-path>
```

## Project Structure (proposed)

```
src/config/        → liftoff.yaml read/validate, schema, hash          (config-schema)
src/render/        → per-agent renderers                               (agent-render)
src/cli/           → binary entry, command handlers                    (cli)
schema/            → liftoff.schema.json
plugin/skills/liftoff-init/ → SKILL.md + assets/references + built CLI         (init-flow)
plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json     (plugin-packaging)
scripts/build.mjs  → esbuild bundle + copy into the plugin
test/              → unit + fixture-based tests
```

## Code Style

Small pure functions, explicit types, no classes unless state is needed, errors as typed results at module boundaries.

```ts
export type Result<T> = { ok: true; value: T } | { ok: false; errors: ConfigError[] };
// ConfigError = { path: string; message: string; line?: number; col?: number }

export function validateConfig(raw: unknown): Result<Config> {
  const errors = schemaErrors(raw);
  return errors.length ? { ok: false, errors } : { ok: true, value: raw as Config };
}
```

## Testing Strategy

- Unit tests per module, colocated fixtures in `test/fixtures/`.
- `config-schema`: valid/invalid configs, round-trip write keeps comments, hash stable across formatting.
- `agent-render`: golden-file tests, one config rendered for Claude Code and for Copilot.
- `cli`: command-level tests on a temp directory; the CLI makes no network calls (asserted).
- `init-flow` and `plugin-packaging`: manual checklist on a real new repo in Claude Code and in VS Code/Copilot (agent behavior can't be unit-tested). The pilot's Init-time metric is measured here.

## Boundaries

- **Always:** validate input at the CLI boundary; keep the CLI free of network access and credentials; run tests before committing; write specs and files in English.
- **Ask first:** adding a dependency; changing the `liftoff.yaml` schema in a breaking way; changing a README decision; adding a command beyond the three above.
- **Never:** store credentials or tokens in the config or in files; write to an external system; overwrite a hand-edited file without showing it first; remove a failing test to get green.

## Success Criteria (v1)

- `liftoff validate` rejects every invalid fixture and accepts every valid one.
- `liftoff render` on one config produces the expected files for Claude Code and for Copilot (golden tests pass).
- `liftoff check-config` returns blocked / warn / ok correctly for required and non-required changes and for an older plugin version.
- Init on a new empty repo ends with `liftoff.yaml`, root `AGENTS.md`, `CONSTRAINTS.md`, per-agent files and `.claude/settings.json`, in both agents.
- Re-running Init on a repo with a config asks no questions in v1, only to resolve file conflicts.
- Plugin installs from the marketplace in Claude Code and VS Code/Copilot.

## Open Questions

1. ~~README update from "MCP server" to "CLI, MCP later"~~ — done 2026-10-05.
2. ~~Binary/package name and npm scope~~ — no npm publish (bundled in the plugin); the binary name stays `liftoff`. (`liftoff` and `liftoff-cli` are taken on npm.)
3. ~~Minimum Node version~~ — 22.12 (Vitest 5.1 floor).
4. ~~Which per-agent files Copilot needs in v1~~ — answered in `SPEC-agent-render.md`: `AGENTS.md` is the source; Claude Code gets `CLAUDE.md` (root + per module) importing it; Copilot gets a `.github/copilot-instructions.md` pointer. VS Code Copilot reads only the root `AGENTS.md` by default, so always-needed rules go in the root file.
