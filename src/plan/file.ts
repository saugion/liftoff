import { parse, stringify } from "yaml";
import { secretGuard } from "../config/secrets.js";
import { sha256 } from "../config/hash.js";

export interface PlanSection {
  n: number;
  title: string;
  done: number;
  total: number;
}

export type PlanRead =
  | { ok: false; errors: string[] }
  | { ok: true; status: "draft" | "approved"; approvedHash?: string; sections: PlanSection[]; hash: string; frontMatter: Record<string, unknown>; body: string; crlf: boolean };

// Checkbox state is progress, and a `Note:` line is the engineer's or the agent's record of a deviation: neither is
// content, so neither may undo an approval.
export function bodyHash(body: string): string {
  const content = body.replace(/\r\n/g, "\n").split("\n").filter((l) => !/^\s*Note:/.test(l)).join("\n");
  return sha256(content.replace(/\[[xX]\]/g, "[ ]").replace(/\n{3,}/g, "\n\n").trim());
}

export function readPlan(text: string, key: string): PlanRead {
  const crlf = text.includes("\r\n");
  const lf = text.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(lf);
  if (!m) return { ok: false, errors: ["the plan must start with a front matter block (---)"] };
  let fm: unknown;
  try {
    fm = parse(m[1]!);
  } catch {
    return { ok: false, errors: ["the front matter is not valid YAML"] };
  }
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) return { ok: false, errors: ["the front matter must be a mapping"] };
  const front = fm as Record<string, unknown>;
  const errors: string[] = [];
  if (front.ticket !== key) errors.push(`front matter ticket must be ${key}`);
  if (front.status !== "draft" && front.status !== "approved") errors.push("front matter status must be draft or approved");
  if (front.status === "approved" && typeof front.approvedHash !== "string") errors.push("an approved plan needs approvedHash");
  const body = m[2]!;

  const sections: PlanSection[] = [];
  for (const line of body.split("\n")) {
    const h = /^##\s+(\d+)\.\s+(.+?)\s*$/.exec(line);
    if (h) sections.push({ n: Number(h[1]), title: h[2]!, done: 0, total: 0 });
    else if (/^##\s/.test(line)) errors.push(`a section heading must look like "## 1. Title": ${line.trim()}`);
    else {
      const box = /^\s*[-*]\s+\[([ xX])\]\s+\S/.exec(line);
      const cur = sections[sections.length - 1];
      if (box && cur) {
        cur.total++;
        if (box[1] !== " ") cur.done++;
      }
    }
  }
  if (sections.length === 0) errors.push("the plan needs at least one section (## 1. Title)");
  sections.forEach((s, i) => {
    if (s.n !== i + 1) errors.push(`sections must be numbered 1..n without gaps (found ${s.n} at position ${i + 1})`);
    if (s.total === 0) errors.push(`section ${s.n} has no checkbox item ("- [ ] step")`);
  });
  if (secretGuard({ text }).length > 0) errors.push("the plan text looks like a credential; credentials never go in a plan");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    status: front.status as "draft" | "approved",
    ...(typeof front.approvedHash === "string" && { approvedHash: front.approvedHash }),
    sections,
    hash: bodyHash(body),
    frontMatter: front,
    body,
    crlf,
  };
}

// Same plan with status approved and the hash of its body; everything else byte for byte (EOL style kept).
export function approvedText(p: Extract<PlanRead, { ok: true }>): string {
  const fm = stringify({ ...p.frontMatter, status: "approved", approvedHash: p.hash }).trimEnd();
  const text = `---\n${fm}\n---\n${p.body}`;
  return p.crlf ? text.replace(/\n/g, "\r\n") : text;
}
