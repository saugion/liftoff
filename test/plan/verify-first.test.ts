import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkVerify } from "../../src/plan/verify.js";
import { checkCleanReview } from "../../src/plan/cleanreview.js";
import { CONFIG, cli, repo } from "./helpers.js";

const CFG = (verify = "", clean = "") => CONFIG.replace('version: "0.2"', 'version: "0.5"') + (verify || clean ? `practices:\n${verify}${clean}` : "");
const TICKET = (type = "Story", ac = "- a reset link expires after 24 hours\n- an expired link shows an error") =>
  JSON.stringify({ key: "PROJ-1", fields: { summary: "Reset", issuetype: { name: type }, description: `## Acceptance criteria\n${ac}\n`, customfield_10201: ac } });
const PLAN = (items: string[]) => `---\nticket: PROJ-1\nstatus: draft\n---\n# Plan: PROJ-1 Reset\n\n## 1. Expiry\n${items.map((i) => `- [ ] ${i}`).join("\n")}\n\n## 2. Error page\n- [ ] show it\n- [ ] run all\n`;
const put = (dir: string, rel: string, text: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe("checkVerify", () => {
  const AC = [{ id: "AC1", text: "a" }, { id: "AC2", text: "b" }];
  it("a check is a `verify ACn: command` item inside a numbered section", () => {
    const r = checkVerify(PLAN(["write it", "verify AC1: npm test -- reset (red first)"]), AC, false);
    expect(r.criteria).toEqual([{ id: "AC1", text: "a", covered: true, sections: [1] }, { id: "AC2", text: "b", covered: false, sections: [] }]);
    expect(r.uncovered).toEqual(["AC2"]);
  });
  it("is case-insensitive, accepts a manual step as a check, and needs a command after the colon", () => {
    expect(checkVerify(PLAN(["VERIFY ac1: manual: Sara opens the page", "verify AC2:"]), AC, false).uncovered).toEqual(["AC2"]);
    expect(checkVerify(PLAN(["Verify AC1: x"]), AC, false).criteria[0]!.covered).toBe(true);
  });
  it("a bug needs a reproduction, a story does not", () => {
    expect(checkVerify(PLAN(["verify AC1: a", "verify AC2: b"]), AC, true)).toMatchObject({ uncovered: ["repro"], repro: { required: true, present: false } });
    expect(checkVerify(PLAN(["verify AC1: a", "verify AC2: b", "verify repro: npm test -- repro"]), AC, true).uncovered).toEqual([]);
    expect(checkVerify(PLAN([]), [], false).uncovered).toEqual([]);
  });
  it("a check for a criterion the ticket does not have is reported; unknown criteria are not invented", () => {
    expect(checkVerify(PLAN(["verify AC9: x"]), AC, false).unknownRefs).toEqual(["AC9"]);
    expect(checkVerify(PLAN(["verify AC1: x"]), undefined, false)).toMatchObject({ known: false, criteria: [], uncovered: [] });
  });
});

describe("plan with practices.verify-first", () => {
  const setup = (verify: string, items: string[], type = "Story") => {
    const dir = repo(CFG(verify), { ".liftoff/plans/PROJ-1.md": PLAN(items) });
    put(dir, ".liftoff/tmp/PROJ-1.json", TICKET(type));
    return dir;
  };
  it("off (the default): nothing about verification in the answer", () => {
    const dir = setup("", ["x"]);
    expect(cli(["plan", "--root", dir, "--key", "PROJ-1"]).body.verify).toBeUndefined();
  });
  it("nudge: the report and a warning, and the approval goes through", () => {
    const dir = setup("  verify-first: nudge\n", ["verify AC1: npm test"]);
    const r = cli(["plan", "--root", dir, "--key", "PROJ-1"]).body;
    expect(r.verify).toMatchObject({ mode: "nudge", uncovered: ["AC2"] });
    expect(codes(r.warnings)).toContain("criterion-unverified");
    const a = cli(["plan", "--root", dir, "--key", "PROJ-1", "--approve"]);
    expect(a.exitCode).toBe(0);
    expect(a.body.status).toBe("approved");
  });
  it("on: the approval is refused until every criterion has a check, and nothing is approved meanwhile", () => {
    const dir = setup("  verify-first: on\n", ["verify AC1: npm test"]);
    const refused = cli(["plan", "--root", dir, "--key", "PROJ-1", "--approve"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.body.errors[0]).toMatchObject({ code: "criterion-unverified", uncovered: ["AC2"] });
    expect(cli(["plan", "--root", dir, "--key", "PROJ-1"]).body.status).toBe("draft");
    put(dir, ".liftoff/plans/PROJ-1.md", PLAN(["verify AC1: npm test", "verify AC2: npm test -- error"]));
    const ok = cli(["plan", "--root", dir, "--key", "PROJ-1", "--approve"]);
    expect(ok.body).toMatchObject({ status: "approved", approvedValid: true, verify: { uncovered: [] } });
  });
  it("on, a bug: the reproduction is required", () => {
    const dir = setup("  verify-first: on\n", ["verify AC1: a", "verify AC2: b"], "Bug");
    expect(cli(["plan", "--root", dir, "--key", "PROJ-1", "--approve"]).body.errors[0].uncovered).toEqual(["repro"]);
  });
  it("without the saved ticket the criteria are unknown: a warning, never a block", () => {
    const dir = repo(CFG("  verify-first: on\n"), { ".liftoff/plans/PROJ-1.md": PLAN(["x"]) });
    const r = cli(["plan", "--root", dir, "--key", "PROJ-1", "--approve"]);
    expect(r.exitCode).toBe(0);
    expect(codes(r.body.warnings)).toEqual(["criteria-unknown"]);
  });
  it("an approved plan is never invalidated by a change of config", () => {
    const dir = setup("  verify-first: off\n", ["x"]);
    cli(["plan", "--root", dir, "--key", "PROJ-1", "--approve"]);
    put(dir, "liftoff.yaml", CFG("  verify-first: on\n"));
    expect(cli(["plan", "--root", dir, "--key", "PROJ-1"]).body).toMatchObject({ status: "approved", approvedValid: true, stale: false });
  });
  it("parse-ticket numbers the criteria", () => {
    const dir = setup("", ["x"]);
    const t = cli(["parse-ticket", "--root", dir, "--file", ".liftoff/tmp/PROJ-1.json"]).body;
    expect(t.reading.acceptanceCriteria.items.map((i: any) => i.id)).toEqual(["AC1", "AC2"]);
  });
});

describe("checkCleanReview", () => {
  const good = { criteria: [{ id: "AC1", met: "yes", evidence: "src/reset.ts:12" }, { id: "AC2", met: "unclear", evidence: "" }], findings: [{ id: "F1", kind: "untested", severity: "must", file: "src/reset.ts", line: 12, text: "no test for expiry" }, { id: "F2", kind: "scope", severity: "should", text: "unrelated rename" }] };
  it("a good review is summarised, and what is not met is listed", () => {
    const r = checkCleanReview(good, ["AC1", "AC2"]);
    expect(r).toMatchObject({ ok: true, criteria: { total: 2, yes: 1, unclear: 1, unanswered: [] }, findings: { total: 2, must: 1, should: 1, byKind: { untested: 1, scope: 1 } }, unmet: ["AC2"] });
  });
  it("every criterion of the ticket needs a verdict", () => {
    const r = checkCleanReview(good, ["AC1", "AC2", "AC3"]);
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toEqual(["clean-review-incomplete"]);
    expect(r.criteria.unanswered).toEqual(["AC3"]);
    expect(checkCleanReview(good, undefined).ok).toBe(true);
  });
  it.each([
    ["a shape that is not a review", "x"],
    ["a bad verdict", { ...good, criteria: [{ id: "AC1", met: "maybe" }] }],
    ["a yes with no evidence", { ...good, criteria: [{ id: "AC1", met: "yes" }] }],
    ["a bad kind", { ...good, findings: [{ id: "F", kind: "style", severity: "must", text: "x" }] }],
    ["a bad severity", { ...good, findings: [{ id: "F", kind: "scope", severity: "blocker", text: "x" }] }],
    ["a path outside the repository", { ...good, findings: [{ id: "F", kind: "scope", severity: "must", text: "x", file: "../etc/passwd" }] }],
    ["an absolute path", { ...good, findings: [{ id: "F", kind: "scope", severity: "must", text: "x", file: "/etc/passwd" }] }],
    ["a bad line", { ...good, findings: [{ id: "F", kind: "scope", severity: "must", text: "x", line: 0 }] }],
    ["a duplicate finding", { ...good, findings: [good.findings[0], good.findings[0]] }],
    ["a duplicate criterion", { ...good, criteria: [good.criteria[0], good.criteria[0]] }],
    ["a credential", { ...good, findings: [{ id: "F", kind: "secret", severity: "must", text: "found ghp_abcdefghijklmnop in the diff" }] }],
  ])("%s is refused", (_n, raw) => expect(checkCleanReview(raw, undefined).ok).toBe(false));
});

describe("clean-review command", () => {
  const setup = (review: unknown, ticket = true) => {
    const dir = repo(CFG("", "  clean-review: on\n"), {});
    if (ticket) put(dir, ".liftoff/tmp/PROJ-1.json", TICKET());
    if (review !== undefined) put(dir, ".liftoff/tmp/clean-review-PROJ-1.json", typeof review === "string" ? review : JSON.stringify(review));
    return dir;
  };
  const ok = { criteria: [{ id: "AC1", met: "yes", evidence: "a.ts:1" }, { id: "AC2", met: "no", evidence: "" }], findings: [] };
  it("reads the saved review against the ticket's criteria", () => {
    const r = cli(["clean-review", "--root", setup(ok), "--key", "PROJ-1"]);
    expect(r.exitCode).toBe(0);
    expect(r.body).toMatchObject({ ok: true, mode: "on", criteriaKnown: true, unmet: ["AC2"], path: ".liftoff/tmp/clean-review-PROJ-1.json" });
  });
  it("a criterion left unanswered is an error; a missing or unreadable file says so; the key is required", () => {
    expect(cli(["clean-review", "--root", setup({ criteria: [ok.criteria[0]], findings: [] }), "--key", "PROJ-1"]).exitCode).toBe(1);
    expect(codes(cli(["clean-review", "--root", setup(undefined), "--key", "PROJ-1"]).body.errors)).toEqual(["clean-review-missing"]);
    expect(codes(cli(["clean-review", "--root", setup("{ no"), "--key", "PROJ-1"]).body.errors)).toEqual(["clean-review-invalid"]);
    expect(cli(["clean-review", "--root", setup(ok)])).toMatchObject({ exitCode: 2 });
  });
  it("without the saved ticket the verdicts are checked for shape only", () => {
    const r = cli(["clean-review", "--root", setup(ok, false), "--key", "PROJ-1"]);
    expect(r.body).toMatchObject({ ok: true, criteriaKnown: false });
  });
});
