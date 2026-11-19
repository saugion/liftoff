import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { secretGuard } from "../config/secrets.js";
import type { Finding } from "./check.js";
import { instructionLike, weakensBar } from "./guards.js";
import { parseLesson } from "./lesson.js";
import { type BlockKind, daysBetween, parseBlock } from "./lessons-block.js";
import { PERSONAL_DIR } from "./paths.js";

export interface LessonsCheckInput {
  realRoot: string;
  files: { path: string; kind: BlockKind }[]; // every file that may hold a block
  maxRules: number;
  reviewAfterDays: number;
  today: string;
}

const flat = (s: string): string => s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// The lessons rules of brain-check. Only run when `brain.lessons` is set: without it a hand-made block is just text.
export function checkLessons({ realRoot, files, maxRules, reviewAfterDays, today }: LessonsCheckInput): Finding[] {
  const out: Finding[] = [];
  const add = (level: Finding["level"], code: string, file: string, message: string, line?: number) =>
    out.push({ code, level, file, message, ...(line !== undefined && { line }) });
  const keyFiles = new Map<string, string>(); // key -> first file that holds it

  for (const f of files) {
    const abs = join(realRoot, f.path);
    if (!existsSync(abs)) continue;
    if (lstatSync(abs).isSymbolicLink()) { add("error", "symlink", f.path, "a symlink: its lessons block is not read"); continue; }
    const text = readFileSync(abs, "utf8");
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const block = parseBlock(text);
    const lineOf = (key: string) => lines.findIndex((l) => l.includes(`lesson: ${key};`)) + 1;

    for (const e of block.errors) {
      if (/longer than 160/.test(e.message)) add("error", "lesson-rule-long", f.path, e.message, e.line);
      else if (/appears twice/.test(e.message)) add("warning", "lesson-duplicate", f.path, e.message, e.line);
      else add("error", "lessons-block", f.path, e.message, e.line);
    }
    if (block.rules.length > maxRules) add("error", "lessons-too-many", f.path, `${block.rules.length} rules in the lessons block, above the limit of ${maxRules} (brain.lessons.maxRules)`, block.begin + 1);

    const rulesSeen = new Map<string, string>();
    for (const r of block.rules) {
      const line = lineOf(r.key);
      if (weakensBar(r.rule)) add("error", "lesson-weakens", f.path, `the rule ${r.key} would lower the quality bar. An accident guard, not a guarantee: a lower bar is changed in CONSTRAINTS.md by hand, never through a lesson`, line);
      if (instructionLike(r.rule)) add("warning", "instruction-like", f.path, `the rule ${r.key} reads like an instruction aimed at an agent: state the behaviour the team wants`, line);
      if (secretGuard({ rule: r.rule }).length > 0) add("error", "secret", f.path, `the rule ${r.key} looks like a credential (an accident guard, not a guarantee)`, line);
      if (keyFiles.has(r.key) && keyFiles.get(r.key) !== f.path) add("warning", "lesson-duplicate", f.path, `the key ${r.key} is also in ${keyFiles.get(r.key)}`, line);
      else keyFiles.set(r.key, f.path);
      const n = flat(r.rule);
      if (rulesSeen.has(n)) add("warning", "lesson-duplicate", f.path, `${r.key} says the same as ${rulesSeen.get(n)}`, line);
      else rulesSeen.set(n, r.key);
      if (daysBetween(r.since, today) > reviewAfterDays) add("warning", "lesson-review-due", f.path, `${r.key} is older than ${reviewAfterDays} days: still true? The team decides in a merge request`, line);
    }
    if (f.path === "AGENTS.md" && lines.filter((l) => l.trim() !== "").length > 300) {
      add("warning", "agents-md-long", f.path, "the root AGENTS.md is over 300 non-empty lines: agents read it on every task, so keep it short");
    }
  }

  // Personal lessons that do not parse: a warning, never an error (the file never leaves the machine).
  const dir = join(realRoot, PERSONAL_DIR, "lessons");
  if (existsSync(dir)) {
    for (const n of readdirSync(dir).sort()) {
      if (!n.endsWith(".md")) continue;
      const r = parseLesson(readFileSync(join(dir, n), "utf8"));
      if (!r.ok) add("warning", "personal-lesson-invalid", `${PERSONAL_DIR}/lessons/${n}`, r.errors.join("; "));
    }
  }
  return out;
}
