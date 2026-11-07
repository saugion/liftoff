# Spec: `cli`

Module 3 of 5 in `SPEC.md`. Depends on `config-schema` and `agent-render`. Status: **review findings applied (2026-11-07), awaiting final approval**.

Reviewed by a fresh-context Opus agent on 2026-11-07; its findings are applied here.

## Objective

The `liftoff` binary and a small library API over it. Skills call it through the shell; it is the only part of LiftOff that touches the disk. v1 commands: `validate`, `check-config`, `render`. Nothing else (adding a command is "Ask first").

- **Pure and local:** no network, no credentials, no `git`, no child processes.
- **Machine-first output:** stdout is always exactly **one JSON document**, also for usage errors, crashes and `--help` (`{ "usage": "…" }`). Stack traces go to stderr only. Skills read the JSON whatever the exit code: exit 1 is a normal state (e.g. `config-missing` on the first Init run), not a crash.
- Every output carries the absolute `root` it worked on.
- Owns the **repo scaffold** (package, build, test runner) and the **applied record**.
- **Shipped inside the plugin as one bundled file** (decided 2026-11-07): `dist/liftoff.mjs`. No npm publish, no `npx`. Skills run `node "<skill-dir>/scripts/liftoff.mjs" <command> --root "<abs-path>"`; the build copies `dist/liftoff.mjs` to `plugin/skills/liftoff-init/scripts/liftoff.mjs` (see `SPEC-plugin-packaging.md`).

## Tech Stack

Verified 2026-11-07 (npm registry, nodejs.org, local Node 24 checks):

- Node **>=22.12** (`engines`). Vitest 5.1 needs `^22.12 || ^24 || >=26`. Node 24 and 26 are LTS.
- TypeScript strict, ESM, `module: NodeNext`. `tsc` is **typecheck only** (`--noEmit`).
- **Build: esbuild** → one ESM file `dist/liftoff.mjs` (`platform=node`, `target=node22`, shebang banner). `yaml`, `ajv` and Ajv's own dependencies are bundled, because a plugin installed from a git marketplace never runs `npm install`. The JSON Schema is imported as a JSON module (`with { type: "json" }`, `resolveJsonModule`) so it is bundled too: **no runtime file reads of the schema** (a small implementation note for `config-schema`'s `schema.ts`). The package version is also imported from `package.json` the same way.
- Dev deps: `typescript`, `vitest` (5.1.x), `esbuild`, `@types/node`. Runtime deps (bundled): `yaml`, `ajv`.
- Arg parsing: `node:util` `parseArgs` (`type: "string", multiple: true` collects repeated `--overwrite`). No CLI framework.
- **No linter in v1**: `tsc --strict` covers it. ESLint is a new dependency set ("Ask first").
- Scaffold smoke test: `import { Ajv } from "ajv"` (the named export; the default import does not type-check under `NodeNext`) type-checks and bundles.

## Commands

All take `--root <dir>`. **Skills always pass `--root` as an absolute path**, resolved by `init-flow` (repo top level). If omitted it defaults to the current directory. `--root` must exist and be a directory, else exit 2 with code `usage`. The config is `<root>/liftoff.yaml`; no upward search. On `config-missing`, the output adds `hint.nearestRoot`: the nearest ancestor containing `liftoff.yaml` or `.git` (a `stat` only, no `git` call), so Init does not start a second config in a subdirectory.

| Command | Does | Exit |
|---|---|---|
| `liftoff validate` | `readConfig`; reports errors or the `configHash`. Ignores the applied record and the plugin pin, because Init calls it in a write-then-validate loop. | 0 valid, 1 invalid or missing |
| `liftoff check-config` | Read-only. Compares the config with the plugin pin and the applied record. | 0 `ok`/`warn`, 1 `blocked` |
| `liftoff render [--overwrite <path>]...` | Applies the config: renders, writes the safe files, reports conflicts, records the applied state. | 0 done (conflicts allowed), 1 fatal |

Exit 2 = usage error (unknown command or flag, flag on the wrong command, bad `--root`) or unexpected crash. `--help` exits 0. `--overwrite` on `validate` or `check-config` is a usage error.

### Error shape (all fatal outputs)

```json
{ "ok": false, "root": "/abs/repo",
  "errors": [{ "code": "config-invalid", "message": "…", "path": "/agents/targets", "line": 4, "col": 3 }] }
```

- `code` is mandatory. `path` is a **JSON pointer** (config problems only), `file` is a **file path relative to root** (file problems). `line`/`col` only for YAML syntax errors.
- Codes: `config-missing`, `config-invalid`, `plugin-outdated`, `render-invalid`, `agents-md-missing`, `agents-md-invalid`, `path-escape`, `write-failed`, `usage`, `internal`. The `check-config` reason codes reuse the same names where they overlap.

### Reading the config, with the plugin pin first

Used by `check-config` and `render`:

1. File absent → `config-missing`.
2. **Lenient read** of `liftoff` and `plugin.version` (the `config-schema` compat read). If `liftoff` is greater than the supported format, **or** `plugin.version` is greater than the installed version → report **only** `plugin-outdated` ("update the plugin"). A newer schema must never surface as unknown-key noise.
3. Otherwise full `readConfig`; failure → `config-invalid`.

Installed plugin version = the CLI's own `package.json` version (build-time import). A test asserts it equals `plugin/.claude-plugin/plugin.json`'s version. Versions compare numerically on `x.y[.z]`, missing patch = 0.

**For `check-config`, these read failures are not the fatal shape.** They come back as a normal `CheckResult`: `status: "blocked"`, `installedVersion` always present, and `reasons[]` with code `config-missing`, `config-invalid` or `plugin-outdated`. A `config-invalid` reason carries `errors: [{ path, message, line?, col? }]`. A `config-missing` result carries `hint.nearestRoot`. `validate` and `render` keep the fatal shape (`ok: false, errors[]`).

### `check-config`

After the read above succeeds:

1. **Pin:** installed older than `plugin.version` → `blocked`, `plugin-outdated`. Stop.
2. **Applied record** (`<root>/.liftoff/applied.json`). Missing, corrupt, or written by a newer `v` → `blocked`, `not-applied`, with its own message for each case. Stop (a fresh clone; Init handles it).
3. **Changes:** compare `sectionHashes(config)` with the stored ones; a section added, removed or changed is a change. It is **required** if the section is in the stored `requiredSections` **or** in `requiredSections(config)`. Each required change → `required-changed` (per section) → `blocked`. Only non-required changes → `optional-changed` → `warn`.
4. **Unresolved conflicts** stored in the record → `unresolved-conflict` (per file) → `warn` at least (never silent: a hand-written `CLAUDE.md` that doesn't import `AGENTS.md` is exactly the drift that matters).
5. Personal setting `warn_on_config_update: false` turns `optional-changed` into `ok`; the suppressed reasons are still returned in `suppressed`. It does not suppress `unresolved-conflict`.
6. All reasons from steps 3-4 are collected, not first-match. Nothing → `ok`.

Because `plugin` is always required, a lead bumping `plugin.version` is a required change for everyone until they re-apply. No personal overrides of default sections in v1 (deferred; `agents.targets` drives committed files).

```json
{ "status": "blocked", "root": "/abs/repo", "installedVersion": "1.3.0",
  "reasons": [{ "code": "plugin-outdated", "message": "…", "minimum": "1.4" }] }
```

### `render` procedure (order matters)

1. `--root` check. Read the config with the plugin-pin-first rule; fatal on `config-missing` / `plugin-outdated` / `config-invalid`. Config changes never block `render` (it resolves them); only `plugin-outdated` does.
2. `renderAgentFiles(config, { generatorVersion })`; `ok: false` → fatal `render-invalid`.
3. **`AGENTS.md` preflight.** Root `AGENTS.md` must exist; with the `claude-code` target every `<module.path>/AGENTS.md` too. Names are matched **case-exactly** via `readdir` (macOS `existsSync` would accept `Agents.md`, which breaks `@AGENTS.md` on Linux). Missing → fatal `agents-md-missing`, all paths listed in `file`. An `AGENTS.md` that is a symlink resolving to a path this render would write (e.g. `AGENTS.md → CLAUDE.md`) → fatal `agents-md-invalid` (`file`): `@AGENTS.md` would import the file into itself.
4. **Containment.** `realpath(--root)` first (on macOS `/var` is `/private/var`). For every path the command will touch (output files, `.liftoff/`, `applied.json`, temp files): take the realpath of its **deepest existing ancestor** and require `path.relative(root, p)` not starting with `..` and not absolute (not `startsWith`: `/repo2` must not pass for `/repo`). Violation → fatal `path-escape`.
5. **`--overwrite` validation.** Each argument is normalized like `RenderedFile.path` (forward slashes, no `./`, relative to root). A path not in the render plan → fatal `usage`, **before anything is written**. On a planned file that is not in conflict it does nothing; it never applies to `skipped-symlink`, `symlink` or `not-regular` entries.
6. **Plan** every file (table below). Nothing is written yet.
7. Ensure `<root>/.liftoff/.gitignore` containing `*` exists (the directory ignores itself; the user's own `.gitignore` is never touched).
8. **Write** the files, atomically: temp file in the same directory with a random name opened `wx` (O_EXCL), then `rename` (retry on Windows `EPERM`/`EBUSY`); create parent directories. A failure → exit 1, `write-failed`, with `files` listing what was already written. **No record is written.** Re-running converges (written files then show `unchanged`/`refreshed`).
9. **Write the applied record** only if every write succeeded and the planned files and conflicts are known (atomic; skipped if byte-identical).
10. **Notices.** (a) any path in the stored `files` that is no longer planned (dropped target, removed module) → `"stale: <path> is no longer generated; left in place"`. (b) With the `copilot` target and a `constraints.file` that doesn't exist → notice.

Plan table. Before comparing or looking for the marker, a BOM is stripped and CRLF is normalized to LF. A refreshed file keeps the file's existing line-ending style.

| State of the target path | Action | Written? |
|---|---|---|
| does not exist | `created` | yes |
| content identical | `unchanged` | no |
| marker present, body hash matches, marker generator version ≤ installed | `refreshed` | yes |
| marker present, body hash matches, marker generator version **newer** than installed | `conflict` (`newer-generator`) | no, unless `--overwrite` |
| no marker, or marker hash mismatch (hand-edited) | `conflict` (`no-marker` / `hand-edited`) | no, unless `--overwrite` |
| a symlink whose realpath equals the sibling `AGENTS.md`'s realpath | `skipped-symlink` | no |
| any other symlink | `conflict` (`symlink`) | **never** |
| a directory or other non-regular file | `conflict` (`not-regular`) | **never** |

`conflict` entries carry `reason` and the full generated content as `proposed`. **The CLI never merges.** Proposing a merge (e.g. prepending `@AGENTS.md` to a hand-written `CLAUDE.md`) and showing the diff is the Init skill's job; `--overwrite` means "replace the whole file".

```json
{ "ok": true, "root": "/abs/repo", "applied": true, "configHash": "sha256:…",
  "files": [{ "path": "CLAUDE.md", "agent": "claude-code", "action": "created" },
            { "path": ".github/copilot-instructions.md", "agent": "copilot", "action": "conflict",
              "reason": "no-marker", "proposed": "<!-- generated by liftoff render 1.4.0; … -->\n…" }],
  "notices": [] }
```

Windows note: with `core.symlinks=false` a symlinked `CLAUDE.md` checks out as a text file containing `AGENTS.md`; it shows up as `conflict` (`no-marker`). Documented, not handled.

## The applied record (personal, uncommitted)

`<root>/.liftoff/applied.json`, written only by `render`. The directory is self-ignored by `.liftoff/.gitignore`. Safe against being committed without touching the user's files.

```json
{ "v": 1, "configHash": "sha256:…", "sectionHashes": { "agents": "sha256:…" },
  "requiredSections": ["constraints", "liftoff", "plugin"],
  "files": ["CLAUDE.md", "src/api/CLAUDE.md", ".github/copilot-instructions.md"],
  "conflicts": [".github/copilot-instructions.md"] }
```

No timestamps, no credentials. `files` = every path the last render planned (replaces a `targets` list: covers dropped targets and removed modules with one rule). `conflicts` = paths left unresolved. Accepted limitation: a newer CLI that changes normalization or defaults changes every section hash, so one spurious `required-changed` is possible after a plugin upgrade; re-running `render` clears it.

Personal setting: `<root>/.liftoff/personal.json`, hand-edited, optional: `{ "warn_on_config_update": false }` (default `true`, name as in the README). An unreadable or invalid file falls back to the default. No command writes it in v1.

## Library API (`src/index.ts`, synchronous: fs sync)

```ts
export { readConfig, validateConfig, sectionHashes, configHash, requiredSections } from "./config/index.js";
export { renderAgentFiles } from "./render/index.js";
export type CheckResult = { status: "ok" | "warn" | "blocked"; root: string; installedVersion: string;
  reasons: Reason[]; suppressed?: Reason[]; hint?: { nearestRoot?: string } };
export type RenderResult = { ok: true; root: string; applied: true; configHash: string;
  files: PlannedFile[]; notices: string[] } | FatalResult;
export function checkConfig(root: string): CheckResult;
export function applyRender(root: string, opts: { overwrite: string[] }): RenderResult;
```

`src/cli/main.ts` only parses args, calls these, prints one JSON document and sets the exit code. Handlers return typed results and never call `process.exit`.

## Project Structure

```
package.json            → bin: liftoff → dist/liftoff.mjs; engines; scripts: build (esbuild), typecheck (tsc --noEmit), test (vitest run)
tsconfig.json           → strict, NodeNext, noEmit, resolveJsonModule
src/index.ts            → library exports
src/cli/main.ts         → parseArgs, dispatch, JSON out, exit codes
src/cli/check.ts        → checkConfig, plugin-pin-first read
src/cli/apply.ts        → applyRender (preflight, containment, plan, write, record)
src/cli/state.ts        → read/write applied.json, personal.json
src/cli/version.ts      → installed version, x.y[.z] compare
test/cli/*.test.ts
test/no-network.ts      → Vitest setup: belt-and-braces runtime patch
test/static-guard.test.ts → scans src/ and dist/liftoff.mjs for forbidden imports
```

## Testing Strategy

Command-level tests run the handlers on a temp directory (`mkdtemp`, root resolved with `realpath`) with fixtures.

- **validate:** valid → ok + hash; invalid and missing → `ok: false`; ignores the record and the pin.
- **check-config:** `config-missing` (+ `hint.nearestRoot`) and `config-invalid` (carries `errors`), both as a `CheckResult` with `installedVersion`; `liftoff: 2` and a newer `plugin.version` with unknown keys → only `plugin-outdated`; installed older than pin; no record, corrupt record and newer-`v` record (`not-applied`, three messages); nothing changed (`ok`); optional change (`warn`); same with `warn_on_config_update: false` (`ok`, `suppressed` filled); required change (`blocked`); a section required only in the *old* config (`blocked`); section added; removed; `plugin.version` bump; unresolved conflict in the record (`warn`); invalid `personal.json` (default). Version compare: `1.4` = `1.4.0`, `1.10` > `1.9`.
- **render:**
  - empty repo + `AGENTS.md` → all `created`; second run → all `unchanged`; `.liftoff/.gitignore` is `*`; user's `.gitignore` untouched.
  - config change (add a module) → affected files `refreshed`, never `conflict`.
  - hand-edited, no-marker, **newer-generator** → `conflict`, not written, `proposed` present; `--overwrite <path>` writes.
  - symlinked `CLAUDE.md` → `skipped-symlink`; other symlink and directory-at-path → `conflict`, `--overwrite` rejected.
  - `--overwrite` with a path outside the plan → `usage`, **nothing written**.
  - missing root or module `AGENTS.md` (also wrong case) → fatal, zero files written, no record.
  - `AGENTS.md` symlinked to a planned output (`AGENTS.md → CLAUDE.md`) → fatal `agents-md-invalid`, nothing written.
  - containment: symlinked parent escaping the root, and `/repo2` vs `/repo` → `path-escape`.
  - CRLF/BOM copy of an unedited file → `unchanged`/`refreshed` (not `conflict`), line endings preserved.
  - **second write fails** (read-only directory): `write-failed`, partial `files`, **no record**; fixing it and re-running converges.
  - record has `requiredSections`, `files`, `conflicts`; written when conflicts remain; not written on any fatal error.
  - dropped target and removed module → `stale` notice, files untouched; missing `constraints.file` with copilot → notice.
- **Exit codes and stdout:** 0 / 1 / 2 as in the table; stdout is one valid JSON document in every case, including usage errors and `--help`.
- **No network / no child process:**
  - *Primary, static:* `test/static-guard.test.ts` scans `src/` and the built `dist/liftoff.mjs`, rejecting imports of `node:net|dns|http|https|http2|tls|dgram|child_process|worker_threads` and any `fetch(`, `WebSocket`, dynamic `import(`.
  - *Belt and braces, runtime:* the Vitest setup patches `net`, `tls`, `dns`, `http(s)` to throw and calls `module.syncBuiltinESMExports()` so named imports are covered.
  - *Binary test:* run the built artifact copied into a directory **with no `node_modules`**, under `node --permission --allow-fs-read=<bundle-dir>,<tmp> --allow-fs-write=<tmp>` with no `--allow-child-process` (proves it is self-contained, spawns nothing, and writes only inside the root). Needs Node ≥24 (`--permission`; on 22.12 the flag is experimental), so this test runs in CI on 24 and is skipped on 22. Node's permission model does **not** cover the network: that guarantee rests on the static guard.
- **Scaffold smoke:** `import { Ajv } from "ajv"` works under `NodeNext`; version in `package.json` equals `plugin/.claude-plugin/plugin.json`.

## Boundaries

- **Always:** validate input at the boundary; write only inside the real root; write atomically; plan everything before writing anything; record state last; keep stdout one JSON document.
- **Ask first:** a new command or flag; a new dependency; changing the JSON output shapes or error codes (skills depend on them); changing the applied-record format.
- **Never:** network access, credentials, child processes, or `git` calls; overwrite a hand-edited file without `--overwrite`; follow or replace a symlink that is not the `CLAUDE.md → AGENTS.md` case; merge into a hand-written file; touch the user's `.gitignore`; write outside `--root`; remove a failing test to get green.

## Success Criteria

- All tests green; `npm run build && npm run typecheck && npm test` pass on Node 22 and 24 (binary test on 24).
- The built artifact runs from a directory with no `node_modules`.
- `check-config` returns `blocked` / `warn` / `ok` correctly for required changes, non-required changes, unresolved conflicts, a newer schema and an older plugin.
- `render` on a repo with a config and `AGENTS.md` produces the golden files for both targets, is idempotent, and leaves no record after a failed write.
- No source import and no spawned process touches the network or runs a child process.

## Open Questions

1. ~~How a skill locates the bundle~~ — settled in `SPEC-plugin-packaging.md`: committed at `plugin/skills/liftoff-init/scripts/liftoff.mjs`, called by absolute path.
2. `agent-render` change: `renderAgentFiles(config, { generatorVersion })` and the marker `<!-- generated by liftoff render <ver>; body-sha256:<hex>; … -->` (applied to `SPEC-agent-render.md`).
3. `config-schema` implementation note: the schema is imported as a JSON module, not read from disk, so it bundles.
4. README says an update "blocks only the commands it affects"; v1 blocks `render` only for `plugin-outdated` and reports required changes per section. That per-section list is the hook for finer blocking later.
5. `init-flow`: always passes absolute `--root`; owns merge proposals for conflicts; reads `hint.nearestRoot`.
