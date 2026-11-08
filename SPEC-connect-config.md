# Spec: `connect-config`

Module 1 of 4 in `SPEC-connect.md`. Depends on `config-schema` (v1). Status: **review findings applied (2026-11-07), awaiting final approval**.

Reviewed by a fresh-context Opus agent on 2026-11-07, who also prototyped the schema against the repo's Ajv; its findings are applied here.

## Objective

Give the two sections that v1 reserved and forced empty, `tracker` and `codeHost`, a real shape, so that what Connect learns (where the tracker and the code host are, how tickets are read, written and moved, how branches and merge requests look) lives in the committed team config and is validated, normalized and hashed like everything else.

Everything else in LiftOff reads these sections through this module (`connect-wiring` turns them into commands, the lead flow writes them, Plan/Build/Close will read them later). Nobody parses them by hand.

The model is a **connector**: each section holds one connector, chosen by `kind`. This release defines `jira-dc` (tracker) and `gitlab` (code host); a new connector later is a new `kind` and a new `then` branch in the schema, not a rework.

## Tech Stack

Unchanged from `config-schema`: `yaml`, Ajv (draft-07, strict, `import { Ajv } from "ajv"`), the schema bundled as a JSON module. One schema file, `schema/liftoff.schema.json`, grows two definitions.

## Config shape

```yaml
liftoff: 1
plugin:
  version: "0.2"             # >= 0.2 whenever tracker or codeHost is used (checked in code)
project: { name: acme-billing, kind: existing }
agents: { targets: [claude-code, copilot] }
tracker:
  kind: jira-dc
  url: https://jira.company.local        # the instance; a context path is fine (https://host/jira)
  project: PROJ                          # the REAL Jira project key (see "Rules")
  server:                                # the MCP server that reaches it
    version: "0.23.1"                    # exact, >= 0.22.0; the package is implied by `kind`
    sslVerify: true                      # default true
    readOnly: false                      # default false: true hides every write tool
  issueTypes:                            # filled by the lead flow, one entry per type the team uses
    - name: Story
      branchType: feature                # what {type} means in branchPattern for this issue type
      readingMap:
        acceptanceCriteria: { heading: "Acceptance criteria" }   # or { field: customfield_10201 }
        fields:
          - { id: customfield_10016, label: Story points }
      template: |                        # the description skeleton used to create this type
        ## Context
        ## Acceptance criteria
      createFields:                      # extra fields the workflow requires on create (learned from errors)
        customfield_10400: { value: Team A }
      transitions:                       # what this type's workflow calls each role, and the fields it demands
        start: { name: Start progress }
        review: { name: Ready for review }
        done: { name: Done, fields: { resolution: { name: Fixed } } }
codeHost:
  kind: gitlab
  host: gitlab.company.local             # hostname[:port], no scheme
  conventions:
    targetBranch: main
    branchPattern: "{type}/{key}-{slug}"
    titlePattern: "{key}: {summary}"
    mrTemplate: .gitlab/merge_request_templates/Default.md
    labels: [backend]
    reviewers: [alice, bob]
```

`tracker: {}` and `codeHost: {}` stay valid and mean "no connector", exactly as in v1.

### Fields

| Path | Type | Rules | Presence | Default |
|---|---|---|---|---|
| `tracker`, `codeHost` | mapping | `{}` (no connector) or a connector with `kind`. **No `required` flag in this release** (v1's rule stays: it is an unknown key here). | optional | absent |
| `tracker.kind` | string | enum `jira-dc` | mandatory if non-empty | — |
| `tracker.url` | string | `https://`; host = labels of `[A-Za-z0-9_-]` separated by single dots, no leading or trailing `-` or `.`; optional `:port` 1-65535; optional path of `[A-Za-z0-9._~/-]`; no userinfo, query, fragment, whitespace, quote, or IPv6 literal | mandatory | — (host lowercased and trailing `/` dropped on normalization) |
| `tracker.project` | string | `^[A-Z][A-Z0-9_]{1,19}$` | mandatory | — |
| `tracker.server.version` | string | exact `^\d+\.\d+\.\d+$` (no ranges, no `latest`) and **>= `MIN_JIRA_SERVER_VERSION` (0.22.0)**, checked in code: `jira_get_field_options`, `jira_get_project_issue_types` and `jira_get_create_fields`, which the lead flow needs, do not exist in earlier versions | mandatory | — |
| `tracker.server.sslVerify` | boolean | | optional | `true` |
| `tracker.server.readOnly` | boolean | | optional | `false` |
| `tracker.issueTypes` | list | | optional | `[]` |
| `...issueTypes[].name` | string | 1-80 chars, no control characters; unique across items, **compared case-insensitively** (in code) | mandatory in item | — |
| `...branchType` | string | `^[a-z0-9._-]+$`; what `{type}` becomes in `branchPattern` (Story to `feature`, Bug to `bugfix`): issue type names like "New Feature" or "Sub-task" are not usable in a branch name | optional | absent |
| `...readingMap.acceptanceCriteria` | mapping | exactly one of `{ heading: <1-80 chars> }` or `{ field: <^[A-Za-z0-9_]+$> }` (a custom message names both options) | optional | absent |
| `...readingMap.fields[]` | mapping | `{ id: ^[A-Za-z0-9_]+$, label: 1-80 chars }`; `id` unique within the type (in code) | optional | `[]` |
| `...template` | string | at most 8000 characters | optional | absent |
| `...createFields` | mapping | keys `^[A-Za-z0-9_]+$`, values any JSON | optional | `{}` |
| `...transitions.start`, `.review`, `.done` | mapping | `{ name: <1-80 chars>, fields?: <mapping, keys ^[A-Za-z0-9_]+$, values any JSON> }` (`fields` are what the transition screen requires, typically `resolution` on Done); a bare string is an error | each optional | absent |
| `codeHost.kind` | string | enum `gitlab` | mandatory if non-empty | — |
| `codeHost.host` | string | the host rules of `tracker.url` plus optional `:port`; no scheme, no path | mandatory | — (lowercased) |
| `codeHost.conventions.targetBranch` | string | git ref name: `^[A-Za-z0-9._/-]+$`, not starting with `-` or `/`, no `..`, no `.lock` suffix | optional | absent (the repo's default branch) |
| `codeHost.conventions.branchPattern` | string | 1-120 chars; placeholders only `{key}`, `{slug}`, `{type}` (in code) | optional | absent |
| `codeHost.conventions.titlePattern` | string | 1-200 chars; placeholders only `{key}`, `{summary}`, `{type}` (in code) | optional | absent |
| `codeHost.conventions.mrTemplate` | string | the `relativePath` rule of v1 (relative, no `..`) | optional | absent |
| `codeHost.conventions.labels` | string[] | each 1-80 chars, no comma or line break | optional | `[]` |
| `codeHost.conventions.reviewers` | string[] | each `^[A-Za-z0-9_.-]+$` | optional | `[]` |

### Rules

- **Shell safety.** The identifiers that end up inside commands a skill runs (`url`, `host`, `project`, `server.version`, `targetBranch`, reviewer names) are restricted by pattern so no shell metacharacter, quote, space or `$` can pass. Every other value that ever reaches a command (labels, titles, free text) does so **only inside a string built by the CLI and quoted by `shQuote`**, never assembled by a skill. (Plan/Build will also need JQL quoting for `issueTypes[].name`.)
- **A non-empty connector section needs a pinned plugin.** If `tracker` or `codeHost` is non-empty, `plugin.version` must be >= `0.2` (`MIN_CONNECT_PLUGIN`), else an error at `/plugin/version`. The comparison uses `compareVersions`, which **moves from `src/cli/version.ts` to `src/config/`** so the config module never imports from the CLI.
- **What an old install sees.** A config that uses a connector and pins `plugin.version: "0.2"` read by a `0.1.x` install is `plugin-outdated` (pin-first read in `check-config` and `render`; `validate` skips the pin by design). A connector config that wrongly pins `"0.1"` is rejected by the new validator at `/plugin/version`; a `0.1.x` install reading it reports `config-invalid`.
- **`tracker.project` is always the real project.** Test tickets created in another project during onboarding are transient and never stored; the lead flow warns that required fields and workflows may differ between projects.
- **Additive, not a format change.** `liftoff: 1` stays. A config valid in v1 is valid now and normalizes to the same value: the hash of every v1 section, including `tracker: {}` and `codeHost: {}`, does not change.
- **Normalization** (only for a non-empty section, so `{}` stays `{}`): `url` and `host` lowercased host part and no trailing `/`; `server.sslVerify: true`, `server.readOnly: false`; `issueTypes: []`; in each issue type `readingMap: { fields: [] }`, `createFields: {}`, `transitions: {}`; `conventions: { labels: [], reviewers: [] }`. Absent optional scalars stay absent.
- **No credential field exists.** There is no place for a token, user name, password or key; the v1 secret guard (keys `token`, `password`, `auth`, ... and token-looking values) keeps running on both sections, including the free-form `createFields`. A secret-looking key's schema error and the guard's error land on the same pointer and are deduplicated, as in v1.
- `additionalProperties: false` everywhere except `createFields` and `fields` values.
- **Deferred, written down:** the README's "comment conventions" per issue type, and a company-pinned *package* or mirror for the MCP server (only the version is pinned now); several Jira projects per tracker; a `mode` for GitLab (cli is the only one, so no field); a `textFormat` (the community server converts Markdown on write, so there is nothing to choose); the `required` flag on connector sections (it would need a teammate path that points to Connect, not to Init). All are additive later.

## Public API (`src/config/`)

```ts
export type IssueType = { name: string; branchType?: string; readingMap: { acceptanceCriteria?: { heading: string } | { field: string }; fields: { id: string; label: string }[] };
  template?: string; createFields: Record<string, unknown>; transitions: { start?: Transition; review?: Transition; done?: Transition } };
export type Transition = { name: string; fields?: Record<string, unknown> };
export type TrackerConfig = { kind: "jira-dc"; url: string; project: string;
  server: { version: string; sslVerify: boolean; readOnly: boolean }; issueTypes: IssueType[] };
export type CodeHostConfig = { kind: "gitlab"; host: string;
  conventions: { targetBranch?: string; branchPattern?: string; titlePattern?: string; mrTemplate?: string; labels: string[]; reviewers: string[] } };
// Config.tracker / Config.codeHost: `Record<string, never> | TrackerConfig` (resp. CodeHostConfig), still optional.
// `{}` would not narrow in TypeScript (it matches anything): `connectors()` is the only accessor.

export function connectors(config: Config): { tracker?: TrackerConfig; codeHost?: CodeHostConfig }; // only the non-empty ones
export const MIN_CONNECT_PLUGIN = "0.2";
export const MIN_JIRA_SERVER_VERSION = "0.22.0";
export function compareVersions(a: string, b: string): number | undefined;   // moved here from src/cli/version.ts
```

`readConfig`, `validateConfig`, `sectionHashes`, `configHash`, `requiredSections` keep their signatures. `validate` accepts connector sections and its output is unchanged.

## Project Structure

```
schema/liftoff.schema.json          → definitions for tracker (if kind jira-dc) and codeHost (if kind gitlab)
src/config/connectors.ts            → the types, `connectors()`, normalization of the two sections, the in-code checks
src/config/version.ts               → compareVersions / parseVersion (moved from src/cli/version.ts, which re-exports them)
src/config/schema.ts                → the error mapper gains the filter described below
src/config/types.ts, hash.ts, read.ts → widened Config, normalize() calls the connector normalization, validateConfig runs the checks and the pin rule
test/config/connectors.test.ts
test/fixtures/config/valid/connect-*.yaml, invalid/connect-*.yaml          (each invalid one with `# expect: <json-pointer>`)
```

**Schema shape (prototyped and verified under Ajv strict).** Each branch declares its own property stubs, or `strictRequired` fails the compile:

```json
"tracker": {
  "type": "object",
  "anyOf": [ { "maxProperties": 0 }, { "required": ["kind"], "properties": { "kind": true } } ],
  "properties": { "kind": { "enum": ["jira-dc"] }, "url": { }, "project": { }, "server": { }, "issueTypes": { } },
  "additionalProperties": false,
  "if": { "properties": { "kind": { "const": "jira-dc" } }, "required": ["kind"] },
  "then": { "required": ["url", "project", "server"], "properties": { "url": true, "project": true, "server": true } }
}
```

**Error mapper (new code, `src/config/schema.ts`).** Ajv reports `anyOf`, `if` and `propertyNames` wrapper errors that bury the real one. The mapper drops: errors with `keyword` `"if"` or `"anyOf"`, errors whose `schemaPath` contains `/anyOf/0/`, and the inner `pattern` error Ajv emits under `propertyNames`; and it appends `params.propertyName` to the pointer. Result (verified): a missing `kind` is exactly `/tracker/kind`, a missing `url` exactly `/tracker/url`, an unknown key `/tracker/foo`, a bad `createFields` key `/…/createFields/api-key`, a bare-string transition `/…/transitions/done`.

## Code Style

As in v1: pure functions, `Result` at the boundary, no throw for bad input.

```ts
// The in-code checks Ajv cannot express, each pointing at the offender.
function connectorErrors(raw: RawConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  const seen = new Map<string, number>();
  (raw.tracker?.issueTypes ?? []).forEach((t, i) => {
    const key = t.name.toLowerCase();          // Jira treats type names case-insensitively
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i);
    else errors.push({ path: `/tracker/issueTypes/${i}/name`, message: `duplicate issue type '${t.name}' (first at /tracker/issueTypes/${first}/name)` });
  });
  return errors;
}
```

## Testing Strategy

Unit tests and fixtures, no network. Every invalid fixture starts with `# expect: <json-pointer>` and the test asserts that exact pointer appears.

- **First task, before touching `hash.ts`:** record the v1 `sectionHashes` and `configHash` of every existing valid fixture with the current code and store them as goldens (today no test stores them). The compatibility test then compares against them.
- **Valid:** a tracker only; a code host only; both with every optional field; both minimal; `tracker: {}` and `codeHost: {}` as in v1; `url` with a context path and a port; `host` with a port and an underscore; an issue type with `branchType`; a `done` transition with `fields`.
- **Invalid, one fixture each:** unknown and missing `kind` (pointer `/tracker/kind`, no `anyOf` noise); `required` on `tracker` and on `codeHost` (unknown key); `url` with `http://`, userinfo, query, fragment, a space, a quote, `$`, `;`, a backtick, an IPv6 literal, a leading `-`, an empty label, port `0` and `65536`; `project` in lower case or with a dash; `server.version` as `latest`, `^1.2`, `1.2`, and `0.11.9` (below the minimum, pointer `/tracker/server/version`); `server` without `version`; `host` with a scheme, a path, `;`, a space; duplicate issue-type name, including different case; `branchType` with a space or upper case; `acceptanceCriteria` with both and with neither; an unknown key in an issue type; duplicate `readingMap.fields` id; an empty transition `name`, a transition as a bare string, `fields` that is not a mapping; a placeholder outside the allowed set in `branchPattern` and in `titlePattern` (`{slug}` is not allowed in a title); `mrTemplate` absolute and with `..`; `targetBranch` with `..`, a leading `-` or `/`, `.lock`, a space; `reviewers` with a space; **`plugin.version: "0.1"` with a non-empty tracker** (pointer `/plugin/version`) and with a non-empty codeHost; a `token` key inside `tracker`; a `ghp_...` value inside `createFields` and inside `template`.
- **Compatibility:** every v1 fixture keeps its recorded hashes; `tracker: {}` stays `{}`; the v1 fixture `invalid/non-empty-tracker.yaml` now expects `/tracker/kind` (see "Amendments").
- **Normalization:** each default; host case and a trailing `/` hash alike; omitted vs explicit defaults hash the same; absent scalars stay absent.
- **Shell safety, as a table:** for each shell-bound field (`url`, `host`, `project`, `server.version`, `targetBranch`, a reviewer) and each of `` ` ' " $ ; & | < > \ ( ) { } * ? ! # `` and whitespace (with `~` allowed in a URL path), a value containing it is rejected.
- **Old install:** a `tracker` config pinned `"0.2"` read by the current (0.1.x) code gives `plugin-outdated` from `check-config` and `render`.
- **Public API:** `connectors()` returns only non-empty sections; `compareVersions` is exported from `src/config` and from `src/cli/version.ts`.
- LF/CRLF copies of every new fixture give the same result.

## Amendments to approved v1 specs

Listed so they are approved on purpose: `test/fixtures/config/invalid/non-empty-tracker.yaml` now expects `/tracker/kind` (a non-empty section without `kind`); `SPEC-config-schema.md` rows for `tracker` and `codeHost` ("`maxProperties: 0` in v1", "non-empty `tracker`" in the invalid-fixture list) are superseded by this spec; `SPEC-cli.md` is unaffected except for `compareVersions` moving.

## Boundaries

- **Always:** validate before returning a value; keep every shell-bound field pattern-restricted; keep the v1 hashes stable; keep the schema file and the types in sync.
- **Ask first:** a new `kind` (a schema change); a new field that a shell command will use; relaxing a pattern; any credential-like field; adding the `required` flag to a connector section.
- **Never:** add a field that can hold a secret; accept `http://` for the tracker; read or store credentials; make a network call; change the hash of an existing v1 section; import from `src/cli` inside `src/config`.

## Success Criteria

- All fixtures behave as listed; `npm test` green for `test/config`.
- The v1 fixtures keep their recorded hashes.
- A config with a tracker and `plugin.version: "0.1"` is rejected at `/plugin/version`; a tracker config pinned `"0.2"` under a `0.1.x` install is `plugin-outdated` in `check-config` and `render`.
- No value accepted for a shell-bound field contains a shell metacharacter.
- A missing or unknown `kind` gives exactly one clean pointer.

## Open Questions

1. **Issue type names may be localized** per user in Jira DC; an optional `id` could be added later (additive).
2. **Several Jira projects** per tracker: `projects[]` later; `project` stays the default.
3. **Teammate sequence** after a lead adds a connector is in `SPEC-connect.md` (update the plugin, rerun Init, run Connect).
