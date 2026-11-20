import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { Config } from "../config/index.js";
import { parseBlock } from "./lessons-block.js";

// Local pilot metrics, written only when brain.lessons.metrics is true. Nothing here leaves the machine: the files sit
// under the self-ignored .liftoff/, and the summary carries no ticket key, rule, path or name.

export const METRICS_DIR = ".liftoff/metrics";
export { metricsOn } from "../config/practices.js";

const h8 = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 8);

export interface SectionHash { title: string; body: string }
// Per section of a plan body: a hash of its title and one of its content (checkbox state and Note: lines are progress,
// not content, as for the plan's own approval hash).
export function sectionHashes(body: string): SectionHash[] {
  const out: { title: string; lines: string[] }[] = [];
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const hd = /^##\s+\d+\.\s+(.+?)\s*$/.exec(line);
    if (hd) out.push({ title: hd[1]!, lines: [] });
    else if (out.length > 0 && !/^\s*Note:/.test(line)) out[out.length - 1]!.lines.push(line.replace(/\[[xX]\]/g, "[ ]").trimEnd());
  }
  return out.map((s) => ({ title: h8(s.title), body: h8(s.lines.join("\n").trim()) }));
}

export function compareSections(before: SectionHash[], after: SectionHash[]): { sections: number; changed: number; added: number; removed: number } {
  const common = Math.min(before.length, after.length);
  let changed = 0;
  for (let i = 0; i < common; i++) if (before[i]!.title !== after[i]!.title || before[i]!.body !== after[i]!.body) changed++;
  return { sections: after.length, changed, added: Math.max(0, after.length - before.length), removed: Math.max(0, before.length - after.length) };
}

export const draftFile = (key: string): string => `${METRICS_DIR}/drafts/${key}.json`;
const eventFile = (date: string): string => `${METRICS_DIR}/${date.slice(0, 7)}.jsonl`;

export type MetricEvent =
  | { e: "plan-approved"; t: string; key: string; sections: number; changed: number; added: number; removed: number; approval: number; afterBuildStart: boolean; brainPages: number; lessonRules: number }
  | { e: "correction"; t: string; key: string; skill: string; kind: string; brainPages: number; lessonRules: number }
  // The PO's review of a ticket batch (Ticket skill). No key, no text: counts only. `h` makes it once per batch.
  | { e: "ticket-reviewed"; t: string; h: string; mode: "on" | "nudge"; tickets: number; questionsAsked: number; questionsAnswered: number; assumptions: number; confirmed: number; changed: number; dropped: number; noEditApproval: boolean };

export function appendEvent(realRoot: string, event: MetricEvent): void {
  const file = join(realRoot, eventFile(event.t));
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(event) + "\n");
}

export function readEvents(realRoot: string): MetricEvent[] {
  const dir = join(realRoot, METRICS_DIR);
  if (!existsSync(dir)) return [];
  const events: MetricEvent[] = [];
  for (const n of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
    for (const line of readFileSync(join(dir, n), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const e = JSON.parse(line) as MetricEvent;
        if (e && (e.e === "plan-approved" || e.e === "correction" || e.e === "ticket-reviewed") && typeof e.t === "string") events.push(e);
      } catch {
        // a damaged line is skipped: metrics never break anything
      }
    }
  }
  return events;
}

// Wiki pages and team-block rules right now: the "with / without brain" split of one repo over time.
export function brainSize(realRoot: string, config: Config): { brainPages: number; lessonRules: number } {
  const wiki = join(realRoot, (config.brain?.dir ?? "brain").replace(/\/+$/, ""), "wiki");
  const pages = (d: string): number => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? pages(join(d, e.name)) : e.name.endsWith(".md") ? 1 : 0), 0) : 0);
  const files = ["AGENTS.md", ...(config.modules?.items ?? []).map((m) => `${m.path.replace(/\/+$/, "")}/AGENTS.md`), config.constraints?.file ?? "CONSTRAINTS.md"];
  let lessonRules = 0;
  for (const f of files) if (existsSync(join(realRoot, f))) lessonRules += parseBlock(readFileSync(join(realRoot, f), "utf8")).rules.length;
  return { brainPages: pages(wiki), lessonRules };
}

export const bucketOf = (e: { brainPages: number; lessonRules: number }): "empty" | "brain" => (e.brainPages === 0 && e.lessonRules === 0 ? "empty" : "brain");

export interface BucketSummary {
  tickets: number;
  approvals: number;
  meanChangedSections: number;
  reApprovalsAfterBuildStart: number;
  corrections: number;
  correctionsPerTicket: number;
  correctionsBySkill: Record<string, number>;
  correctionsByKind: Record<string, number>;
  notesPerTicket: number;
}
export interface MonthSummary { month: string; empty: BucketSummary | null; brain: BucketSummary | null }

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Aggregate by month and bucket. `notesOf(key)` is the number of Note: deviation lines in that ticket's plan today.
export function summarize(all: MetricEvent[], notesOf: (ticketKey: string) => number): MonthSummary[] {
  const events = all.filter((e): e is Exclude<MetricEvent, { e: "ticket-reviewed" }> => e.e !== "ticket-reviewed");
  const months = [...new Set(events.map((e) => e.t.slice(0, 7)))].sort();
  return months.map((month) => {
    const summaryOf = (bucket: "empty" | "brain"): BucketSummary | null => {
      const inB = events.filter((e) => e.t.startsWith(month) && bucketOf(e) === bucket);
      const plans = inB.filter((e): e is Extract<MetricEvent, { e: "plan-approved" }> => e.e === "plan-approved");
      const corr = inB.filter((e): e is Extract<MetricEvent, { e: "correction" }> => e.e === "correction");
      if (inB.length === 0) return null;
      const tickets = new Set(plans.map((p) => p.key));
      const count = (xs: string[]): Record<string, number> => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
      const notes = [...tickets].reduce((n, k) => n + notesOf(k), 0);
      return {
        tickets: tickets.size,
        approvals: plans.length,
        meanChangedSections: plans.length === 0 ? 0 : round2(plans.reduce((n, p) => n + p.changed, 0) / plans.length),
        reApprovalsAfterBuildStart: plans.filter((p) => p.approval > 1 && p.afterBuildStart).length,
        corrections: corr.length,
        correctionsPerTicket: tickets.size === 0 ? 0 : round2(corr.length / tickets.size),
        correctionsBySkill: count(corr.map((c) => c.skill)),
        correctionsByKind: count(corr.map((c) => c.kind)),
        notesPerTicket: tickets.size === 0 ? 0 : round2(notes / tickets.size),
      };
    };
    return { month, empty: summaryOf("empty"), brain: summaryOf("brain") };
  });
}

export interface TicketReviewSummary {
  month: string;
  batches: number;
  tickets: number;
  questionsAsked: number;
  questionsAnswered: number;
  assumptions: number;
  confirmed: number;
  changed: number;
  dropped: number;
  noEditApprovals: number;
  noEditShare: number; // noEditApprovals / batches: the alarm for a PO who delegates everything
}

// By month. `noEditApproval` is an approximation: it does not see edits made to the drafts after the review.
export function summarizeTicketReviews(events: MetricEvent[]): TicketReviewSummary[] {
  const mine = events.filter((e): e is Extract<MetricEvent, { e: "ticket-reviewed" }> => e.e === "ticket-reviewed");
  return [...new Set(mine.map((e) => e.t.slice(0, 7)))].sort().map((month) => {
    const m = mine.filter((e) => e.t.startsWith(month));
    const sum = (f: (e: (typeof m)[number]) => number) => m.reduce((n, e) => n + f(e), 0);
    const noEdit = m.filter((e) => e.noEditApproval).length;
    return {
      month, batches: m.length, tickets: sum((e) => e.tickets), questionsAsked: sum((e) => e.questionsAsked), questionsAnswered: sum((e) => e.questionsAnswered),
      assumptions: sum((e) => e.assumptions), confirmed: sum((e) => e.confirmed), changed: sum((e) => e.changed), dropped: sum((e) => e.dropped),
      noEditApprovals: noEdit, noEditShare: m.length === 0 ? 0 : round2(noEdit / m.length),
    };
  });
}
