# LiftOff — Handoff

Date: 2026-11-07 · Repo: https://github.com/saugion/liftoff (specs only, no code yet)

## Where we are

Spec-driven development of **v1 = roadmap item 1** (Init, multi-agent output, `liftoff.yaml` validation), running `/spec` with `README.md` as input. No code exists yet.

- **Decision:** the LiftOff runtime is a **CLI** (TS library + `liftoff` binary via `npx`, called by the skills through the shell), not an MCP server. An MCP wrapper over the same library comes with the Ticket flow (roadmap 4). `README.md` is updated to match.
- **`SPEC.md`**: index, v1 scope, capability map, shared rules. Approved.
- **`SPEC-config-schema.md`**: module 1, **approved**. Reviewed by a fresh-context Opus agent; findings applied. Key choices:
  - `required: true` lives inside each top-level section (no `enforce` list); list data sits under named keys.
  - **No writer in v1:** the Init skill writes `liftoff.yaml`, then runs `liftoff validate` until it passes. A `write-config` command is added only if that loop proves flaky.
  - Hashes are computed on the normalized value (defaults applied). A change is a *required change* if the section is required in the old **or** the new config, so the "last applied" record must store `requiredSections` too.
  - Secret guard in code, exact-key match, also checks values.

## Capability map

| Module id | Depends on | Spec |
|---|---|---|
| `config-schema` | — | **approved** |
| `agent-render` | config-schema | next |
| `cli` | config-schema, agent-render | todo |
| `init-flow` | cli | todo |
| `plugin-packaging` | cli, init-flow | todo |

Build order: `config-schema` → `agent-render` → `cli` → `init-flow` → `plugin-packaging`.

- **`SPEC-agent-render.md`**: written and reviewed by fresh-context Opus (2026-11-07), findings applied, awaiting final approval. Key choices:
  - `AGENTS.md` is the only source; render is config-only and pure. Claude Code gets `CLAUDE.md` (root + one per module) with only the marker and `@AGENTS.md`; Copilot gets a `.github/copilot-instructions.md` pointer.
  - Module `AGENTS.md` is ignored by Claude without a `CLAUDE.md` import next to it, and by VS Code Copilot by default (nested setting is experimental). v1 accepts the VS Code limit: always-needed rules go in the root `AGENTS.md`.
  - Marker carries a body hash, so `cli` can tell unedited from hand-edited files.

- **`SPEC-agent-render.md`: approved 2026-11-07.**
- **`SPEC-cli.md`**: reviewed by fresh-context Opus 2026-11-07, findings applied, **awaiting final approval**. Key choices: commands `validate`, `check-config`, `render`; one JSON document on stdout, every fatal error has a `code`; Node >=22.12, Vitest 5.1, `node:util` parseArgs, no linter; **CLI bundled with esbuild into `dist/liftoff.mjs` and shipped inside the plugin (no npm, no `npx`)**; applied record in `.liftoff/applied.json` (self-ignored via `.liftoff/.gitignore`, written by `render` only after all writes succeed, stores `files` and `conflicts`); `render` never merges, reports `conflict` + `proposed`, `--overwrite <path>` replaces; marker carries the generator version (`SPEC-agent-render.md` updated). `SPEC.md` and `README.md` updated to match (no `npx`, no lint, check-first scope).

## Next steps

0. **`SPEC-init-flow.md` approved 2026-11-07. `SPEC-plugin-packaging.md` reviewed by Opus, findings applied, approved 2026-11-07. All five module specs are approved; next is `/plan`.** one repo = marketplace + source with the plugin in `plugin/`; one version number (package.json = plugin.json = `installedVersion`); skill named `liftoff-init` (decided); built CLI committed at `plugin/skills/liftoff-init/scripts/liftoff.mjs`; pinning by git tag (`ref: v<version>` in `extraKnownMarketplaces`); skill-scoped `allowed-tools` instead of a committed permission rule. Repo: https://github.com/saugion/liftoff (public); first commit (specs) pushed to `main` on 2026-11-07. The pin is per user (one marketplace checkout per user); tags must be immutable. `SPEC.md` project structure updated.
1. `SPEC-cli.md` approved 2026-11-07 (amended after the init-flow review: `check-config` read failures return a `CheckResult`; new code `agents-md-invalid`). `SPEC-init-flow.md` reviewed by Opus, findings applied, **awaiting final approval**. Decided: v1 Init drops subagents, `implement`, hooks/MCP, CI, wiki, Graphify and folder reorganization; hand-written agent files are folded into `AGENTS.md` (backup in `.liftoff/backup/`, then `--overwrite`); `AGENTS.local.md` is out of v1.
2. Then `SPEC-init-flow.md` (root-`AGENTS.md` rule; `AGENTS.local.md` promise in README is not read by either agent), `SPEC-plugin-packaging.md`. Fresh-context Opus review per spec.
3. Then `/plan` to break v1 into tasks.

## Open questions

- **Host of the published JSON Schema** (`<TBD-host>` in `SPEC-config-schema.md`). Proposed: raw URL at a git tag of the marketplace repo. Needs the repo location.
- Binary/package name and npm scope (`liftoff` may be taken).
- Minimum Node version.
- Test runner (Vitest is the candidate), fixed with the repo scaffold in the `cli` spec.
- Where the "last applied config" record lives (personal, uncommitted): a `cli` decision.
- At scaffold: check that `import Ajv from "ajv"` type-checks under TS `module: NodeNext`.
