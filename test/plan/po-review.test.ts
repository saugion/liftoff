import { describe, expect, it } from "vitest";
import { asked, checkPo, checkReview } from "../../src/plan/review.js";
import { openPoints } from "../../src/plan/ticket.js";
import { CONFIG, cli, repo } from "./helpers.js";

const WITH = CONFIG.replace("    - name: Bug\n", "    - name: Task\n      branchType: chore\n    - name: Epic\n    - name: Bug\n");
const PO = { why: "Shoppers abandon the cart when they must register first", outOfScope: "Social login" };
const text = `## Context\n${PO.why}\n\n## Out of scope\n${PO.outOfScope}\n\n## Acceptance criteria\n* a reset link expires after 24 hours`;
const story = { type: "Story", summary: "Reset password", description: text, po: PO };

function run(tickets: unknown[], review?: unknown, rawReview?: string) {
  const files: Record<string, string> = { "d.json": JSON.stringify({ tickets }) };
  if (review !== undefined) files["r.json"] = JSON.stringify(review);
  if (rawReview !== undefined) files["r.json"] = rawReview;
  const dir = repo(WITH, files);
  return cli(["draft-tickets", "--root", dir, "--file", "d.json", ...(review !== undefined || rawReview !== undefined ? ["--review", "r.json"] : [])]);
}
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);
const ok = { tickets: [{ ref: "#0", assumptions: [{ id: 1, text: "a reset link expires after 24 hours", answer: "confirmed" }] }] };

describe("which questions a type asks", () => {
  it.each([
    ["Epic", true, true], ["story", true, true], ["User Story", true, true],
    ["Task", true, false], ["Sub-task", true, false], ["Storia", true, false],
    ["Bug", false, false], ["bug", false, false],
  ])("%s: why %s, out of scope %s", (type, why, outOfScope) => expect(asked(type)).toEqual({ why, outOfScope }));
});

describe("po: the person's own words", () => {
  it("answered and carried by the description: no issue", () => {
    expect(checkPo(PO, "Story", text)).toMatchObject({ errors: [], warnings: [], status: { why: "answered", outOfScope: "answered" } });
  });
  it("a question the type asks, left unanswered, is a warning and never an error", () => {
    for (const po of [undefined, {}, { why: "", outOfScope: "  " }, { why: "_TBD_", outOfScope: "_TBD_" }]) {
      const r = checkPo(po, "Story", text);
      expect(r.errors).toEqual([]);
      expect(codes(r.warnings)).toEqual(["po-decision-missing", "po-decision-missing"]);
      expect(r.status).toEqual({ why: "missing", outOfScope: "missing" });
    }
  });
  it("only what the type asks: a task wants the why, a bug nothing", () => {
    expect(checkPo({ why: "Because" }, "Task", "Because").status).toEqual({ why: "answered", outOfScope: "not-asked" });
    expect(checkPo(undefined, "Task", "x").status).toEqual({ why: "missing", outOfScope: "not-asked" });
    expect(checkPo(undefined, "Bug", "x")).toMatchObject({ warnings: [], status: { why: "not-asked", outOfScope: "not-asked" } });
  });
  it("an optional answer that was given is still checked against the description", () => {
    expect(codes(checkPo({ outOfScope: "Social login" }, "Task", "Because").warnings)).toEqual(["po-decision-missing", "po-text-not-in-description"]);
  });
  it("the words must be in the ticket; only whitespace may differ", () => {
    expect(checkPo(PO, "Story", text.replace("Shoppers abandon", "Shoppers   abandon\n")).warnings).toEqual([]);
    expect(codes(checkPo(PO, "Story", "## Context\nA different why\n" + PO.outOfScope).warnings)).toEqual(["po-text-not-in-description"]);
  });
  it("a malformed po is an error", () => {
    for (const po of ["why", [], { why: 1 }, { reason: "x" }]) expect(codes(checkPo(po, "Story", "x").errors)).toEqual(["bad-po"]);
  });
});

describe("review: what the agent added on its own", () => {
  const d = [text];
  it("no file is not ready", () => {
    expect(checkReview(undefined, d)).toMatchObject({ provided: false, ok: false });
    expect(codes(checkReview(undefined, d).errors)).toEqual(["review-missing"]);
  });
  it("every ticket needs an entry, an empty one is fine", () => {
    expect(codes(checkReview({ tickets: [] }, d).errors)).toEqual(["review-ticket-missing"]);
    expect(checkReview({ tickets: [{ ref: "#0", assumptions: [] }] }, d).ok).toBe(true);
  });
  it("answers: confirmed, changed (with the new text) and dropped are counted", () => {
    const r = checkReview({ tickets: [{ ref: "#0", assumptions: [
      { id: 1, text: "a reset link expires after 24 hours", answer: "confirmed" },
      { id: 2, text: "old", answer: "changed", final: "Shoppers abandon the cart when they must register first" },
      { id: 3, text: "gone", answer: "dropped" },
    ] }] }, d);
    expect(r).toMatchObject({ ok: true, errors: [], warnings: [], assumptions: { total: 3, confirmed: 1, changed: 1, dropped: 1, unanswered: 0 } });
  });
  it("an assumption nobody answered stops the batch", () => {
    const r = checkReview({ tickets: [{ ref: "#0", assumptions: [{ id: 1, text: "x" }, { id: 2, text: "y", answer: "yes" }] }] }, d);
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toEqual(["assumption-unanswered", "assumption-invalid"]);
    expect(r.assumptions).toMatchObject({ total: 2, unanswered: 2 });
  });
  it("changed needs the text the person wants; ids are unique and integers", () => {
    const r = checkReview({ tickets: [{ ref: "#0", assumptions: [
      { id: 1, text: "x", answer: "changed" }, { id: 1, text: "y", answer: "dropped" }, { id: "2", text: "z", answer: "dropped" }, { id: 3, text: " ", answer: "dropped" },
    ] }] }, d);
    expect(codes(r.errors)).toEqual(["assumption-invalid", "assumption-invalid", "assumption-invalid", "assumption-invalid"]);
  });
  it("refs: a ticket of the batch, once", () => {
    expect(codes(checkReview({ tickets: [{ ref: "#0", assumptions: [] }, { ref: "#0", assumptions: [] }] }, d).errors)).toEqual(["review-ref"]);
    expect(codes(checkReview({ tickets: [{ ref: "#3", assumptions: [] }, { assumptions: [] }, "x"] }, d).errors)).toEqual(["review-ref", "review-ref", "review-ref", "review-ticket-missing"]);
  });
  it("the shape is checked", () => {
    for (const raw of [[], "x", { tickets: "x" }, {}]) expect(codes(checkReview(raw, d).errors)).toEqual(["review-invalid"]);
    expect(codes(checkReview({ tickets: [{ ref: "#0" }] }, d).errors)).toEqual(["review-invalid"]);
  });
  it("what the person settled must show in the description (a warning)", () => {
    const w = checkReview({ tickets: [{ ref: "#0", assumptions: [
      { id: 1, text: "not there", answer: "confirmed" },
      { id: 2, text: "a reset link expires after 24 hours", answer: "dropped" },
      { id: 3, text: "x", answer: "changed", final: "48 hours" },
    ] }] }, d);
    expect(w.ok).toBe(true);
    expect(codes(w.warnings)).toEqual(["assumption-not-in-description", "assumption-still-in-description", "assumption-not-in-description"]);
  });
  it("a credential in an assumption is refused", () => {
    expect(codes(checkReview({ tickets: [{ ref: "#0", assumptions: [{ id: 1, text: "use ghp_abcdefghijklmnop", answer: "dropped" }] }] }, d).errors)).toContain("credential-like");
  });
});

describe("draft-tickets with --review", () => {
  it("a complete review makes the batch ready", () => {
    const { exitCode, body } = run([story], ok);
    expect(exitCode).toBe(0);
    expect(body).toMatchObject({ allOk: true, ready: true, review: { provided: true, ok: true, assumptions: { total: 1, confirmed: 1 } } });
    expect(body.tickets[0]).toMatchObject({ warnings: [], po: { why: "answered", outOfScope: "answered" } });
  });
  it("without a review file the batch is valid but not ready", () => {
    const { body } = run([story]);
    expect(body).toMatchObject({ allOk: true, ready: false });
    expect(codes(body.review.errors)).toEqual(["review-missing"]);
  });
  it("an unanswered assumption is not ready; the creation calls are still checked", () => {
    const { body } = run([story], { tickets: [{ ref: "#0", assumptions: [{ id: 1, text: "x" }] }] });
    expect(body).toMatchObject({ allOk: true, ready: false });
    expect(codes(body.review.errors)).toEqual(["assumption-unanswered"]);
  });
  it("a skipped why: the ticket can be created with the warning, nothing is guessed", () => {
    const { body } = run([{ ...story, po: { outOfScope: PO.outOfScope } }], { tickets: [{ ref: "#0", assumptions: [] }] });
    expect(body.ready).toBe(true);
    expect(body.tickets[0]).toMatchObject({ ok: true, po: { why: "missing", outOfScope: "answered" } });
    expect(codes(body.tickets[0].warnings)).toEqual(["po-decision-missing"]);
  });
  it("an invalid ticket is not ready even with a complete review", () => {
    expect(run([{ ...story, summary: " " }], ok).body).toMatchObject({ allOk: false, ready: false });
  });
  it("a review file that cannot be read says so and is not ready", () => {
    const { exitCode, body } = run([story], undefined, "{ not json");
    expect(exitCode).toBe(0);
    expect(body.ready).toBe(false);
    expect(codes(body.review.errors)).toEqual(["review-invalid"]);
    expect(run([story], { tickets: [] }).body.review.errors[0].code).toBe("review-ticket-missing");
  });
  it("a bad po on a ticket is an error on that ticket", () => {
    expect(codes(run([{ ...story, po: "why" }], ok).body.tickets[0].errors)).toEqual(["bad-po"]);
  });
  it("--review belongs to draft-tickets only", () => {
    const dir = repo(WITH, { "r.json": "{}" });
    expect(cli(["check-config", "--root", dir, "--review", "r.json"])).toMatchObject({ exitCode: 2 });
  });
  it("the answers are checked for credentials too", () => {
    const secret = "ghp_abcdefghijklmnop";
    expect(codes(run([{ ...story, po: { why: `use ${secret}`, outOfScope: PO.outOfScope } }], ok).body.tickets[0].errors)).toContain("credential-like");
  });
});

describe("parse-ticket and _TBD_", () => {
  const parse = (description: string) => {
    const dir = repo(WITH, { "t.json": JSON.stringify({ key: "PROJ-1", fields: { summary: "S", issuetype: { name: "Story" }, description } }) });
    return cli(["parse-ticket", "--root", dir, "--file", "t.json"]).body;
  };
  it("lists the open points with the section they sit in, and warns", () => {
    const b = parse("## Context\n_TBD_\n\n## Out of scope\nSocial login\n\n## Acceptance criteria\n* ok\n\n### Notes\nsee _TBD_ later");
    expect(b.openPoints).toEqual([{ section: "Context", line: "_TBD_" }, { section: "Notes", line: "see _TBD_ later" }]);
    expect(codes(b.warnings)).toContain("tbd-open-points");
    expect(b.warnings.find((w: any) => w.code === "tbd-open-points").message).toContain("Context, Notes");
  });
  it("a ticket with nothing open has none", () => {
    const b = parse("## Context\nx\n\n## Acceptance criteria\n* y");
    expect(b.openPoints).toEqual([]);
    expect(codes(b.warnings)).not.toContain("tbd-open-points");
  });
  it("reads Jira wiki headings and HTML too", () => {
    expect(openPoints("h2. Why\n_TBD_")).toEqual([{ section: "Why", line: "_TBD_" }]);
    expect(openPoints("<h2>Why</h2><p>_TBD_</p>")).toEqual([{ section: "Why", line: "_TBD_" }]);
    expect(openPoints("_TBD_ before any heading")).toEqual([{ section: "", line: "_TBD_ before any heading" }]);
  });
});
