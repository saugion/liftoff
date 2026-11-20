import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { appendEvent, type MetricEvent, readEvents } from "../brain/metrics.js";
import { connectors, metricsOn, practiceMode, projectsOf } from "../config/index.js";
import { resolveReal } from "./fsutil.js";
import { today } from "./lesson-add.js";
import { checkTicket, type ModuleContext } from "../plan/draft.js";
import { checkReview } from "../plan/review.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import type { Handler, Outcome } from "./types.js";

const fail = (code: "no-tracker" | "ticket-draft-invalid" | "tracker-read-only" | "usage", message: string, exitCode: 1 | 2 = 1): Outcome => ({ exitCode, body: { ok: false, errors: [{ code, message }] } });
const MAX_BYTES = 2_000_000;
const MAX_TICKETS = 200;

// Read-only. Checks a batch of drafts against the team config and returns the exact creation calls. Calls nothing.
export const draftTicketsCommand: Handler = ({ root, file, review, approve }) => {
  if (!file) return fail("usage", "draft-tickets needs --file <drafts.json>", 2);
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  const { tracker } = connectors(read.config);
  if (!tracker) return fail("no-tracker", "liftoff.yaml has no tracker: run the Connect skill first");
  if (tracker.server.readOnly) return fail("tracker-read-only", "tracker.server.readOnly is true: the Jira server exposes no write tool");

  let raw: unknown;
  try {
    const path = resolve(root, file);
    if (statSync(path).size > MAX_BYTES) return fail("ticket-draft-invalid", `${file} is larger than ${MAX_BYTES} bytes`);
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return fail("ticket-draft-invalid", `cannot read ${file} as JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const doc = raw as { project?: unknown; tickets?: unknown };
  if (raw === null || typeof raw !== "object" || !Array.isArray(doc.tickets) || doc.tickets.length === 0) return fail("ticket-draft-invalid", "the file must be {\"project\": \"KEY\", \"tickets\": [ ... ]} with at least one ticket");
  if (doc.tickets.length > MAX_TICKETS) return fail("ticket-draft-invalid", `at most ${MAX_TICKETS} tickets per batch`);
  const wanted = doc.project === undefined ? tracker.project : doc.project;
  const info = projectsOf(read.config).find((p) => p.project === wanted);
  if (!info) return fail("ticket-draft-invalid", `project ${String(wanted)} is neither the tracker's nor a stream's (${projectsOf(read.config).map((p) => p.project).join(", ")})`);

  // `practices.ticket-po-review`: on (the PO's why and scope, a complete review before `ready`), nudge (asked, the review file
  // is optional) or off (the Ticket skill goes back to one approval and these checks judge nothing).
  const mode = practiceMode(read.config, "ticket-po-review");
  const streamOf = new Map<string, string>();
  for (const p of projectsOf(read.config)) if (p.stream?.module) streamOf.set(p.stream.module, p.stream.id);
  const mods: ModuleContext = { modules: new Set((read.config.modules?.items ?? []).map((m) => m.id)), streamOf };
  const tickets = doc.tickets.map((t, i) => checkTicket(t, i, tracker, info, mods, doc.tickets as unknown[], mode));
  // The person's review of what the agent added on its own. The batch is `ready` only when it is complete.
  let reviewRaw: unknown;
  let reviewProblem: string | undefined;
  if (review) {
    try {
      const rp = resolve(root, review);
      if (statSync(rp).size > MAX_BYTES) reviewProblem = `${review} is larger than ${MAX_BYTES} bytes`;
      else reviewRaw = JSON.parse(readFileSync(rp, "utf8"));
    } catch (e) {
      reviewProblem = `cannot read ${review} as JSON: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const descriptions = (doc.tickets as unknown[]).map((t) => (typeof (t as { description?: unknown } | null)?.description === "string" ? (t as { description: string }).description : undefined));
  const none = { total: 0, confirmed: 0, changed: 0, dropped: 0, unanswered: 0 };
  const reviewReport =
    mode === "off"
      ? { provided: review !== undefined, ok: true, errors: [], warnings: review ? [{ code: "review-ignored", message: "practices.ticket-po-review is off: the review file is not read" }] : [], assumptions: none }
      : reviewProblem
        ? { provided: true, ok: false, errors: [{ code: "review-invalid", message: reviewProblem }], warnings: [], assumptions: none }
        : mode === "nudge" && review === undefined
          ? { provided: false, ok: true, errors: [], warnings: [{ code: "review-skipped", message: "no review file: the assumptions are in the preview and one yes approves them (practices.ticket-po-review: nudge)" }], assumptions: none }
          : checkReview(reviewRaw, descriptions);
  const allOk = tickets.every((t) => t.ok);
  const ready = allOk && reviewReport.ok;

  // --approve: the person said yes to this ready batch. Record the counts once (pilot metrics: no key, no text).
  let metric: "recorded" | "already" | "off" = "off";
  if (approve) {
    if (!ready) return fail("ticket-draft-invalid", "the batch is not ready: nothing to approve (fix allOk and the review first)");
    if (mode !== "off" && metricsOn(read.config)) {
      const realRoot = resolveReal(root);
      const h = createHash("sha256").update(JSON.stringify([raw, reviewRaw ?? null])).digest("hex").slice(0, 12);
      const before = readEvents(realRoot);
      if (before.some((e) => e.e === "ticket-reviewed" && e.h === h)) metric = "already";
      else {
        const rev = reviewReport.assumptions;
        const asked = tickets.reduce((n, t) => n + Object.values(t.po).filter((v) => v !== "not-asked").length, 0);
        const answered = tickets.reduce((n, t) => n + Object.values(t.po).filter((v) => v === "answered").length, 0);
        const event: MetricEvent = { e: "ticket-reviewed", t: today(), h, mode, tickets: tickets.length, questionsAsked: asked, questionsAnswered: answered, assumptions: rev.total, confirmed: rev.confirmed, changed: rev.changed, dropped: rev.dropped, noEditApproval: answered === 0 && rev.changed === 0 && rev.dropped === 0 };
        try { appendEvent(realRoot, event); metric = "recorded"; } catch { metric = "off"; } // metrics never change the answer
      }
    }
  }
  return {
    exitCode: 0,
    body: {
      ok: true,
      project: info.project,
      stream: info.stream ? { id: info.stream.id, mode: info.stream.mode, module: info.stream.module ?? null, epics: info.stream.epics } : null,
      inheritedTypes: info.inherited,
      count: tickets.length,
      practice: mode,
      allOk,
      review: reviewReport,
      ready,
      ...(approve && { metric }),
      tickets,
    },
  };
};
