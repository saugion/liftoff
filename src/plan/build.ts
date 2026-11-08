import type { CodeHostConfig, IssueType, TrackerConfig } from "../config/index.js";
import { shQuote } from "../connect/shell.js";
import type { Ticket } from "./ticket.js";

export const KEY_RE = /^([A-Z][A-Z0-9_]+)-[0-9]+$/;
export const planFile = (key: string) => `.liftoff/plans/${key}.md`;
export const mrDescriptionFile = (key: string) => `.liftoff/plans/${key}.mr.md`;

// Lowercase ASCII words joined by '-', at most 40 chars, no leading or trailing '-'.
export function slugify(s: string, max = 40): string {
  const slug = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
  return slug || "work";
}

const fill = (pattern: string, values: Record<string, string>) => pattern.replace(/\{(key|slug|type|summary)\}/g, (_m, k: string) => values[k] ?? "");

// A git ref the shell and git both accept, whatever literal text the pattern had.
function safeBranch(name: string): string {
  const b = name.replace(/[^A-Za-z0-9._/-]+/g, "-").replace(/\.{2,}/g, ".").replace(/\/{2,}/g, "/").replace(/^[-/.]+|[/.-]+$/g, "").replace(/\.lock$/, "");
  return b || "work";
}

export interface BuildInfo {
  branch: string;
  title: string;
  targetBranch: string | null;
  labels: string[];
  reviewers: string[];
  mrTemplate: string | null;
  transitions: { start: { name: string; fields?: Record<string, unknown> } | null; review: { name: string; fields?: Record<string, unknown> } | null };
  readOnly: boolean;
  planFile: string;
  mrDescriptionFile: string;
  mrCreate: string | null;
}

export function buildInfo(t: Ticket, tracker: TrackerConfig, type: IssueType | undefined, codeHost: CodeHostConfig | undefined): BuildInfo {
  const conv = codeHost?.conventions;
  const typeWord = type?.branchType ?? slugify(t.issueType || "task");
  const branch = safeBranch(fill(conv?.branchPattern ?? "{key}-{slug}", { key: t.key, slug: slugify(t.summary), type: typeWord }));
  const title = fill(conv?.titlePattern ?? "{key}: {summary}", { key: t.key, summary: t.summary.replace(/\s+/g, " ").trim().slice(0, 120), type: t.issueType });
  const labels = conv?.labels ?? [];
  const reviewers = conv?.reviewers ?? [];
  const descFile = mrDescriptionFile(t.key);
  const mrCreate = codeHost
    ? [
        "glab mr create",
        `--source-branch ${shQuote(branch)}`,
        ...(conv?.targetBranch ? [`--target-branch ${shQuote(conv.targetBranch)}`] : []),
        `--title ${shQuote(title)}`,
        `--description-file ${shQuote(descFile)}`,
        ...labels.map((l) => `--label ${shQuote(l)}`),
        ...reviewers.map((r) => `--reviewer ${shQuote(r)}`),
        "--yes",
      ].join(" ")
    : null;
  const readOnly = tracker.server.readOnly;
  return {
    branch,
    title,
    targetBranch: conv?.targetBranch ?? null,
    labels,
    reviewers,
    mrTemplate: conv?.mrTemplate ?? null,
    transitions: { start: readOnly ? null : (type?.transitions.start ?? null), review: readOnly ? null : (type?.transitions.review ?? null) },
    readOnly,
    planFile: planFile(t.key),
    mrDescriptionFile: descFile,
    mrCreate,
  };
}
