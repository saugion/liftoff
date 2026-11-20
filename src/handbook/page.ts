// A handbook page: guidance the agents read on demand. Pure: text in, structure out. No fs.
// A page proves itself by its declared origin, not by quotes (a practice has no source to quote); a case that cites a real
// ticket or merge request may list `sources`, and those quotes are checked like the wiki's.
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { canonicalize } from "../config/hash.js";
import { type Link, normalize, scanLinks } from "../brain/page.js";

export const HB_TYPES = ["practice", "convention", "case"] as const;
export type HbType = (typeof HB_TYPES)[number];
const KEYS = ["title", "type", "updated", "summary", "origin", "base", "status", "sources", "module"];
export const PRACTICE_SECTIONS = ["Why", "When", "How here", "Example"] as const;
export const MAX_PAGE_LINES = 120;

export interface HbFront {
  title: string;
  type: HbType;
  updated: string;
  summary: string;
  origin: string; // "team" or "liftoff@<major.minor[.patch]>"
  base?: string; // a LiftOff page only: fingerprint of the text LiftOff shipped
  status?: "stub"; // a page the team has not filled in yet: agents skip it, the health check lists it
  sources?: string[];
  module?: string;
}
export type HbPage =
  | { ok: true; front: HbFront; body: string; lines: number; sections: string[]; links: Link[] }
  | { ok: false; errors: string[] };

export const ORIGIN_LIFTOFF = /^liftoff@(\d+\.\d+(?:\.\d+)?)$/;
const oneLine = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\r\n]/.test(v);
const realDate = (v: unknown): boolean => {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
};

export function frontErrors(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return ["front matter must be a YAML mapping"];
  const f = raw as Record<string, unknown>;
  const errors = Object.keys(f).filter((k) => !KEYS.includes(k)).map((k) => `unknown key '${k}'`);
  if (!oneLine(f.title, 120)) errors.push("title must be one line of 1-120 characters");
  if (!HB_TYPES.includes(f.type as HbType)) errors.push(`type must be one of ${HB_TYPES.join(", ")}`);
  if (!realDate(f.updated)) errors.push("updated must be a real date, YYYY-MM-DD");
  if (!oneLine(f.summary, 160)) errors.push("summary must be one line of 1-160 characters");
  const liftoff = typeof f.origin === "string" && ORIGIN_LIFTOFF.test(f.origin);
  if (f.origin !== "team" && !liftoff) errors.push("origin must be 'team' or 'liftoff@<version>', for example liftoff@0.5");
  else if (liftoff && !(typeof f.base === "string" && /^[0-9a-f]{12}$/.test(f.base))) errors.push("a LiftOff page needs base: 12 hex digits in quotes (the fingerprint of the text LiftOff shipped)");
  else if (f.origin === "team" && f.base !== undefined) errors.push("a team page has no base: remove it (origin: team ends all updates for the page)");
  if (f.status !== undefined && f.status !== "stub") errors.push("status can only be 'stub'");
  if (f.sources !== undefined && (!Array.isArray(f.sources) || f.sources.length === 0 || !f.sources.every((s) => typeof s === "string" && s !== ""))) errors.push("sources must be a non-empty list of paths");
  if (f.sources !== undefined && f.type !== "case") errors.push("only a case lists sources");
  if (f.module !== undefined && !oneLine(f.module, 120)) errors.push("module must be a module id");
  return errors;
}

// Headings of level 2 of a Markdown body, outside fenced blocks.
export function sectionsOf(body: string): string[] {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of body.split("\n")) {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = undefined;
      continue;
    }
    if (mark) { fence = mark; continue; }
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) out.push(h[1]!);
  }
  return out;
}

export function parseHandbookPage(text: string): HbPage {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] !== "---") return { ok: false, errors: ["no front matter: the file must start with a --- line"] };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { ok: false, errors: ["front matter is not closed with a --- line"] };
  const doc = parseDocument(lines.slice(1, end).join("\n"));
  if (doc.errors.length > 0) return { ok: false, errors: doc.errors.map((e) => `front matter YAML: ${e.message.split("\n")[0]}`) };
  const raw = doc.toJS() as unknown;
  const errors = frontErrors(raw);
  const body = lines.slice(end + 1).join("\n");
  const front = raw as HbFront;
  const sections = sectionsOf(body);
  if (errors.length === 0 && front.type === "practice" && front.status !== "stub") {
    if (JSON.stringify(sections.filter((s) => (PRACTICE_SECTIONS as readonly string[]).includes(s))) !== JSON.stringify(PRACTICE_SECTIONS)) {
      errors.push(`a practice has the sections ${PRACTICE_SECTIONS.map((s) => `## ${s}`).join(", ")}, in that order`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, front, body, lines: lines.length - (lines[lines.length - 1] === "" ? 1 : 0), sections, links: scanLinks(text) };
}

// What a team can change and what LiftOff can ship, without noise: the title, the type, the summary, the stub mark and the
// body, normalized like a quote (NFC, LF, whitespace runs to one space). Not `updated` (a team touches it on every edit), not
// `origin`/`base` (they are the answer to this very question).
export function fingerprint(front: Pick<HbFront, "title" | "type" | "summary" | "status">, body: string): string {
  const head = canonicalize({ title: front.title, type: front.type, summary: front.summary, status: front.status ?? null });
  return createHash("sha256").update(`${head}\n${normalize(body)}`).digest("hex").slice(0, 12);
}
