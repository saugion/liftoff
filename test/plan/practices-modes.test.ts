import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG, cli, repo } from "./helpers.js";

const BASE = CONFIG.replace('version: "0.2"', 'version: "0.5"').replace("    - name: Bug\n", "    - name: Task\n      branchType: chore\n    - name: Bug\n");
const cfg = (practices = "", pilot = "") => BASE + practices + pilot;
const PO = { why: "Shoppers abandon the cart when they must register first", outOfScope: "Social login" };
const text = `## Context\n${PO.why}\n\n## Out of scope\n${PO.outOfScope}\n\n## Acceptance criteria\n* a reset link expires after 24 hours`;
const story = { type: "Story", summary: "Reset password", description: text, po: PO };
const ok = { tickets: [{ ref: "#0", assumptions: [{ id: 1, text: "a reset link expires after 24 hours", answer: "confirmed" }] }] };
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

function run(config: string, tickets: unknown[], review?: unknown, extra: string[] = []) {
  const files: Record<string, string> = { "d.json": JSON.stringify({ tickets }) };
  if (review !== undefined) files["r.json"] = JSON.stringify(review);
  const dir = repo(config, files);
  const out = cli(["draft-tickets", "--root", dir, "--file", "d.json", ...(review !== undefined ? ["--review", "r.json"] : []), ...extra]);
  return { dir, ...out };
}

describe("practices.ticket-po-review", () => {
  it("on is the default: the PO's answers and the review count", () => {
    const { body } = run(cfg(), [{ ...story, po: undefined }]);
    expect(body.practice).toBe("on");
    expect(codes(body.tickets[0].warnings)).toContain("po-decision-missing");
    expect(body).toMatchObject({ ready: false });
  });
  it("off: nothing is asked or judged, no review is needed, `ready` is `allOk`", () => {
    const { body } = run(cfg("practices:\n  ticket-po-review: off\n"), [{ ...story, po: undefined }]);
    expect(body).toMatchObject({ practice: "off", allOk: true, ready: true, review: { ok: true, provided: false } });
    expect(body.tickets[0]).toMatchObject({ warnings: [], po: { why: "not-asked", outOfScope: "not-asked" } });
  });
  it("off: a review file is ignored with a warning; a credential in `po` is still refused; a bad `po` is still an error", () => {
    const off = cfg("practices:\n  ticket-po-review: off\n");
    expect(codes(run(off, [story], { tickets: [] }).body.review.warnings)).toEqual(["review-ignored"]);
    expect(run(off, [story], { tickets: [] }).body.ready).toBe(true);
    expect(codes(run(off, [{ ...story, po: { why: "use ghp_abcdefghijklmnop" } }]).body.tickets[0].errors)).toContain("credential-like");
    expect(codes(run(off, [{ ...story, po: "why" }]).body.tickets[0].errors)).toEqual(["bad-po"]);
  });
  it("nudge: the questions count, the review file is optional; a file that is there must be complete", () => {
    const nudge = cfg("practices:\n  ticket-po-review: nudge\n");
    const none = run(nudge, [story]).body;
    expect(none).toMatchObject({ practice: "nudge", ready: true, review: { provided: false, ok: true } });
    expect(codes(none.review.warnings)).toEqual(["review-skipped"]);
    expect(codes(run(nudge, [{ ...story, po: undefined }]).body.tickets[0].warnings)).toContain("po-decision-missing");
    const bad = run(nudge, [story], { tickets: [{ ref: "#0", assumptions: [{ id: 1, text: "x" }] }] }).body;
    expect(bad.ready).toBe(false);
    expect(codes(bad.review.errors)).toEqual(["assumption-unanswered"]);
  });
  it("parse-ticket and connect-info say what each practice resolved to", () => {
    const dir = repo(cfg("practices:\n  ticket-po-review: nudge\n  verify-first: on\n"), { "t.json": JSON.stringify({ key: "PROJ-1", fields: { summary: "S", issuetype: { name: "Story" }, description: "x" } }) });
    const want = { "ticket-po-review": "nudge", "verify-first": "on", "clean-review": "off" };
    expect(cli(["parse-ticket", "--root", dir, "--file", "t.json"]).body.practices).toEqual(want);
    expect(cli(["connect-info", "--root", dir]).body.practices).toEqual(want);
  });
});

describe("draft-tickets --approve and the pilot metric", () => {
  const events = (dir: string) => {
    const m = cli(["pilot-metrics", "--root", dir]).body;
    return m;
  };
  it("records one event for a ready batch, with counts only, and not twice for the same batch", () => {
    const a = run(cfg("", "pilot: {}\n"), [story], ok, ["--approve"]);
    expect(a.body).toMatchObject({ ready: true, metric: "recorded" });
    const again = cli(["draft-tickets", "--root", a.dir, "--file", "d.json", "--review", "r.json", "--approve"]);
    expect(again.body.metric).toBe("already");
    const m = events(a.dir).ticketReviews ?? events(a.dir);
    expect(events(a.dir)).toMatchObject({ enabled: true, ticketReviews: [{ batches: 1, tickets: 1, questionsAsked: 2, questionsAnswered: 2, assumptions: 1, confirmed: 1, changed: 0, dropped: 0, noEditApprovals: 0, noEditShare: 0 }] });
    expect(m).toBeDefined();
    const file = readFileSync(join(a.dir, ".liftoff", "metrics", `${new Date().toISOString().slice(0, 7)}.jsonl`), "utf8");
    expect(file).not.toMatch(/Shoppers|Social|PROJ|reset/); // no text, no key
  });
  it("a PO who answers nothing and changes nothing is counted as a no-edit approval", () => {
    const a = run(cfg("", "pilot: {}\n"), [{ ...story, po: undefined }], { tickets: [{ ref: "#0", assumptions: [{ id: 1, text: "a reset link expires after 24 hours", answer: "confirmed" }] }] }, ["--approve"]);
    expect(a.body.metric).toBe("recorded");
    expect(events(a.dir)).toMatchObject({ ticketReviews: [{ questionsAsked: 2, questionsAnswered: 0, noEditApprovals: 1, noEditShare: 1 }] });
  });
  it("a batch that is not ready cannot be approved; off and pilot-less configs record nothing", () => {
    const bad = run(cfg("", "pilot: {}\n"), [story], undefined, ["--approve"]);
    expect(bad).toMatchObject({ exitCode: 1 });
    expect(codes(bad.body.errors)).toEqual(["ticket-draft-invalid"]);
    expect(run(cfg("practices:\n  ticket-po-review: off\n", "pilot: {}\n"), [story], undefined, ["--approve"]).body.metric).toBe("off");
    const none = run(cfg(), [story], ok, ["--approve"]);
    expect(none.body.metric).toBe("off");
    expect(events(none.dir)).toMatchObject({ enabled: false, ticketReviews: [] });
  });
  it("pilot.metrics false turns it off even when the older brain switch is on", () => {
    const a = run(cfg("", "pilot: { metrics: false }\nbrain:\n  lessons: {}\n"), [story], ok, ["--approve"]);
    expect(a.body.metric).toBe("off");
  });
});
