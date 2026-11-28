import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Lesson, serializeLesson } from "../brain/lesson.js";
import { parseBlock } from "../brain/lessons-block.js";
import { type TargetFile, normalizeSelection, planPromotion, selectionErrors } from "../brain/promote.js";
import { inLeftOutRepo } from "../render/index.js";
import { NO_BRAIN, brainFail } from "./brain-init.js";
import { atomicWrite, resolveReal } from "./fsutil.js";
import { LESSONS_DIR, NO_LESSONS, lessonFail, lessonsProblem, readLessons, today } from "./lesson-add.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import { ensureSelfIgnore } from "./state.js";
import type { Handler } from "./types.js";

// A backup never overwrites an existing one: .liftoff/backup/<path>, or <path>.1, .2, ... when that exists.
function backupPath(realRoot: string, rel: string): string {
  const base = join(realRoot, ".liftoff", "backup", rel);
  if (!existsSync(base)) return base;
  for (let n = 1; ; n++) if (!existsSync(`${base}.${n}`)) return `${base}.${n}`;
}

// Turns a selection of lessons into reviewed rules in the team's blocks. Only the blocks change; no git is run.
export const lessonPromote: Handler = ({ root, file, write }) => {
  if (!file) return { exitCode: 2, body: { ok: false, errors: [{ code: "usage", message: "lesson-promote needs --file <selection.json>" }] } };
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  const config = read.config;
  if (!config.brain) return brainFail("no-brain", NO_BRAIN);
  const settings = config.brain.lessons;
  if (!settings) return lessonFail("no-lessons", NO_LESSONS);
  const realRoot = resolveReal(root);
  const problem = lessonsProblem(realRoot);
  if (problem) return lessonFail("lessons-block-invalid", `${problem} is or goes through a symlink`, { file: problem });

  let raw: unknown;
  try {
    const abs = resolve(root, file);
    if (statSync(abs).size > 64 * 1024) return lessonFail("lesson-invalid", `${file} is larger than 64 KB`);
    raw = JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    return lessonFail("lesson-invalid", `cannot read the selection ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const bad = selectionErrors(raw);
  if (bad.length > 0) return lessonFail("lesson-invalid", bad.join("; "), { errors: bad });
  const selection = normalizeSelection(raw as object);

  const constraintsFile = config.constraints?.file ?? "CONSTRAINTS.md";
  const moduleFile = (m: string | undefined): string | undefined => {
    if (m === undefined) return "AGENTS.md";
    const item = config.modules?.items?.find((x) => x.id === m);
    return item ? `${item.path.replace(/\/+$/, "")}/AGENTS.md` : undefined;
  };
  // every file a block can live in; a symlink is refused, a missing file is simply absent
  const files: Record<string, TargetFile | undefined> = {};
  const inBlocks = new Set<string>();
  const candidates = [{ path: "AGENTS.md", kind: "agents" as const }, ...(config.modules?.items ?? []).map((m) => ({ path: `${m.path.replace(/\/+$/, "")}/AGENTS.md`, kind: "agents" as const })), { path: constraintsFile, kind: "constraints" as const }];
  for (const c of candidates) {
    const abs = join(realRoot, c.path);
    if (!existsSync(abs)) continue;
    if (lstatSync(abs).isSymbolicLink()) return lessonFail("lessons-block-invalid", `${c.path} is a symlink: the lessons block is never written through one`, { file: c.path });
    const text = readFileSync(abs, "utf8");
    files[c.path] = { path: c.path, kind: c.kind, text };
    for (const r of parseBlock(text).rules) inBlocks.add(r.key);
  }

  const { lessons } = readLessons(realRoot);
  const date = today();
  const leftOut = new Set((config.modules?.items ?? []).filter((m) => inLeftOutRepo(config.workspace?.exclude, m.path)).map((m) => moduleFile(m.id)));
  const whyAbsent = (path: string) => (leftOut.has(path) ? "its repository is left out (workspace.exclude), so LiftOff writes nothing there. Include it again and apply the setup, or keep the lesson personal" : undefined);
  const plan = planPromotion({ selection, lessons, whyAbsent, agentsFile: moduleFile, constraintsFile, files, inBlocks, maxRules: settings.maxRules, today: date });
  if (!plan.ok) return lessonFail(plan.code, plan.message, plan.file ? { file: plan.file } : {});

  if (write) {
    ensureSelfIgnore(realRoot);
    for (const f of plan.files) {
      const abs = join(realRoot, f.path);
      atomicWrite(backupPath(realRoot, f.path), files[f.path]!.text);
      atomicWrite(abs, f.text);
    }
    // a retired rule frees its personal lesson: it is not promoted any more and is not offered again
    const byKey = new Map<string, Lesson>(lessons.map((l) => [l.key, l]));
    for (const key of plan.retired) {
      const l = byKey.get(key);
      if (l && l.status === "open") atomicWrite(join(realRoot, LESSONS_DIR, `${key}.md`), serializeLesson({ ...l, status: "retired" }));
    }
  }
  return {
    exitCode: 0,
    body: {
      ok: true,
      files: plan.files.map(({ text: _text, ...rest }) => rest),
      lead: plan.lead,
      handbook: plan.handbook,
      branch: plan.branch, commitMessage: plan.commitMessage, gitAdd: plan.gitAdd,
      promoted: plan.promoted, retired: plan.retired,
      written: write === true && plan.files.length > 0,
    },
  };
};
