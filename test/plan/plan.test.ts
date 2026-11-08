import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cli, repo } from "./helpers.js";

const PLAN = `---
ticket: PROJ-123
status: draft
---
# Plan: PROJ-123 Add login

## 1. Model
- [ ] add the user table
- [ ] add the repository

## 2. Endpoint
- [ ] POST /login
`;
const setup = (plan = PLAN) => {
  const dir = repo(undefined, { ".liftoff/plans/PROJ-123.md": plan });
  return { dir, file: join(dir, ".liftoff/plans/PROJ-123.md"), plan: (...extra: string[]) => cli(["plan", "--root", dir, "--key", "PROJ-123", ...extra]) };
};

describe("plan: report", () => {
  it("a valid draft: sections, progress, not approved", () => {
    const r = setup().plan();
    expect(r).toMatchObject({ exitCode: 0, body: { ok: true, key: "PROJ-123", path: ".liftoff/plans/PROJ-123.md", status: "draft", approvedValid: false, stale: false, done: 0, total: 3 } });
    expect(r.body.sections).toEqual([{ n: 1, title: "Model", done: 0, total: 2 }, { n: 2, title: "Endpoint", done: 0, total: 1 }]);
  });
  it("--approve records approval, is idempotent, and creates the self-ignore", () => {
    const s = setup();
    const a = s.plan("--approve");
    expect(a.body).toMatchObject({ status: "approved", approvedValid: true, stale: false });
    expect(readFileSync(s.file, "utf8")).toMatch(/^---\nticket: PROJ-123\nstatus: approved\napprovedHash: sha256:[0-9a-f]{64}\n---\n# Plan/);
    expect(readFileSync(join(s.dir, ".liftoff/.gitignore"), "utf8")).toBe("*\n");
    const once = readFileSync(s.file, "utf8");
    s.plan("--approve");
    expect(readFileSync(s.file, "utf8")).toBe(once);
    expect(s.plan().body).toMatchObject({ status: "approved", approvedValid: true });
  });
  it("ticking checkboxes keeps the approval; editing the content makes it stale", () => {
    const s = setup();
    s.plan("--approve");
    writeFileSync(s.file, readFileSync(s.file, "utf8").replace("- [ ] add the user table", "- [x] add the user table"));
    expect(s.plan().body).toMatchObject({ approvedValid: true, stale: false, done: 1, total: 3 });
    writeFileSync(s.file, readFileSync(s.file, "utf8").replace("POST /login", "POST /sessions"));
    expect(s.plan().body).toMatchObject({ approvedValid: false, stale: true });
  });
  it("keeps CRLF files CRLF through approval", () => {
    const s = setup(PLAN.replace(/\n/g, "\r\n"));
    s.plan("--approve");
    const t = readFileSync(s.file, "utf8");
    expect(t.includes("\r\n")).toBe(true);
    expect(t.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(s.plan().body.approvedValid).toBe(true);
  });
});

describe("plan: failures", () => {
  it("missing plan", () => {
    const dir = repo();
    expect(cli(["plan", "--root", dir, "--key", "PROJ-1"])).toMatchObject({ exitCode: 1, body: { errors: [{ code: "plan-missing" }] } });
  });
  it.each([
    ["no front matter", "# Plan\n## 1. A\n- [ ] x\n", /front matter/],
    ["wrong ticket", PLAN.replace("ticket: PROJ-123", "ticket: PROJ-9"), /ticket must be PROJ-123/],
    ["bad status", PLAN.replace("status: draft", "status: done"), /status must be/],
    ["approved without hash", PLAN.replace("status: draft", "status: approved"), /approvedHash/],
    ["no sections", "---\nticket: PROJ-123\nstatus: draft\n---\ntext\n", /at least one section/],
    ["gap in numbering", PLAN.replace("## 2.", "## 3."), /without gaps/],
    ["section without checkbox", PLAN.replace("- [ ] POST /login", "just text"), /no checkbox/],
    ["malformed heading", PLAN + "\n## Extra\n", /must look like/],
    ["credential in text", PLAN + "\nuse ghp_abcdefghij1234567890\n", /credential/],
  ])("%s is plan-invalid", (_n, text, message) => {
    const r = setup(text).plan();
    expect(r.exitCode).toBe(1);
    expect(r.body.errors.every((e: any) => e.code === "plan-invalid")).toBe(true);
    expect(r.body.errors.map((e: any) => e.message).join("\n")).toMatch(message);
  });
  it("--approve on an invalid plan changes nothing", () => {
    const s = setup(PLAN.replace("## 2.", "## 3."));
    const before = readFileSync(s.file, "utf8");
    expect(s.plan("--approve").exitCode).toBe(1);
    expect(readFileSync(s.file, "utf8")).toBe(before);
    expect(existsSync(join(s.dir, ".liftoff/.gitignore"))).toBe(false);
  });
  it("a bad or missing key is a usage error (no path traversal)", () => {
    const dir = repo();
    for (const key of ["../x", "proj-1", "PROJ-1/../../a"]) expect(cli(["plan", "--root", dir, "--key", key]).exitCode).toBe(2);
    expect(cli(["plan", "--root", dir]).exitCode).toBe(2);
  });
});
