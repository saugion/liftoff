import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { countOf } from "../brain/lesson.js";
import { daysBetween, parseBlock } from "../brain/lessons-block.js";
import { NO_BRAIN, brainFail } from "./brain-init.js";
import { LESSONS_DIR, NO_LESSONS, isReady, lessonFail, lessonsProblem, readLessons, similarTo, today } from "./lesson-add.js";
import { resolveReal } from "./fsutil.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import type { Handler } from "./types.js";

// Read-only: every personal lesson with its count and derived status, the rules the team already has in its blocks,
// and which lessons are ready to promote. Never an error for a personal file that does not parse.
export const lessonList: Handler = ({ root }) => {
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  const config = read.config;
  if (!config.brain) return brainFail("no-brain", NO_BRAIN);
  const settings = config.brain.lessons;
  if (!settings) return lessonFail("no-lessons", NO_LESSONS);
  const realRoot = resolveReal(root);
  const problem = lessonsProblem(realRoot);
  if (problem) return lessonFail("lessons-block-invalid", `${problem} is or goes through a symlink: the lessons must be plain files inside the repo`, { file: problem });

  const warnings: { code: string; file: string; message: string; line?: number }[] = [];
  // the files that may hold a team block: the root and module AGENTS.md, the constraints file
  const candidates = [
    "AGENTS.md",
    ...(config.modules?.items ?? []).map((m) => `${m.path.replace(/\/+$/, "")}/AGENTS.md`),
    config.constraints?.file ?? "CONSTRAINTS.md",
  ];
  const shared: { file: string; key: string; rule: string; since: string; reviewDue: boolean }[] = [];
  const date = today();
  for (const file of candidates) {
    const abs = join(realRoot, file);
    if (!existsSync(abs)) continue;
    if (lstatSync(abs).isSymbolicLink()) { warnings.push({ code: "lessons-block-invalid", file, message: "a symlink: its lessons block is not read" }); continue; }
    const block = parseBlock(readFileSync(abs, "utf8"));
    for (const e of block.errors) warnings.push({ code: "lessons-block-invalid", file, message: e.message, line: e.line });
    for (const r of block.rules) shared.push({ file, key: r.key, rule: r.rule, since: r.since, reviewDue: daysBetween(r.since, date) > settings.reviewAfterDays });
  }
  const inBlock = new Set(shared.map((s) => s.key));

  const { lessons, invalid } = readLessons(realRoot);
  for (const i of invalid) warnings.push({ code: "personal-lesson-invalid", file: i.file, message: i.errors.join("; ") });
  const items = lessons.map((l) => {
    const promoted = inBlock.has(l.key);
    return {
      key: l.key, rule: l.rule, kind: l.kind, target: l.target, module: l.module ?? null,
      status: promoted ? "promoted" : l.status,
      count: countOf(l.occurrences), ready: !promoted && isReady(l, settings.promoteAfter), tainted: l.tainted,
      similar: similarTo(l, lessons), path: `${LESSONS_DIR}/${l.key}.md`,
    };
  });
  return { exitCode: 0, body: { ok: true, lessons: items, shared, ready: items.filter((i) => i.ready).map((i) => i.key), warnings } };
};
