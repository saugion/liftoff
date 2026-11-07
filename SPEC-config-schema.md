# Spec: `config-schema`

Module 1 of 5 in `SPEC.md`. No dependencies. Everything else reads the team config through this module.

Validated by a fresh-context Opus review on 2026-10-05; its findings are applied here.

## Objective

Define `liftoff.yaml` and give the rest of LiftOff one safe way to **read, validate and fingerprint** it. Teammates and agents never parse the YAML by hand.

v1 has **no writer**. The Init skill writes `liftoff.yaml` itself and then runs `liftoff validate` until it passes; a lead edits by hand afterwards. A writer API (`write-config`, comment-preserving update) is added when a real caller needs it.

Consumers: `agent-render` (reads), `cli` (`validate`, `check-config`, `render`), `init-flow` (via `liftoff validate`).

## Tech Stack

Verified against current docs (context7, 2026-10-05):

- **`yaml`** (eemeli/yaml). Use `parseDocument()`: one document only (more than one is an error), duplicate keys are an error by default (`uniqueKeys`), syntax problems land in `doc.errors` with `linePos`. `doc.toJS()` gives the value. Check `doc.errors` before using the value.
- **Ajv** v8, default export, JSON Schema **draft-07**. Options: `allErrors: true`, `strict: true`. Strict mode never rejects unknown keys in the *data*; the schema does that with `additionalProperties: false`. If the schema ever uses `format`, `ajv-formats` becomes a new dependency ("Ask first").
- Checked at scaffold time (T1, 2026-11-07): under TS `module: NodeNext` the default `import Ajv from "ajv"` does **not** type-check ("not constructable"). Use the named export, `import { Ajv } from "ajv"`: it type-checks, runs, and bundles with esbuild.
- Node LTS, ESM, TypeScript. Test runner (Vitest) is fixed in the `cli` spec with the repo scaffold.

## Config shape (v1)

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/saugion/liftoff/v0.1.0/schema/liftoff.schema.json
liftoff: 1                 # config format version
plugin:
  required: true           # optional on plugin; if present it must be true
  version: "1.4"           # minimum plugin version; MUST be a quoted string
project:
  name: acme-billing
  kind: new                # new | existing
agents:
  targets: [claude-code, copilot]    # default section: a teammate may override
stack:
  languages: [typescript]
  frameworks: [nestjs]
modules:
  items:
    - id: api
      path: src/api
      description: HTTP layer
constraints:
  required: true
  file: CONSTRAINTS.md
tracker: {}                # reserved for roadmap item 2, must be empty in v1
codeHost: {}               # same
```

### Fields

| Path | Type | Rules | Presence | Default |
|---|---|---|---|---|
| `liftoff` | integer | `const: 1` | mandatory | — |
| `plugin` | mapping | | mandatory | — |
| `plugin.version` | string | `^\d+\.\d+(\.\d+)?$` | mandatory | — |
| `plugin.required` | boolean | `const: true` | optional | `true` |
| `project` | mapping | | mandatory | — |
| `project.name` | string | non-empty | mandatory | — |
| `project.kind` | string | enum `new`, `existing` | mandatory | — |
| `agents` | mapping | | mandatory | — |
| `agents.targets` | string[] | enum `claude-code`, `copilot`; `minItems: 1`; `uniqueItems` | mandatory | — |
| `stack` | mapping | | optional | `{}` |
| `stack.languages`, `stack.frameworks` | string[] | non-empty strings | optional | `[]` |
| `modules` | mapping | | optional | `{}` |
| `modules.items[].id` | string | kebab-case, unique across items (**checked in code**, draft-07 can't) | mandatory in item | — |
| `modules.items[].path` | string | non-empty, relative, no `..` | mandatory in item | — |
| `modules.items[].description` | string | | optional | — |
| `constraints` | mapping | | optional | `{}` |
| `constraints.file` | string | relative path | optional | `CONSTRAINTS.md` |
| `tracker`, `codeHost` | mapping | `maxProperties: 0` in v1 (roadmap 2 defines them) | optional | — |
| `<section>.required` | boolean | on every section except `liftoff`, `plugin`, `tracker`, `codeHost` | optional | `false` |

### Rules

- Every top-level section except `liftoff` is a mapping. List data sits under a named key (`targets`, `items`).
- *required* = always enforced, *default* = overridable. Granularity is the whole section. **This module only exposes the flag**; how a teammate overrides a default section is owned by `cli` / `init-flow`.
- `additionalProperties: false` on the root and on every defined section. Typos fail, at any level.
- Credentials are banned everywhere (see Secret guard).
- A **normalized config** is the parsed value with the defaults above applied. Hashes use it.
- Read as UTF-8; a BOM is stripped; CRLF is accepted. Nothing is written in v1, so line endings are not an issue yet.

## Public API (`src/config/`)

```ts
export type Result<T> = { ok: true; value: T } | { ok: false; errors: ConfigError[] };
export interface ConfigError {
  path: string;      // JSON pointer, e.g. /agents/targets/0; "" for syntax errors and root problems
  message: string;
  line?: number;     // YAML syntax errors only (from linePos)
  col?: number;
}

export function readConfig(file: string): Result<Config>;   // read + compat check + parse + validate; value is normalized
export function validateConfig(raw: unknown): Result<Config>;

export function sectionHashes(config: Config): Record<string, string>;  // every present top-level section, liftoff included
export function configHash(config: Config): string;                     // hash of the canonical sectionHashes object
export function requiredSections(config: Config): string[];             // sections with required: true, plus liftoff and plugin
```

**Error paths.** Ajv reports missing/extra properties on the parent. `path = instancePath + "/" + (params.missingProperty ?? params.additionalProperty)` when present.

**Compat check (runs before schema validation).** `readConfig` first reads `liftoff` and `plugin.version` leniently. If `liftoff` is greater than the supported format, return one error: "config format N needs a newer LiftOff, update the plugin", and do not report unknown-key noise. The comparison of `plugin.version` with the *installed* plugin belongs to `cli check-config`.

**Hashing.**
- Canonical form: `JSON.stringify` of the normalized value with keys sorted recursively, no whitespace.
- Digest: SHA-256, lowercase hex, prefixed `sha256:`.
- `sectionHashes` hashes each present section (the `liftoff` scalar too). An absent section has no key. `required` is part of its section's hash.
- `configHash` = hash of the canonical `sectionHashes` object.
- Because hashes use the normalized value, an omitted `required` and `required: false` hash the same, and comments, whitespace and key order never matter.
- **Classification (for `cli`):** a changed, added or removed section is a *required change* if it is required in the **old or the new** config. So the "last applied" record must store `requiredSections` as well as the hashes.

**Secret guard (in code, not in the schema).** Runs on the parsed value:
- Keys, anywhere in the document: normalize (lowercase, strip `_` and `-`) and reject exact matches of `token`, `password`, `passwd`, `secret`, `apikey`, `privatekey`, `auth`, `pat`. Exact match, not substring: `tokenizer` and `authorEmail` pass.
- String values: reject URLs with a password (`https://user:pass@host`; `ssh://git@host` passes) and known token prefixes followed by token-like characters (T3, 2026-11-07): `ghp_`, `github_pat_`, `glpat-`, `lin_api_` plus at least 8 more `[A-Za-z0-9_-]`, and Slack `xox[abeprs]-` with a digit in the rest. A bare `xox` prefix would flag names like `xoxo-app`; a bare `ghp_` in prose passes.
- A secret-looking key is also an unknown key for the schema: only the secret message is reported for that path.
- This is a guard against accidents, not a guarantee. Say so in the error text.

## Project Structure

```
src/config/types.ts       → Config, ConfigError, Result
src/config/schema.ts      → loads schema/liftoff.schema.json, compiles Ajv once, maps Ajv errors to ConfigError
src/config/read.ts        → readConfig, validateConfig, compat check, unique-id check
src/config/secrets.ts     → secret guard
src/config/hash.ts        → normalize, canonicalize, sectionHashes, configHash, requiredSections
schema/liftoff.schema.json
test/config/*.test.ts
test/fixtures/config/valid/*.yaml
test/fixtures/config/invalid/*.yaml
```

## Code Style

As in `SPEC.md`: pure functions, `Result` at the boundary, no throw for expected failures (bad YAML, bad schema, missing file, unreadable file all return `ok: false`).

## Testing Strategy

Unit tests, fixture-based, no network. **Each invalid fixture starts with `# expect: <json-pointer>`** and the test asserts that exact path appears in the errors, so a fixture can't fail for the wrong reason.

- Valid: minimal (mandatory only), full, with `required` flags, with empty `tracker`/`codeHost`.
- Invalid, one fixture each: YAML syntax error; duplicate key; two documents; empty file; scalar root; list root; unknown top-level key; unknown key inside a section; wrong type; `required` non-boolean; `plugin.required: false`; section not a mapping; unquoted `plugin.version`; missing `liftoff`; missing `plugin`; missing `project`/`agents`; empty `agents.targets`; duplicate module `id`; non-empty `tracker`; secret-looking key; secret-looking value; `liftoff: 2` (must give the "update the plugin" error, nothing else).
- False positives that must **pass**: keys `tokenizer`, `authorEmail`.
- Hash: same value in a differently formatted/commented file → same `configHash`; omitted `required` vs `required: false` → same hash; changing one value changes only that section's hash and `configHash`; flipping `required` changes that section's hash.
- `requiredSections` returns flagged sections plus `liftoff` and `plugin`.
- Test with LF and CRLF copies of one fixture: same result.

## Boundaries

- **Always:** validate before returning a value; return `ok: false` instead of throwing for bad input; keep the schema file and the types in sync (a test compares them on the fixtures).
- **Ask first:** a breaking change to the schema (bump `liftoff:`); a new top-level section; a new dependency (including `ajv-formats`); adding a writer API.
- **Never:** read or store credentials; make a network call; put `required` below the top-level sections in v1; write the config file from this module.

## Success Criteria

- All fixtures behave as listed; `npm test` green for `test/config`.
- `liftoff: 2` yields exactly one error telling the user to update the plugin.
- `configHash` is identical for two files that differ only in comments, whitespace, key order or an explicit default.
- After the first release tag, the schema is served at a versioned HTTPS URL (`https://raw.githubusercontent.com/saugion/liftoff/v<version>/schema/liftoff.schema.json`) and the `$schema` modeline resolves to it. VS Code shows autocomplete and errors with the Red Hat YAML extension installed (prerequisite).

## Open Questions

1. ~~Host of the published schema~~ — settled 2026-11-07: raw URL at a release tag of `saugion/liftoff` (public), versioned with the plugin.
2. Where the "last applied" record lives (personal, uncommitted) is a `cli` decision, but it must store `requiredSections` too.
3. `stack` and `modules` are the minimum Init needs; `init-flow` may add fields, which is a schema change under "Ask first".
4. If the Init skill's write-then-validate loop proves flaky in the pilot, add a `liftoff write-config` command (JSON in, valid YAML out) — a `SPEC.md` change.
