import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { instructionLike, weakensBar } from "../brain/guards.js";
import { appendEvent, brainSize, metricsOn } from "../brain/metrics.js";
import { type Draft, type Lesson, countOf, draftErrors, evidenceHash, parseLesson, serializeLesson, similarity } from "../brain/lesson.js";
import { PERSONAL_DIR } from "../brain/paths.js";
import { type Config, projectsOf } from "../config/index.js";
import { secretGuard } from "../config/secrets.js";
import { readTicket, readWithMap } from "../plan/ticket.js";
import { NO_BRAIN, brainFail } from "./brain-init.js";
import { atomicWrite, isInside, resolveReal } from "./fsutil.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import { ensureSelfIgnore } from "./state.js";
import type { Handler, LessonErrorCode, Outcome } from "./types.js";

export const LESSONS_DIR = `${PERSONAL_DIR}/lessons`;
export const NO_LESSONS = "liftoff.yaml has no brain.lessons section: the lead enables lessons in liftoff.yaml";
export const lessonFail = (code: LessonErrorCode, message: string, extra: object = {}): Outcome => ({ exitCode: 1, body: { ok: false, errors: [{ code, message, ...extra }] } });
const usage = (message: string): Outcome => ({ exitCode: 2, body: { ok: false, errors: [{ code: "usage", message }] } });

const MAX_DRAFT = 64 * 1024;
export const today = (): string => new Date().toISOString().slice(0, 10);
const flat = (s: string): string => s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Normalized text of a saved ticket the way a person would read it: summary, description, acceptance criteria.
export function ticketText(root: string, config: Config, ticket: string): string | undefined {
  const file = join(root, ".liftoff", "tmp", `${ticket}.json`);
  if (!existsSync(file)) return undefined;
  try {
    if (statSync(file).size > 2_000_000) return undefined;
    const t = readTicket(readFileSync(file, "utf8"));
    if ("error" in t) return undefined;
    const project = projectsOf(config).find((p) => ticket.startsWith(`${p.project}-`));
    const type = project?.issueTypes.find((x) => x.name.toLowerCase() === t.issueType.toLowerCase());
    return flat([t.summary, t.description, readWithMap(t, type).acceptanceCriteria.text].join(" "));
  } catch {
    return undefined;
  }
}

// True when the rule, or a 24+ character run of the engineer's words, is copied from the ticket: the "correction" may
// then be ticket text, not the engineer.
export function isTainted(rule: string, evidence: string, text: string | undefined): boolean {
  if (!text) return false;
  const r = flat(rule);
  if (r.length >= 12 && text.includes(r)) return true;
  const e = flat(evidence);
  for (let i = 0; i + 24 <= e.length; i++) if (text.includes(e.slice(i, i + 24))) return true;
  return false;
}

// The personal lessons folder: plain files inside the repo, never a symlink.
export function lessonsProblem(realRoot: string): string | undefined {
  const abs = join(realRoot, LESSONS_DIR);
  const real = resolveReal(abs);
  if (!isInside(realRoot, real) || real !== abs) return LESSONS_DIR;
  if (!existsSync(abs)) return undefined;
  for (const n of readdirSync(abs)) if (lstatSync(join(abs, n)).isSymbolicLink()) return `${LESSONS_DIR}/${n}`;
  return undefined;
}

export function readLessons(realRoot: string): { lessons: Lesson[]; invalid: { file: string; errors: string[] }[] } {
  const abs = join(realRoot, LESSONS_DIR);
  const out = { lessons: [] as Lesson[], invalid: [] as { file: string; errors: string[] }[] };
  if (!existsSync(abs)) return out;
  for (const n of readdirSync(abs).sort()) {
    if (!n.endsWith(".md")) continue;
    const r = parseLesson(readFileSync(join(abs, n), "utf8"));
    if (r.ok) out.lessons.push(r.lesson);
    else out.invalid.push({ file: `${LESSONS_DIR}/${n}`, errors: r.errors });
  }
  return out;
}

export const similarTo = (l: Pick<Lesson, "key" | "rule" | "kind" | "module">, others: Lesson[]): { key: string; score: number }[] =>
  others
    .filter((o) => o.key !== l.key)
    .flatMap((o) => { const score = similarity(l, o); return score === undefined ? [] : [{ key: o.key, score: Math.round(score * 100) / 100 }]; })
    .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));

export const isReady = (l: Lesson, promoteAfter: number): boolean => l.status === "open" && l.target !== "lead" && countOf(l.occurrences) >= promoteAfter;

// Records one correction as a personal lesson: creates the lesson, appends an occurrence, or says it is already there.
export const lessonAdd: Handler = ({ root, file, write }) => {
  if (!file) return usage("lesson-add needs --file <draft.json>");
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  const config = read.config;
  if (!config.brain) return brainFail("no-brain", NO_BRAIN);
  const settings = config.brain.lessons;
  if (!settings) return lessonFail("no-lessons", NO_LESSONS);

  const realRoot = resolveReal(root);
  const problem = lessonsProblem(realRoot);
  if (problem) return lessonFail("lessons-block-invalid", `${problem} is or goes through a symlink: the lessons must be plain files inside the repo`, { file: problem });

  let draft: Draft;
  try {
    const abs = resolve(root, file);
    if (statSync(abs).size > MAX_DRAFT) return lessonFail("lesson-invalid", `${file} is larger than ${MAX_DRAFT} bytes`);
    draft = JSON.parse(readFileSync(abs, "utf8")) as Draft;
  } catch (e) {
    return lessonFail("lesson-invalid", `cannot read the draft ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const errors = draftErrors(draft);
  if (typeof draft?.evidence === "string" && draft.evidence.length > 1000) errors.push("evidence is longer than 1000 characters");
  const modules = (config.modules?.items ?? []).map((m) => m.id);
  if (draft?.module !== undefined && !modules.includes(draft.module)) errors.push(`module '${draft.module}' is not in liftoff.yaml modules`);
  if (errors.length > 0) return lessonFail("lesson-invalid", errors.join("; "), { errors });
  if (secretGuard({ rule: draft.rule, evidence: draft.evidence }).length > 0) return lessonFail("lesson-secret", "the rule or the engineer's words look like a credential (an accident guard, not a guarantee): nothing was written");
  if (instructionLike(draft.rule)) return lessonFail("lesson-invalid", "the rule reads like an instruction aimed at an agent; state the behaviour the team wants instead");
  if (weakensBar(draft.rule)) return lessonFail("lesson-weakens", "the rule would lower the quality bar (skip, disable, relax, or lower a check). This is an accident guard, not a guarantee: a team that wants a lower bar changes CONSTRAINTS.md by hand, never through a lesson");

  const path = `${LESSONS_DIR}/${draft.key}.md`;
  const abs = join(realRoot, path);
  const date = today();
  const text = draft.evidence.replace(/\r\n?/g, "\n").trim();
  const hash = evidenceHash(text);
  const occurrence = { date, ...(draft.ticket && { ticket: draft.ticket }), skill: draft.skill, evidence: hash, text };
  const taint = isTainted(draft.rule, draft.evidence, draft.ticket ? ticketText(realRoot, config, draft.ticket) : undefined);

  let lesson: Lesson;
  let action: "create" | "append" | "exists";
  if (existsSync(abs)) {
    const r = parseLesson(readFileSync(abs, "utf8"));
    if (!r.ok) return lessonFail("lesson-invalid", `${path} does not parse (${r.errors.join("; ")}): fix or remove it`, { file: path });
    const dup = r.lesson.occurrences.some((o) => o.evidence === hash && (draft.ticket ? o.ticket === draft.ticket : !o.ticket && o.date === date));
    lesson = { ...r.lesson, tainted: r.lesson.tainted || taint, occurrences: dup ? r.lesson.occurrences : [...r.lesson.occurrences, occurrence] };
    action = dup ? "exists" : "append";
  } else {
    lesson = { key: draft.key, rule: draft.rule, kind: draft.kind, target: draft.target, ...(draft.module && { module: draft.module }), status: "open", tainted: taint, occurrences: [occurrence] };
    action = "create";
  }

  const similar = similarTo(lesson, readLessons(realRoot).lessons);
  if (write && action !== "exists") {
    ensureSelfIgnore(realRoot);
    atomicWrite(abs, serializeLesson(lesson));
    // pilot metrics: that a correction happened, never what it said
    if (metricsOn(config)) appendEvent(realRoot, { e: "correction", t: date, key: draft.key, skill: draft.skill, kind: lesson.kind, ...brainSize(realRoot, config) });
  }
  const done = write && action !== "exists" ? (action === "create" ? "created" : "appended") : action;
  return { exitCode: 0, body: { ok: true, path, action: done, count: countOf(lesson.occurrences), ready: isReady(lesson, settings.promoteAfter), tainted: lesson.tainted, similar, written: write === true && action !== "exists" } };
};
