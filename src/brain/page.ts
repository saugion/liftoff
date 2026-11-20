import { parseDocument } from "yaml";

// Pure: text in, structure out. No fs. Line numbers are 1-based and count from the top of the file.

export const PAGE_TYPES = ["module", "decision", "learning", "topic"] as const;
export type PageType = (typeof PAGE_TYPES)[number];
const KEYS = ["title", "type", "updated", "summary", "sources", "module"];

export interface Front {
  title: string;
  type: PageType;
  updated: string;
  summary: string;
  sources: string[];
  module?: string;
}
export interface Link { target: string; line: number } // relative target, anchor stripped
export interface Quote { text: string; citation?: { label: string; path: string }; line: number } // text is normalized
export type Page =
  | { ok: true; front: Front; links: Link[]; quotes: Quote[] }
  | { ok: false; errors: string[] };

// What a quote is compared with: NFC, CRLF to LF, every whitespace run (NBSP included) to one space, trimmed.
export const normalize = (s: string): string => s.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();

const oneLine = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\r\n]/.test(v);
const realDate = (v: unknown): boolean => {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
};

// Front matter problems, one message each. Empty means valid.
export function frontErrors(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return ["front matter must be a YAML mapping"];
  const f = raw as Record<string, unknown>;
  const errors = Object.keys(f).filter((k) => !KEYS.includes(k)).map((k) => `unknown key '${k}'`);
  if (!oneLine(f.title, 120)) errors.push("title must be one line of 1-120 characters");
  if (!PAGE_TYPES.includes(f.type as PageType)) errors.push(`type must be one of ${PAGE_TYPES.join(", ")}`);
  if (!realDate(f.updated)) errors.push("updated must be a real date, YYYY-MM-DD");
  if (!oneLine(f.summary, 160)) errors.push("summary must be one line of 1-160 characters");
  if (!Array.isArray(f.sources) || f.sources.length === 0 || !f.sources.every((s) => typeof s === "string" && s !== "")) errors.push("sources must be a non-empty list of paths");
  if (f.module !== undefined && !oneLine(f.module, 120)) errors.push("module must be a module id");
  return errors;
}

// Blank out `code spans` so a link or quote marker inside one is not seen.
const withoutCodeSpans = (line: string): string => line.replace(/(`+)[^`]*?\1/g, (m) => " ".repeat(m.length));

const LINK = /\[[^\]]*\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g;
const CITATION = /^--\s*\[([^\]]*)\]\(\s*<?([^)\s>]+)>?\s*\)\s*$/;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

// Links and quote blocks of a Markdown body, from line index `from`. Code spans and fenced blocks are ignored.
function scan(lines: string[], from: number): { links: Link[]; quotes: Quote[] } {
  const links: Link[] = [];
  const quotes: Quote[] = [];
  let fence: string | undefined;
  let block: { line: number; rows: string[] } | undefined;
  const closeBlock = () => {
    if (!block) return;
    const rows = block.rows;
    const last = rows.length > 0 ? CITATION.exec(rows[rows.length - 1]!.trim()) : null;
    const body = last ? rows.slice(0, -1) : rows;
    quotes.push({ text: normalize(body.join("\n")), ...(last && { citation: { label: last[1]!, path: last[2]! } }), line: block.line });
    block = undefined;
  };

  for (let i = from; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      if (fenceMark && fenceMark[0] === fence[0] && fenceMark.length >= fence.length) fence = undefined;
      continue;
    }
    if (fenceMark) {
      closeBlock();
      fence = fenceMark;
      continue;
    }
    const visible = withoutCodeSpans(line);
    for (const m of visible.matchAll(LINK)) {
      const target = m[1]!.split("#")[0]!;
      if (target !== "" && !EXTERNAL.test(target)) links.push({ target, line: i + 1 });
    }
    const quoted = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (quoted) {
      block ??= { line: i + 1, rows: [] };
      block.rows.push(quoted[1]!);
    } else closeBlock();
  }
  closeBlock();
  return { links, quotes };
}

// Relative links of any Markdown text (no front matter needed): hot.md, README.md and the like.
export const scanLinks = (text: string): Link[] => scan(text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n"), 0).links;

// Quote blocks of a Markdown file that starts with front matter (any keys): for pages with their own front matter validator.
export function quotesOf(text: string): Quote[] {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  return scan(lines, end + 1).quotes;
}

export function parsePage(text: string): Page {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] !== "---") return { ok: false, errors: ["no front matter: the file must start with a --- line"] };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { ok: false, errors: ["front matter is not closed with a --- line"] };

  const doc = parseDocument(lines.slice(1, end).join("\n"));
  if (doc.errors.length > 0) return { ok: false, errors: doc.errors.map((e) => `front matter YAML: ${e.message.split("\n")[0]}`) };
  const raw = doc.toJS() as unknown;
  const errors = frontErrors(raw);
  if (errors.length > 0) return { ok: false, errors };

  const { links, quotes } = scan(lines, end + 1);
  return { ok: true, front: raw as Front, links, quotes };
}
