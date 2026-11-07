import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { type Agent, configHash, readConfig, requiredSections, sectionHashes } from "../config/index.js";
import { normalizeModulePath, renderAgentFiles, type RenderedFile } from "../render/index.js";
import { normalizeEol } from "../render/marker.js";
import { atomicWrite, isInside, resolveReal } from "./fsutil.js";
import { APPLIED_PATH, GITIGNORE_PATH, ensureSelfIgnore, writeApplied } from "./state.js";
import type { CliError, ErrorCode, Handler } from "./types.js";
import { CONFIG_FILE, toCliError } from "./validate.js";
import { INSTALLED_VERSION } from "./version.js";

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

const fatal = (...errors: CliError[]): Fatal => ({ ok: false, errors });
const errno = (e: unknown) => (e as NodeJS.ErrnoException).code;

const conflict = (base: Pick<PlannedFile, "path" | "agent">, reason: ConflictReason, file: RenderedFile): PlannedFile => ({
  ...base,
  action: "conflict",
  reason,
  proposed: file.content,
});

// What would happen to one generated file. `refreshed`, `skipped-symlink`, marker-based reasons and --overwrite: T8.
function planFile(realRoot: string, file: RenderedFile): PlannedFile {
  const base = { path: file.path, agent: file.agent };
  const abs = join(realRoot, file.path);
  let stat;
  try {
    stat = lstatSync(abs);
  } catch (e) {
    if (errno(e) === "ENOENT" || errno(e) === "ENOTDIR") return { ...base, action: "created" };
    throw e;
  }
  if (stat.isSymbolicLink()) return conflict(base, "symlink", file);
  if (!stat.isFile()) return conflict(base, "not-regular", file);
  if (normalizeEol(readFileSync(abs, "utf8")) === normalizeEol(file.content)) return { ...base, action: "unchanged" };
  return conflict(base, "hand-edited", file);
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

const asCode = (code: ErrorCode, errors: ReturnType<typeof toCliError>[]): CliError[] => errors.map((e) => ({ ...e, code }));

export function applyRender(root: string, opts: { overwrite: string[] }): RenderResult {
  if (opts.overwrite.length > 0) return fatal({ code: "usage", message: "--overwrite is not supported yet" }); // T8

  // 1. config (the plugin-pin-first read arrives with check-config, T10)
  const configFile = join(root, CONFIG_FILE);
  if (!existsSync(configFile)) return fatal({ code: "config-missing", message: `${CONFIG_FILE} not found in ${root}` });
  const read = readConfig(configFile);
  if (!read.ok) return fatal(...read.errors.map(toCliError));
  const config = read.value;

  // 2. render (pure)
  const rendered = renderAgentFiles(config, { generatorVersion: INSTALLED_VERSION });
  if (!rendered.ok) return fatal(...asCode("render-invalid", rendered.errors.map(toCliError)));
  const generated = rendered.value;

  // 3. AGENTS.md preflight: nothing is written before this passes
  const realRoot = realpathSync(root);
  const plannedReal = new Set(generated.map((f) => resolveReal(join(realRoot, f.path))));
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

  // 6. plan every file before writing any
  const plan = generated.map((f) => planFile(realRoot, f));

  // 7-8. self-ignoring state directory, then the writes (atomic, one by one)
  const written: PlannedFile[] = [];
  let current = GITIGNORE_PATH;
  try {
    ensureSelfIgnore(realRoot);
    for (const [i, entry] of plan.entries()) {
      if (entry.action !== "created") continue;
      current = entry.path;
      atomicWrite(join(realRoot, entry.path), generated[i]!.content);
      written.push(entry);
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

  return { ok: true, applied: true, configHash: configHash(config), files: plan, notices: [] };
}

export const render: Handler = ({ root, overwrite }) => {
  const result = applyRender(root, { overwrite });
  if (result.ok) return { exitCode: 0, body: { ...result } };
  return { exitCode: result.errors.some((e) => e.code === "usage") ? 2 : 1, body: { ...result } };
};
