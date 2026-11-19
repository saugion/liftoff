import { instructionLike, weakensBar } from "./guards.js";
import { MAX_RULE, type Lesson } from "./lesson.js";
import { type BlockKind, type BlockRule, parseBlock, setBlock } from "./lessons-block.js";
import { secretGuard } from "../config/secrets.js";
import type { LessonErrorCode } from "../cli/types.js";

export interface Selection {
  add: { key: string; rule?: string }[];
  retire: { file: string; key: string }[];
  confirmTainted: string[];
  confirmConstraints: boolean;
}
export interface TargetFile { path: string; kind: BlockKind; text: string }
export interface FileChange { path: string; before: string; after: string; diff: string; rules: BlockRule[]; action: "create" | "update"; text: string }
export type PromoteResult =
  | { ok: true; files: FileChange[]; lead: { key: string; rule: string; message: string }[]; retired: string[]; promoted: string[]; branch: string | null; commitMessage: string | null; gitAdd: string[] }
  | { ok: false; code: LessonErrorCode; message: string; file?: string };

export function selectionErrors(x: unknown): string[] {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return ["the selection must be a JSON object"];
  const s = x as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(s)) if (!["add", "retire", "confirmTainted", "confirmConstraints"].includes(k)) errors.push(`unknown key '${k}'`);
  const list = (v: unknown, name: string, each: (e: unknown) => boolean, shape: string) => {
    if (v !== undefined && (!Array.isArray(v) || !v.every(each))) errors.push(`${name} must be a list of ${shape}`);
  };
  list(s.add, "add", (e) => !!e && typeof e === "object" && typeof (e as { key?: unknown }).key === "string" && ((e as { rule?: unknown }).rule === undefined || typeof (e as { rule?: unknown }).rule === "string"), "{key, rule?}");
  list(s.retire, "retire", (e) => !!e && typeof e === "object" && typeof (e as { file?: unknown }).file === "string" && typeof (e as { key?: unknown }).key === "string", "{file, key}");
  list(s.confirmTainted, "confirmTainted", (e) => typeof e === "string", "keys");
  if (s.confirmConstraints !== undefined && typeof s.confirmConstraints !== "boolean") errors.push("confirmConstraints must be true or false");
  return errors;
}
export const normalizeSelection = (s: Partial<Selection>): Selection => ({ add: s.add ?? [], retire: s.retire ?? [], confirmTainted: s.confirmTainted ?? [], confirmConstraints: s.confirmConstraints ?? false });

// A small unified-style diff: the changed middle between the common first and last lines, with two lines of context.
export function diffText(path: string, before: string, after: string): string {
  const a = before.split("\n"), b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const ctxStart = Math.max(0, head - 2);
  const ctxEnd = Math.min(tail, 2);
  const removed = a.length - tail - head, added = b.length - tail - head, ctx = head - ctxStart + ctxEnd;
  const out = [`--- a/${path}`, `+++ b/${path}`, `@@ -${ctxStart + 1},${ctx + removed} +${ctxStart + 1},${ctx + added} @@`];
  for (let i = ctxStart; i < head; i++) out.push(` ${a[i]}`);
  for (let i = head; i < a.length - tail; i++) out.push(`-${a[i]}`);
  for (let i = head; i < b.length - tail; i++) out.push(`+${b[i]}`);
  for (let i = 0; i < ctxEnd; i++) out.push(` ${a[a.length - tail + i]}`);
  return out.join("\n");
}

const byAge = (r: BlockRule[]): BlockRule[] => [...r].sort((x, y) => (x.since < y.since ? -1 : x.since > y.since ? 1 : x.key < y.key ? -1 : 1));
const fail = (code: LessonErrorCode, message: string, file?: string): PromoteResult => ({ ok: false, code, message, ...(file && { file }) });

export interface PromoteInput {
  selection: Selection;
  lessons: Lesson[];
  // where an `agents-md` lesson goes: the root file, or the module's file
  agentsFile: (module: string | undefined) => string | undefined; // undefined: unknown module
  constraintsFile: string;
  files: Record<string, TargetFile | undefined>; // path -> current text (undefined: missing)
  inBlocks: Set<string>; // keys already in a block
  maxRules: number;
  today: string;
}

// Computes the new blocks for a selection without touching anything. Every refusal returns before any change.
export function planPromotion(input: PromoteInput): PromoteResult {
  const { selection, lessons, today } = input;
  const byKey = new Map(lessons.map((l) => [l.key, l]));
  const next = new Map<string, BlockRule[]>(); // path -> rules after
  const kinds = new Map<string, BlockKind>();
  const rulesOf = (path: string): BlockRule[] | { error: PromoteResult } => {
    if (next.has(path)) return next.get(path)!;
    const f = input.files[path];
    if (!f) return { error: fail("lesson-invalid", `${path} does not exist: create it first (Init)`, path) };
    const block = parseBlock(f.text);
    if (block.errors.length > 0) return { error: fail("lessons-block-invalid", `${path}: ${block.errors[0]!.message} (line ${block.errors[0]!.line})`, path) };
    kinds.set(path, f.kind);
    next.set(path, [...block.rules]);
    return next.get(path)!;
  };

  const lead: { key: string; rule: string; message: string }[] = [];
  const promoted: string[] = [];
  const retiredKeys: string[] = [];

  for (const r of selection.retire) {
    const rules = rulesOf(r.file);
    if (!Array.isArray(rules)) return rules.error;
    if (!rules.some((x) => x.key === r.key)) return fail("lesson-invalid", `${r.key} is not in the lessons block of ${r.file}`, r.file);
    if (input.files[r.file]!.kind === "constraints" && !selection.confirmConstraints) {
      return fail("lesson-weakens", `retiring ${r.key} from ${r.file} removes a line of the quality bar: confirm it explicitly (confirmConstraints)`, r.file);
    }
    next.set(r.file, rules.filter((x) => x.key !== r.key));
    retiredKeys.push(r.key);
  }

  for (const a of selection.add) {
    const l = byKey.get(a.key);
    if (!l) return fail("lesson-invalid", `there is no personal lesson '${a.key}'`);
    if (l.status !== "open") return fail("lesson-invalid", `${a.key} is ${l.status}: only an open lesson can be promoted`);
    if (input.inBlocks.has(a.key) && !selection.retire.some((r) => r.key === a.key)) return fail("lesson-invalid", `${a.key} is already in a team block`);
    const rule = (a.rule ?? l.rule).trim();
    if (rule === "" || rule.length > MAX_RULE || /[\r\n]/.test(rule)) return fail("lesson-invalid", `the rule for ${a.key} must be one line of 1-${MAX_RULE} characters`);
    if (secretGuard({ rule }).length > 0) return fail("lesson-secret", `the rule for ${a.key} looks like a credential (an accident guard, not a guarantee)`);
    if (instructionLike(rule)) return fail("lesson-invalid", `the rule for ${a.key} reads like an instruction aimed at an agent`);
    if (weakensBar(rule)) return fail("lesson-weakens", `the rule for ${a.key} would lower the quality bar. This is an accident guard, not a guarantee: a team that wants a lower bar changes CONSTRAINTS.md by hand, never through a lesson`);
    if (l.tainted && !selection.confirmTainted.includes(a.key)) return fail("lesson-tainted", `${a.key} may have come from ticket text, not from the engineer: confirm it explicitly (confirmTainted) after checking the words`);
    if (l.target === "wiki") return fail("lesson-invalid", `${a.key} is a wiki lesson: it goes through the Brain skill's Ingest, not through a block`);
    if (l.target === "lead") {
      lead.push({ key: l.key, rule, message: `Lesson '${l.key}' is for the lead (something liftoff.yaml decides): ${rule}` });
      continue;
    }
    const path = l.target === "constraints" ? input.constraintsFile : input.agentsFile(l.module);
    if (path === undefined) return fail("lesson-invalid", `${a.key} names the module '${l.module}', which is not in liftoff.yaml`);
    const rules = rulesOf(path);
    if (!Array.isArray(rules)) return rules.error;
    next.set(path, [...rules, { key: l.key, rule, since: today }]);
    promoted.push(l.key);
  }

  const files: FileChange[] = [];
  for (const [path, rules] of next) {
    if (rules.length > input.maxRules) {
      return fail("lessons-full", `${path} would hold ${rules.length} rules, above the limit of ${input.maxRules}. Retire at least ${rules.length - input.maxRules} in the same change; the block holds, oldest first: ${byAge(input.files[path] ? parseBlock(input.files[path]!.text).rules : []).map((r) => `${r.key} (since ${r.since})`).join(", ")}`, path);
    }
    const f = input.files[path]!;
    const after = setBlock(f.text, rules, f.kind);
    if (after === undefined) return fail("lessons-block-invalid", `${path} has a lessons block that does not parse`, path);
    if (after === f.text) continue;
    const old = parseBlock(f.text);
    files.push({ path, before: old.found ? f.text.replace(/\r\n?/g, "\n").split("\n").slice(old.begin, old.end + 1).join("\n") : "", after: parseBlock(after).found ? after.replace(/\r\n?/g, "\n").split("\n").slice(parseBlock(after).begin, parseBlock(after).end + 1).join("\n") : "", diff: diffText(path, f.text.replace(/\r\n?/g, "\n"), after.replace(/\r\n?/g, "\n")), rules, action: old.found ? "update" : "create", text: after });
  }
  const parts = [...(promoted.length > 0 ? [`promote ${promoted.join(", ")}`] : []), ...(retiredKeys.length > 0 ? [`retire ${retiredKeys.join(", ")}`] : [])];
  return {
    ok: true, files, lead, retired: retiredKeys, promoted,
    branch: files.length > 0 ? `chore/lessons-${today}` : null,
    commitMessage: files.length > 0 ? `lessons: ${parts.join("; ")}` : null,
    gitAdd: files.map((f) => f.path),
  };
}
