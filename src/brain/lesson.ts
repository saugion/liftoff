import { createHash } from "node:crypto";
import { parseDocument } from "yaml";

// A lesson is one behaviour the engineer corrected, stated as a short rule, with every correction as evidence.
// Personal data, never an instruction. Pure: text in, data out.

export const KINDS = ["command", "convention", "test", "style", "process"] as const;
export const TARGETS = ["agents-md", "constraints", "wiki", "lead"] as const;
export const SKILLS = ["plan", "build", "brain"] as const;
export const STATUSES = ["open", "dismissed", "retired"] as const;
export type Kind = (typeof KINDS)[number];
export type Target = (typeof TARGETS)[number];
export type Skill = (typeof SKILLS)[number];
export type Status = (typeof STATUSES)[number];

export const KEY_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const MAX_RULE = 160;

export interface Occurrence { date: string; ticket?: string; skill: Skill; evidence: string; text: string } // evidence = hash of text
export interface Lesson {
  key: string;
  rule: string;
  kind: Kind;
  target: Target;
  module?: string;
  status: Status;
  tainted: boolean;
  occurrences: Occurrence[];
}
// What the agent hands to lesson-add.
export interface Draft { key: string; rule: string; kind: Kind; target: Target; module?: string; ticket?: string; skill: Skill; evidence: string }

const norm = (s: string): string => s.normalize("NFC").replace(/\r\n?/g, "\n").trim();
// First 8 hex of the sha256 of the verbatim correction: the same correction twice is one occurrence.
export const evidenceHash = (text: string): string => createHash("sha256").update(norm(text)).digest("hex").slice(0, 8);

const oneLine = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\r\n]/.test(v);
const inList = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const TICKET_RE = /^[A-Z][A-Z0-9_]*-[0-9]+$/;

// Problems with a draft, one message each. Empty means valid.
export function draftErrors(d: unknown): string[] {
  if (d === null || typeof d !== "object" || Array.isArray(d)) return ["the draft must be a JSON object"];
  const x = d as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof x.key !== "string" || !KEY_RE.test(x.key)) errors.push("key must be lowercase letters, digits and dashes, 2-40 characters, starting with a letter or digit");
  if (!oneLine(x.rule, MAX_RULE)) errors.push(`rule must be one line of 1-${MAX_RULE} characters`);
  if (!inList(KINDS, x.kind)) errors.push(`kind must be one of ${KINDS.join(", ")}`);
  if (!inList(TARGETS, x.target)) errors.push(`target must be one of ${TARGETS.join(", ")}`);
  if (!inList(SKILLS, x.skill)) errors.push(`skill must be one of ${SKILLS.join(", ")}`);
  if (typeof x.evidence !== "string" || x.evidence.trim() === "") errors.push("evidence must be the engineer's words, verbatim");
  if (x.module !== undefined && !oneLine(x.module, 120)) errors.push("module must be a module id");
  if (x.ticket !== undefined && (typeof x.ticket !== "string" || !TICKET_RE.test(x.ticket))) errors.push("ticket must look like PROJ-123");
  const unknown = Object.keys(x).filter((k) => !["key", "rule", "kind", "target", "module", "ticket", "skill", "evidence"].includes(k));
  for (const k of unknown) errors.push(`unknown key '${k}'`);
  return errors;
}

// ---- file format -------------------------------------------------------------------------------------------------

export function serializeLesson(l: Lesson): string {
  const occ = l.occurrences.map((o) => `  - { date: ${o.date}, ${o.ticket ? `ticket: ${o.ticket}, ` : ""}skill: ${o.skill}, evidence: "${o.evidence}" }`).join("\n");
  const front = [
    "---",
    `key: ${l.key}`,
    `rule: ${JSON.stringify(l.rule)}`,
    `kind: ${l.kind}`,
    `target: ${l.target}`,
    ...(l.module ? [`module: ${l.module}`] : []),
    `status: ${l.status}`,
    `tainted: ${l.tainted}`,
    "occurrences:",
    occ,
    "---",
  ].join("\n");
  const body = l.occurrences.map((o) => `## ${o.date} ${o.ticket ?? "(no ticket)"} (${o.skill})\n${o.text.split("\n").map((t) => `> ${t}`).join("\n")}`).join("\n\n");
  return `${front}\n${body}\n`;
}

export function parseLesson(text: string): { ok: true; lesson: Lesson } | { ok: false; errors: string[] } {
  const lf = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(lf);
  if (!m) return { ok: false, errors: ["a lesson file starts with a --- front matter block"] };
  const doc = parseDocument(m[1]!);
  if (doc.errors.length > 0) return { ok: false, errors: doc.errors.map((e) => `front matter YAML: ${e.message.split("\n")[0]}`) };
  const f = doc.toJS() as Record<string, unknown> | null;
  if (f === null || typeof f !== "object" || Array.isArray(f)) return { ok: false, errors: ["front matter must be a YAML mapping"] };
  const errors: string[] = [];
  if (typeof f.key !== "string" || !KEY_RE.test(f.key)) errors.push("key is missing or not valid");
  if (!oneLine(f.rule, MAX_RULE)) errors.push(`rule must be one line of 1-${MAX_RULE} characters`);
  if (!inList(KINDS, f.kind)) errors.push("kind is missing or not valid");
  if (!inList(TARGETS, f.target)) errors.push("target is missing or not valid");
  if (!inList(STATUSES, f.status)) errors.push("status must be open, dismissed or retired");
  if (typeof f.tainted !== "boolean") errors.push("tainted must be true or false");
  if (!Array.isArray(f.occurrences) || f.occurrences.length === 0) errors.push("occurrences must be a non-empty list");
  if (errors.length > 0) return { ok: false, errors };

  // the body holds the verbatim words, one block per occurrence, in order
  const blocks = [...m[2]!.matchAll(/^## .*\n((?:>.*\n?)+)/gm)].map((b) => b[1]!.split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^> ?/, "")).join("\n"));
  const occurrences: Occurrence[] = [];
  for (const [i, raw] of (f.occurrences as unknown[]).entries()) {
    const o = raw as Record<string, unknown>;
    if (o === null || typeof o !== "object" || typeof o.date !== "string" || !inList(SKILLS, o.skill) || typeof o.evidence !== "string" || !/^[0-9a-f]{8}$/.test(o.evidence) || (o.ticket !== undefined && typeof o.ticket !== "string")) {
      return { ok: false, errors: [`occurrence ${i + 1} needs date, skill and an 8-hex evidence`] };
    }
    occurrences.push({ date: o.date, ...(o.ticket !== undefined && { ticket: o.ticket as string }), skill: o.skill, evidence: o.evidence, text: blocks[i] ?? "" });
  }
  return {
    ok: true,
    lesson: {
      key: f.key as string, rule: f.rule as string, kind: f.kind as Kind, target: f.target as Target,
      ...(typeof f.module === "string" && { module: f.module }), status: f.status as Status, tainted: f.tainted as boolean, occurrences,
    },
  };
}

// ---- counting and similarity -------------------------------------------------------------------------------------

// Distinct tickets, plus distinct dates for the occurrences that have no ticket: several corrections on one ticket
// are one lesson, not three.
export function countOf(occurrences: Pick<Occurrence, "date" | "ticket">[]): number {
  return new Set(occurrences.map((o) => (o.ticket ? `t:${o.ticket}` : `d:${o.date}`))).size;
}

const STOP = new Set(
  ("a an and are as at be but by do does for from has have how i if in into is it its of on or so that the their then there these this to use used using was we what when which with you your " +
    "il lo la le gli un uno una di da del della dei delle dal dalla in con su per tra fra e ed o ma se che non come si sono è sia essere quando dove cosa questo questa quello").split(" "),
);
const spansOf = (rule: string): string[] => [...rule.normalize("NFC").matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim().toLowerCase());

// Token set of a rule: lowercase words without stop words, backticked spans kept whole.
export function tokens(rule: string): Set<string> {
  const spans = spansOf(rule);
  const rest = rule.normalize("NFC").toLowerCase().replace(/`[^`]+`/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ");
  return new Set([...rest.split(" ").filter((w) => w !== "" && !STOP.has(w)), ...spans.map((s) => `\`${s}\``)]);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let both = 0;
  for (const t of a) if (b.has(t)) both++;
  return both / (a.size + b.size - both);
}

// Two lessons that may be the same behaviour: reported, never merged by the CLI.
export function similarity(a: Pick<Lesson, "rule" | "kind" | "module">, b: Pick<Lesson, "rule" | "kind" | "module">): number | undefined {
  const score = jaccard(tokens(a.rule), tokens(b.rule));
  const sharedSpan = a.kind === b.kind && a.module === b.module && spansOf(a.rule).some((s) => spansOf(b.rule).includes(s));
  return score >= 0.5 ? score : sharedSpan ? Math.max(score, 0.5) : undefined;
}
