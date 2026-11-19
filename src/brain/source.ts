import { createHash } from "node:crypto";

export const KINDS = ["ticket", "plan", "mr", "doc"] as const;
export type SourceKind = (typeof KINDS)[number];

export const MAX_SOURCE_BYTES = 256 * 1024;
export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

// First line of every raw file; the checker (brain-check) re-hashes the body against it.
export const headerLine = (kind: SourceKind, id: string, from: string, bodySha: string): string =>
  `<!-- liftoff brain source; kind: ${kind}; id: ${id}; from: ${from.replace(/-->/g, "--").replace(/\s+/g, " ").trim()}; body-sha256:${bodySha} -->`;

// A verbatim text source: UTF-8, LF line endings, no NUL, within the size limit. Returns the body or the reason.
export function cleanText(buf: Buffer): { body: string } | { error: string } {
  if (buf.length > MAX_SOURCE_BYTES) return { error: `larger than ${MAX_SOURCE_BYTES / 1024} KB` };
  if (buf.includes(0)) return { error: "not a text file (it has a NUL byte)" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return { error: "not valid UTF-8" };
  }
  const body = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  return Buffer.byteLength(body) > MAX_SOURCE_BYTES ? { error: `larger than ${MAX_SOURCE_BYTES / 1024} KB` } : { body };
}

// Name = <id>-<first 8 hex of the body hash>: the same content is the same file on every machine and branch.
export function sourceFile(kind: SourceKind, id: string, from: string, body: string) {
  const sha = sha256Hex(body);
  return { rel: `raw/${kind}s/${id}-${sha.slice(0, 8)}.md`, sha, content: `${headerLine(kind, id, from, sha)}\n${body}` };
}

export interface TicketBody {
  key: string;
  summary: string;
  issueType: string;
  description: string;
  criteria: string;
}

// Only what the page quotes from: no status, comments, people or custom fields.
export function ticketBody(t: TicketBody): string {
  const parts = [`# ${t.key} ${t.summary}`.trim(), `Type: ${t.issueType}`];
  if (t.description) parts.push(`## Description\n\n${t.description}`);
  if (t.criteria) parts.push(`## Acceptance criteria\n\n${t.criteria}`);
  return parts.join("\n\n").replace(/\r\n?/g, "\n") + "\n";
}
