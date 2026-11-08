import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { type Agent, configHash, requiredSections, sectionHashes } from "../config/index.js";
import { normalizeModulePath, renderAgentFiles, type RenderedFile } from "../render/index.js";
import { bodyHash, normalizeEol, parseMarker } from "../render/marker.js";
import { atomicWrite, isInside, resolveReal } from "./fsutil.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import { APPLIED_PATH, GITIGNORE_PATH, ensureSelfIgnore, readApplied, writeApplied } from "./state.js";
import type { CliError, ErrorCode, Handler } from "./types.js";
import { toCliError } from "./validate.js";
import { INSTALLED_VERSION, compareVersions } from "./version.js";

export type Action = "created" | "unchanged" | "refreshed" | "conflict" | "skipped-symlink";
export type ConflictReason = "no-marker" | "hand-edited" | "newer-generator" | "symlink" | "not-regular";

export interface PlannedFile {
  path: string;
  agent: Agent;
  action: Action;
  reason?: ConflictReason; // conflicts only
  proposed?: string; // conflicts only: the full generated content
}

export interface Fatal {
  ok: false;
  errors: CliError[];
  files?: PlannedFile[]; // what was already written when a write failed
}

export type RenderResult =
  | { ok: true; applied: true; configHash: string; files: PlannedFile[]; notices: string[] }
  | Fatal;

// A plan entry plus the exact text to write (absent when nothing is written).
type Planned = PlannedFile & { write?: string };

const fatal = (...errors: CliError[]): Fatal => ({ ok: false, errors });
const errno = (e: unknown) => (e as NodeJS.ErrnoException).code;
const asCode = (code: ErrorCode, errors: CliError[]): CliError[] => errors.map((e) => ({ ...e, code }));
const publicFile = ({ write: _write, ...file }: Planned): PlannedFile => file;

// Writing over an existing file keeps its line endings and BOM, so the diff in git stays clean on every platform.
function matchStyle(existing: string, content: string): string {
  const body = existing.includes("\r\n") ? content.replace(/\n/g, "\r\n") : content;
  return (existing.startsWith("﻿") ? "﻿" : "") + body;
}

// Conflicts the user may resolve with --overwrite. A symlink or a directory is never written through.
const OVERWRITABLE: ReadonlySet<ConflictReason> = new Set(["no-marker", "hand-edited", "newer-generator"]);

function pointsAtSiblingAgentsMd(abs: string): boolean {
  try {
    return realpathSync(abs) === realpathSync(join(dirname(abs), "AGENTS.md"));
  } catch {
    return false;
  }
}

// What happens to one generated file, (plan table: created / unchanged / refreshed / conflict / skipped-symlink).
function planFile(realRoot: string, file: RenderedFile, overwrite: ReadonlySet<string>): Planned {
  const base = { path: file.path, agent: file.agent };
  const abs = join(realRoot, file.path);
  const conflict = (reason: ConflictReason): Planned => ({ ...base, action: "conflict", reason, proposed: file.content });

  let stat;
  try {
    stat = lstatSync(abs);
  } catch (e) {
    if (errno(e) === "ENOENT" || errno(e) === "ENOTDIR") return { ...base, action: "created", write: file.content };
    throw e;
  }
  if (stat.isSymbolicLink()) {
    // CLAUDE.md -> AGENTS.md already does what the generated file would do: leave it.
    return basename(abs) === "CLAUDE.md" && pointsAtSiblingAgentsMd(abs) ? { ...base, action: "skipped-symlink" } : conflict("symlink");
  }
  if (!stat.isFile()) return conflict("not-regular");

  const existing = readFileSync(abs, "utf8");
  if (normalizeEol(existing) === normalizeEol(file.content)) return { ...base, action: "unchanged" };

  const refreshed = (): Planned => ({ ...base, action: "refreshed", write: matchStyle(existing, file.content) });
  const marker = parseMarker(existing);
  let reason: ConflictReason;
  if (marker && bodyHash(marker.body) === marker.hash) {
    // Unedited. Refresh it, unless a newer LiftOff wrote it (or we cannot tell): then updating the plugin comes first.
    const order = compareVersions(marker.version, INSTALLED_VERSION);
    if (order !== undefined && order <= 0) return refreshed();
    reason = "newer-generator";
  } else {
    reason = marker ? "hand-edited" : "no-marker";
  }
  return overwrite.has(file.path) ? refreshed() : conflict(reason);
}

// Every AGENTS.md the generated files import must exist under its exact name (macOS would accept "Agents.md" and
// then break on Linux), and must not be a symlink to a file this render writes (the import would loop onto itself).
function checkAgentsMd(root: string, rels: string[], plannedReal: Set<string>): CliError[] {
  const errors: CliError[] = [];
  const invalid = (file: string, why: string): CliError => ({ code: "agents-md-invalid", file, message: `${file} ${why}` });
  for (const rel of rels) {
    const abs = join(root, rel);
    let names: string[] = [];
    try {
      names = readdirSync(dirname(abs));
    } catch {
      // the directory itself is missing
    }
    if (!names.includes("AGENTS.md")) {
      errors.push({ code: "agents-md-missing", file: rel, message: `${rel} not found (the name is case-sensitive); create it before rendering` });
      continue;
    }
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink()) {
      let target: string;
      try {
        target = realpathSync(abs);
      } catch {
        errors.push(invalid(rel, "is a broken symlink"));
        continue;
      }
      if (plannedReal.has(target)) {
        errors.push(invalid(rel, `is a symlink to ${relative(root, target)}, which render writes: @AGENTS.md would import the file into itself`));
      } else if (!statSync(target).isFile()) {
        errors.push(invalid(rel, "is a symlink to something that is not a file"));
      }
    } else if (!stat.isFile()) {
      errors.push(invalid(rel, "is not a regular file"));
    }
  }
  return errors;
}

export function applyRender(root: string, opts: { overwrite: string[] }): RenderResult {
  // 1. config, plugin pin first. Only an installed plugin older than the pin blocks render; config changes never do
  // (render is the command that resolves them).
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return fatal(...readFailure(root, read));
  const config = read.config;

  // 2. render (pure)
  const rendered = renderAgentFiles(config, { generatorVersion: INSTALLED_VERSION });
  if (!rendered.ok) return fatal(...asCode("render-invalid", rendered.errors.map(toCliError)));
  const generated = rendered.value;

  // 3. AGENTS.md preflight: nothing is written before it passes
  const realRoot = realpathSync(root);
  // The files render writes: real parent directory + file name. The last component is NOT followed, because render
  // never writes through a symlink (CLAUDE.md -> AGENTS.md -> RULES.md must not make AGENTS.md look like an output).
  const plannedReal = new Set(generated.map((f) => join(resolveReal(dirname(join(realRoot, f.path))), basename(f.path))));
  const needed = ["AGENTS.md"];
  if (config.agents.targets.includes("claude-code")) {
    needed.push(...(config.modules?.items ?? []).map((m) => `${normalizeModulePath(m.path)}/AGENTS.md`));
  }
  const preflight = checkAgentsMd(realRoot, needed, plannedReal);
  if (preflight.length > 0) return fatal(...preflight);

  // 4. containment: everything we would touch must stay inside the real root, through symlinks too
  const touched = [...generated.map((f) => f.path), GITIGNORE_PATH, APPLIED_PATH];
  const escaping = touched.filter((rel) => !isInside(realRoot, resolveReal(join(realRoot, rel))));
  if (escaping.length > 0) {
    return fatal(...escaping.map((file): CliError => ({ code: "path-escape", file, message: `${file} resolves outside the repo root` })));
  }

  // 5. --overwrite: normalized like a generated path, and it must name one (a typo must not become a write)
  const planned = new Set(generated.map((f) => f.path));
  const overwrite = new Set<string>();
  const unknown: string[] = [];
  for (const arg of opts.overwrite) {
    const path = normalizeModulePath(arg);
    if (planned.has(path)) overwrite.add(path);
    else unknown.push(arg);
  }
  if (unknown.length > 0) {
    return fatal({ code: "usage", message: `--overwrite names no file render writes: ${unknown.join(", ")} (valid: ${[...planned].join(", ")})` });
  }

  // 6. plan every file before writing any
  const plan = generated.map((f) => planFile(realRoot, f, overwrite));
  const ignoredOverwrites = plan
    .filter((p) => overwrite.has(p.path) && (p.action === "skipped-symlink" || (p.action === "conflict" && !OVERWRITABLE.has(p.reason!))))
    .map((p) => `${p.path}: --overwrite does not apply to ${p.action === "skipped-symlink" ? "a symlink to AGENTS.md" : `a ${p.reason}`}`);
  // Files the last render planned that this one no longer does (a dropped target, a removed module): left in place.
  const previous = readApplied(realRoot);
  const stale =
    previous.kind === "ok"
      ? previous.record.files
          .filter((f) => !planned.has(f) && existsSync(join(realRoot, f)))
          .sort()
          .map((f) => `stale: ${f} is no longer generated; left in place`)
      : [];
  // No constraints section means the default file name.
  const constraintsFile = normalizeModulePath(config.constraints?.file ?? "CONSTRAINTS.md");
  const missingConstraints =
    config.agents.targets.includes("copilot") && !existsSync(join(realRoot, constraintsFile))
      ? [`${constraintsFile} does not exist yet, and the Copilot instructions point to it`]
      : [];
  const notices = [...ignoredOverwrites, ...stale, ...missingConstraints];

  // 7-8. self-ignoring state directory, then the writes (atomic, one by one)
  const written: PlannedFile[] = [];
  let current = GITIGNORE_PATH;
  try {
    ensureSelfIgnore(realRoot);
    for (const entry of plan) {
      if (entry.write === undefined) continue;
      current = entry.path;
      atomicWrite(join(realRoot, entry.path), entry.write);
      written.push(publicFile(entry));
    }

    // 9. the record last, so it never claims a write that did not happen
    current = APPLIED_PATH;
    writeApplied(realRoot, {
      v: 1,
      configHash: configHash(config),
      sectionHashes: Object.fromEntries(Object.entries(sectionHashes(config)).sort(([a], [b]) => (a < b ? -1 : 1))),
      requiredSections: requiredSections(config),
      files: plan.map((p) => p.path).sort(),
      conflicts: plan.filter((p) => p.action === "conflict").map((p) => p.path).sort(),
    });
  } catch (e) {
    return { ok: false, errors: [{ code: "write-failed", file: current, message: e instanceof Error ? e.message : String(e) }], files: written };
  }

  return { ok: true, applied: true, configHash: configHash(config), files: plan.map(publicFile), notices };
}

export const render: Handler = ({ root, overwrite }) => {
  const result = applyRender(root, { overwrite });
  if (result.ok) return { exitCode: 0, body: { ...result } };
  return { exitCode: result.errors.some((e) => e.code === "usage") ? 2 : 1, body: { ...result } };
};
