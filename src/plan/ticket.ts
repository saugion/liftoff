// Reads the JSON a Jira MCP server returned for one issue, the way the team's reading map says to read it.
// Tolerant on purpose: the exact shape differs between servers and versions, so every lookup tries the
// plausible places. Pure: text in, data out.
import type { IssueType } from "../config/index.js";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);

export interface Ticket {
  key: string;
  summary: string;
  issueType: string;
  status?: string;
  description: string;
  rendered?: string; // renderedFields.description, when present
  raw: Json;
}

// Text of any value a field can hold: a string, a number, a list, or an object with value/name/displayName.
export function flatten(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(flatten).filter(Boolean).join(", ");
  if (isObj(v)) {
    for (const k of ["value", "name", "displayName", "text"]) if (v[k] !== undefined && v[k] !== null) return flatten(v[k]);
    return JSON.stringify(v);
  }
  return "";
}

// First place that has a value: top level, then `fields`, then `custom_fields`.
function lookup(raw: Json, id: string): unknown {
  for (const holder of [raw, raw.fields, raw.custom_fields]) {
    if (isObj(holder) && holder[id] !== undefined && holder[id] !== null) return holder[id];
  }
  return undefined;
}

export function readTicket(text: string): Ticket | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "the ticket file is not valid JSON" };
  }
  if (!isObj(raw)) return { error: "the ticket file must hold a JSON object" };
  const key = flatten(raw.key);
  if (!key) return { error: "the ticket has no `key`" };
  const type = lookup(raw, "issue_type") ?? lookup(raw, "issuetype");
  const rendered = isObj(raw.renderedFields) ? flatten(raw.renderedFields.description) : "";
  return {
    key,
    summary: flatten(lookup(raw, "summary")),
    issueType: flatten(type),
    ...(lookup(raw, "status") !== undefined && { status: flatten(lookup(raw, "status")) }),
    description: flatten(lookup(raw, "description")),
    ...(rendered && { rendered }),
    raw,
  };
}

export function fieldText(t: Ticket, id: string): string {
  return flatten(lookup(t.raw, id));
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

// Rendered HTML to lines of Markdown-ish text, so one heading scanner serves all three formats.
function fromHtml(s: string): string {
  return s
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, t: string) => `\n${"#".repeat(Number(n))} ${t}\n`)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e]!);
}

const normTitle = (s: string) => s.replace(/<[^>]+>/g, "").replace(/[*_:#]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// The heading a line is, if any, with its level: Markdown `# x`, Jira wiki `h2. x` (1-6), or a line that is only
// bold `*x*` (level 7, below every real heading: real tickets use bold lines for labels like "Scenario 1").
function headingOf(line: string): { level: number; title: string } | undefined {
  const md = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
  if (md) return { level: md[1]!.length, title: md[2]! };
  const wiki = /^\s*h([1-6])\.\s+(.*?)\s*$/.exec(line);
  if (wiki) return { level: Number(wiki[1]), title: wiki[2]! };
  const bold = /^\s*\*{1,2}([^*\n]+?)\*{1,2}:?\s*$/.exec(line);
  return bold ? { level: 7, title: bold[1]! } : undefined;
}

// Text under the first heading called `title` (case-insensitive), up to the next heading of the same or a higher
// level ("" when not found). Sub-headings and bold labels inside the section belong to it; a section opened by a
// bold line ends at the next heading of any kind.
export function underHeading(text: string, title: string): string {
  const lines = (/<h[1-6]/i.test(text) ? fromHtml(text) : text).split(/\r?\n/);
  const want = normTitle(title);
  const start = lines.findIndex((l) => {
    const h = headingOf(l);
    return h !== undefined && normTitle(h.title) === want;
  });
  if (start < 0) return "";
  const level = headingOf(lines[start]!)!.level;
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    const h = headingOf(l);
    if (h !== undefined && (level === 7 || (h.level !== 7 && h.level <= level))) break;
    body.push(l);
  }
  return body.join("\n").trim();
}

// Titles of the headings in a text (Markdown, wiki or HTML), lowercased and cleaned. Bold-only lines count when asked.
export function headingTitles(text: string, includeBold = false): string[] {
  const lines = (/<h[1-6]/i.test(text) ? fromHtml(text) : text).split(/\r?\n/);
  return lines.flatMap((l) => {
    const h = headingOf(l);
    return h && (includeBold || h.level < 7) ? [normTitle(h.title)] : [];
  });
}

export interface Reading {
  acceptanceCriteria: { source: "heading" | "field" | "none"; text: string };
  fields: { id: string; label: string; value: string }[];
  missing: string[]; // ids of configured fields that have no value on this ticket
}

export function readWithMap(t: Ticket, type: IssueType | undefined): Reading {
  const ac = type?.readingMap.acceptanceCriteria;
  let acceptanceCriteria: Reading["acceptanceCriteria"] = { source: "none", text: "" };
  if (ac && "field" in ac) {
    const text = fieldText(t, ac.field);
    if (text) acceptanceCriteria = { source: "field", text };
  } else {
    const title = ac && "heading" in ac ? ac.heading : "Acceptance criteria";
    const text = underHeading(t.description, title) || (t.rendered ? underHeading(t.rendered, title) : "");
    if (text) acceptanceCriteria = { source: "heading", text };
  }
  const fields = (type?.readingMap.fields ?? []).map((f) => ({ id: f.id, label: f.label, value: fieldText(t, f.id) }));
  return { acceptanceCriteria, fields: fields.filter((f) => f.value), missing: fields.filter((f) => !f.value).map((f) => f.id) };
}
