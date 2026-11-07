# Spec: `agent-render`

Module 2 of 5 in `SPEC.md`. Depends on `config-schema`. Status: **review findings applied (2026-11-07), awaiting final approval**.

Reviewed by a fresh-context Opus agent on 2026-11-07; its findings are applied here.

## Objective

From the validated team config, produce the **minimum per-agent files** each chosen agent needs, so one `liftoff.yaml` gives correct setup in Claude Code and GitHub Copilot. `AGENTS.md` (root and per module, written by Init) stays the only place with instructions. Per-agent files only point to it.

Render is **config-only**: it never reads `AGENTS.md`, it references it. Checking that the referenced files exist belongs to `cli`.

Consumers: `cli` (`liftoff render`), indirectly `init-flow`.

## What each agent reads (verified against current docs, 2026-11-07)

| Agent / surface | Reads | Notes |
|---|---|---|
| Claude Code | `CLAUDE.md`. Reads `AGENTS.md` directly **only if** no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists in the working dir or above (v2.1.277+). | `~/.claude/CLAUDE.md` and `.claude/rules/` don't count. A teammate's `CLAUDE.local.md` silently switches `AGENTS.md` off. A subdirectory `AGENTS.md` is lazy-loaded **only** when no `CLAUDE.md` counts, so with a root `CLAUDE.md` module `AGENTS.md` files are ignored unless a `CLAUDE.md` next to them imports them. The `claude-md-and-agents-md` setting is personal only, a project can't set it. |
| Copilot cloud agent, Copilot CLI | `AGENTS.md` anywhere (nearest wins), `.github/copilot-instructions.md`, `.github/instructions/**`, root `CLAUDE.md`. | |
| Copilot code review | `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/**`. **Not** `CLAUDE.md`. | |
| Copilot in VS Code (chat / agent mode) | Root `AGENTS.md` (`chat.useAgentsMdFile`, default `true`); `.github/copilot-instructions.md` (`github.copilot.chat.codeGeneration.useInstructionFiles`, default `true`). | **Nested** `AGENTS.md`: `chat.useNestedAgentsMdFiles` is experimental, default `false`, on-demand only. `chat.useClaudeMdFile` defaults `true` in VS Code settings docs while the GitHub matrix says no: docs disagree, so assume `CLAUDE.md` may reach Copilot. |
| GitHub.com Chat, Visual Studio, JetBrains, Eclipse, VS Code code review | `.github/copilot-instructions.md` only. | Best-effort: the pointer text is all they get. |

**Supported surfaces in v1:** Claude Code, Copilot in VS Code (chat/agent), Copilot CLI, Copilot cloud agent. Everything else is best-effort.

## Decisions

1. **`AGENTS.md` is the source and is never written by render.** Init (skill) writes it.
2. **Claude Code target → `CLAUDE.md` in the root, and `<module.path>/CLAUDE.md` for every `modules.items[]`.** Each is the marker plus `@AGENTS.md` and **nothing else**. Always rendered, even though Claude can read `AGENTS.md` alone, because that default breaks as soon as a `CLAUDE.md`/`CLAUDE.local.md` exists above, and because module `AGENTS.md` files are otherwise ignored.
3. **No agent-specific content in `CLAUDE.md`.** Copilot cloud agent/CLI (and maybe VS Code) read it too. It is harmless to Copilot *only while it holds no Claude-only rules*.
4. **Copilot target → `.github/copilot-instructions.md`**: marker, a short pointer ("Project instructions are in `AGENTS.md`; follow it and `<constraints.file>`"), and the `constraints.file` path. No stack, no module list, no rules: they live in `AGENTS.md`, copies would drift.
5. **Module rules in VS Code Copilot (v1 answer: accept the limit).** Nested `AGENTS.md` isn't loaded by default there. `init-flow` must keep rules that matter for every task in the **root** `AGENTS.md`, and treat module `AGENTS.md` as best-effort for VS Code. Not shipping `.vscode/settings.json` in v1 (new file to merge, experimental setting). Revisit when the setting leaves experimental.
6. **No per-module Copilot file and no `.github/instructions/*.instructions.md` in v1.**
7. **Targets** come from `agents.targets`. A file for a target that is not selected is never created and never deleted. When a target is dropped from the config, its files go stale: `cli render` prints a one-line notice.

## Public API (`src/render/`)

```ts
type Agent = Config["agents"]["targets"][number];   // "claude-code" | "copilot", from config-schema

export interface RenderedFile {
  path: string;     // relative to repo root, forward slashes, normalized
  content: string;  // LF, ends with a single "\n"; first line is the marker
  agent: Agent;
}

// input: the normalized config returned by readConfig. Pure: no I/O, no network.
// generatorVersion = the installed plugin/CLI version, written into the marker.
export function renderAgentFiles(config: Config, opts: { generatorVersion: string }): Result<RenderedFile[]>;
```

- **Failure modes (`ok: false`, `ConfigError` with `path: /modules/items/N/path`):** a module path that normalizes to the repo root (`.`, `./`, empty after normalization), or two modules that normalize to the same path. Paths are normalized first (strip `./` prefix and trailing slashes, collapse `//`).
- Output sorted by `path`, deterministic: no timestamps, no machine data.
- **Marker** (first line of every generated file):
  `<!-- generated by liftoff render <generatorVersion>; body-sha256:<hex>; edit AGENTS.md instead -->`
  The hash is SHA-256 (lowercase hex) of the **body** = everything after the marker line, CRLF normalized to LF. The renderer computes it, so it stays pure.
  - *Unedited* = marker present and the current body hash equals the hash in the marker. `cli` may overwrite it freely (the content may differ from the new render: that is a config change, not a hand edit), **unless the marker's generator version is newer than the installed one**: then it is a conflict (`newer-generator`), so teammates on different plugin versions don't flip each other's committed files.
  - *Hand-edited* = no marker, or hash mismatch. `cli` shows the diff first (SPEC.md "Never").

## Existing files (render stays pure; `cli` reports conflicts and never merges, `init-flow` proposes the merge and shows the diff; see `SPEC-cli.md`)

| Situation | Behavior |
|---|---|
| `CLAUDE.md` (root or module) without marker | Never replace silently. `init-flow` folds its content into `AGENTS.md` (a module file into that module's `AGENTS.md`) with approval and a backup, then `render --overwrite <path>`. If declined, the file stays and `check-config` warns. |
| `.github/copilot-instructions.md` without marker | Same: fold into the root `AGENTS.md`, then `--overwrite`. |
| `CLAUDE.md` is a symlink to `AGENTS.md` | Leave alone. It already works. |
| Marker present, hash mismatch | Hand-edited: show the diff. |
| Marker present, generator version newer than installed | Conflict (`newer-generator`): don't refresh; update the plugin. |
| Referenced `AGENTS.md` (root or module path) missing | `cli render` fails with a clear error: `@AGENTS.md` would import nothing. |

## Project Structure

```
src/render/index.ts       → renderAgentFiles, path normalization, collision check
src/render/marker.ts      → marker build + body hash
src/render/claude.ts      → CLAUDE.md template (root and module)
src/render/copilot.ts     → .github/copilot-instructions.md template
test/render/*.test.ts
test/fixtures/render/<case>/liftoff.yaml + expected/<files>   (golden)
```

Templates are plain template literals. No templating library.

## Testing Strategy

Golden-file tests, one config → expected files:
- targets `[claude-code]` → root `CLAUDE.md` + one `CLAUDE.md` per module; no Copilot file.
- targets `[copilot]` → only `.github/copilot-instructions.md`.
- both → all of them, sorted.
- Config with no modules → only the root `CLAUDE.md` (and/or Copilot file); no empty output files.
- Same config twice → byte-identical.
- Every file starts with the marker (containing `generatorVersion`), ends with a single `\n`; the marker hash matches the body (CRLF-normalized). A different `generatorVersion` changes only the marker line, never the body hash.
- `CLAUDE.md` files contain `@AGENTS.md` exactly once, and nothing else besides the marker.
- Module path normalization: `src/api/` and `./src/api` render to `src/api/CLAUDE.md`.
- Errors: module path `.` → `ok: false` at `/modules/items/N/path`; two modules with the same normalized path → `ok: false`.
- Changing the config changes the body hash only in files whose body changed.

Manual (pilot checklist, not unit-testable):
- Claude Code: `/context all` lists the root `CLAUDE.md` under "Memory files", with `AGENTS.md` loaded through the import; works with a `CLAUDE.local.md` present.
- Copilot in VS Code: follows an instruction placed in the root `AGENTS.md` and one in `copilot-instructions.md`; confirm a module `AGENTS.md` rule is **not** followed by default (documents the accepted limit).
- Copilot CLI / cloud agent: follows `AGENTS.md`.

## Boundaries

- **Always:** keep per-agent files as pure pointers to `AGENTS.md`; keep output deterministic; stay pure; normalize paths.
- **Ask first:** a new target agent; any content in a per-agent file beyond marker + pointer/import; path-specific instruction files; `.vscode/settings.json`; a templating dependency.
- **Never:** duplicate rules, stack or module lists from `AGENTS.md` into a per-agent file; write to disk from this module; overwrite or delete a file for an unselected target.

## Success Criteria

- Golden and error tests pass.
- With `CLAUDE.local.md` present, Claude Code still loads the root and module `AGENTS.md` (via the imports).
- Copilot CLI / cloud agent follow `AGENTS.md`; VS Code behavior confirmed manually and recorded, including the nested-file limit.

## Open Questions

1. `cli` spec: confirm it implements the "Existing files" table, the missing-`AGENTS.md` check, and the dropped-target notice.
2. `init-flow` spec: must keep always-needed rules in the root `AGENTS.md` (Decision 5). README promises a personal `AGENTS.local.md`, but neither Claude Code nor Copilot reads it; use `CLAUDE.local.md` (fine once `CLAUDE.md` imports `AGENTS.md`) or drop the promise.
3. `chat.useClaudeMdFile` is documented inconsistently between VS Code and GitHub docs. Decision 3 is safe either way.
4. No minimum Claude Code version needed: the design uses the import, not direct `AGENTS.md` reading (v2.1.277+).
