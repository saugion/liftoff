import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { slugify } from "../../src/plan/build.js";
import { underHeading } from "../../src/plan/ticket.js";
import { CONFIG, cli, repo } from "./helpers.js";

const story = (extra: object = {}) => ({ key: "PROJ-123", summary: "Add login", issue_type: { name: "Story" }, status: { name: "To Do" }, description: "Intro\n\n## Acceptance criteria\n- user can log in\n- bad password is refused\n\n## Notes\nx", ...extra });
const parse = (ticket: unknown, config = CONFIG) => {
  const dir = repo(config, { "t.json": typeof ticket === "string" ? ticket : JSON.stringify(ticket) });
  return cli(["parse-ticket", "--root", dir, "--file", "t.json"]);
};

describe("parse-ticket: reading", () => {
  it("applies the reading map: heading criteria, configured fields, ticket url", () => {
    const { exitCode, body } = parse(story({ customfield_10016: 5 }));
    expect(exitCode).toBe(0);
    expect(body.ticket).toMatchObject({ key: "PROJ-123", url: "https://jira.company.local/browse/PROJ-123", summary: "Add login", issueType: "Story", status: "To Do" });
    expect(body.known).toBe(true);
    expect(body.reading.acceptanceCriteria).toEqual({ source: "heading", text: "- user can log in\n- bad password is refused" });
    expect(body.reading.fields).toEqual([{ id: "customfield_10016", label: "Story points", value: "5" }]);
    expect(body.warnings).toEqual([]);
  });
  it("accepts the jira-REST shape: everything under `fields`", () => {
    const { body } = parse({ key: "PROJ-1", fields: { summary: "S", issuetype: { name: "Story" }, description: "h2. Acceptance criteria\nA\nh2. Other\nB", customfield_10016: { value: "8" } } });
    expect(body.ticket.issueType).toBe("Story");
    expect(body.reading.acceptanceCriteria).toEqual({ source: "heading", text: "A" });
    expect(body.reading.fields[0].value).toBe("8");
  });
  it("reads a criteria field (Bug), including custom_fields and list values", () => {
    const { body } = parse({ key: "PROJ-2", summary: "Crash", issue_type: { name: "Bug" }, description: "d", custom_fields: { customfield_10201: ["a", { value: "b" }] } });
    expect(body.reading.acceptanceCriteria).toEqual({ source: "field", text: "a, b" });
  });
  it("falls back to the rendered HTML when the raw description has no such heading", () => {
    const { body } = parse(story({ description: "plain", renderedFields: { description: "<h2>Acceptance Criteria</h2><ul><li>one</li><li>two &amp; three</li></ul><h2>Next</h2>" } }));
    expect(body.reading.acceptanceCriteria).toEqual({ source: "heading", text: "- one\n- two & three" });
  });
  it("headings: bold line, wiki, case, trailing colon", () => {
    expect(underHeading("*Acceptance Criteria:*\nX\n*Other*\nY", "acceptance criteria")).toBe("X");
    expect(underHeading("h3. ACCEPTANCE CRITERIA\nX", "Acceptance criteria")).toBe("X");
    expect(underHeading("# Nope\nX", "Acceptance criteria")).toBe("");
  });
  it("warns, never invents: no criteria, empty description, missing field, unknown type", () => {
    const { body } = parse({ key: "PROJ-3", summary: "S", issue_type: { name: "Epic" }, description: "" });
    expect(body.known).toBe(false);
    expect(body.warnings.map((w: any) => w.code).sort()).toEqual(["empty-description", "no-acceptance-criteria", "unknown-issue-type"]);
    expect(body.reading.acceptanceCriteria).toEqual({ source: "none", text: "" });
    expect(parse(story()).body.warnings.map((w: any) => w.code)).toEqual(["field-missing"]);
  });
});

describe("parse-ticket: build conventions", () => {
  it("branch, title, target, labels, reviewers, template, transitions, files, glab command", () => {
    const b = parse(story()).body.build;
    expect(b).toMatchObject({ branch: "feature/PROJ-123-add-login", title: "PROJ-123: Add login", targetBranch: "main", labels: ["backend"], reviewers: ["alice"], mrTemplate: ".gitlab/merge_request_templates/Default.md", readOnly: false, planFile: ".liftoff/plans/PROJ-123.md", mrDescriptionFile: ".liftoff/plans/PROJ-123.mr.md" });
    expect(b.transitions).toEqual({ start: { name: "Start progress" }, review: { name: "Ready for review" } });
    expect(b.mrCreate).toBe("glab mr create --source-branch 'feature/PROJ-123-add-login' --target-branch 'main' --title 'PROJ-123: Add login' --description-file '.liftoff/plans/PROJ-123.mr.md' --label 'backend' --reviewer 'alice' --yes");
  });
  it("defaults without conventions; no codeHost means no mrCreate; no learned transitions mean null", () => {
    const cfg = CONFIG.slice(0, CONFIG.indexOf("codeHost:"));
    const b = parse({ key: "PROJ-9", summary: "Fix  the Thing!", issue_type: { name: "Task" }, description: "d" }, cfg).body.build;
    expect(b).toMatchObject({ branch: "PROJ-9-fix-the-thing", title: "PROJ-9: Fix the Thing!", targetBranch: null, mrCreate: null, transitions: { start: null, review: null } });
  });
  it("a read-only tracker offers no transitions", () => {
    const { body } = parse(story(), CONFIG.replace('server: { version: "0.23.1" }', 'server: { version: "0.23.1", readOnly: true }'));
    expect(body.build).toMatchObject({ readOnly: true, transitions: { start: null, review: null } });
  });
  it("a type without branchType uses the slugified type name", () => {
    const { body } = parse({ key: "PROJ-4", summary: "x", issue_type: { name: "New Feature" }, description: "" });
    expect(body.build.branch).toBe("new-feature/PROJ-4-x");
  });
  it("slug edge cases", () => {
    expect(slugify("Ünïcode & spaces!!")).toBe("unicode-spaces");
    expect(slugify("???")).toBe("work");
    expect(slugify("a".repeat(60) + " b").length).toBeLessThanOrEqual(40);
    expect(slugify("x".repeat(39) + " yyy")).toBe("x".repeat(39));
  });
  it("a hostile summary reaches the shell as one inert argument", () => {
    const evil = "x'; touch /tmp/liftoff-pwned; echo '$(id)` \"q\"";
    const { body } = parse(story({ summary: evil }));
    const probe = body.build.mrCreate.replace(/^glab mr create/, "printf '%s\\n'");
    const out = spawnSync("sh", ["-c", probe], { encoding: "utf8" }).stdout.split("\n");
    expect(out).toContain(`PROJ-123: ${evil}`);
    expect(out.filter((l) => l.startsWith("--")).length).toBeGreaterThan(5);
  });
  it("a branch pattern with odd literal text still gives a safe ref", () => {
    const cfg = CONFIG.replace('"{type}/{key}-{slug}"', '"feat: {key} ../{slug}.lock"');
    const { body } = parse(story(), cfg);
    expect(body.build.branch).toMatch(/^[A-Za-z0-9._/-]+$/);
    expect(body.build.branch).not.toMatch(/\.\.|\.lock$|^[-/]/);
  });
});

describe("parse-ticket: failures", () => {
  it.each([
    ["not JSON", "{nope", "ticket-invalid"],
    ["a list", "[]", "ticket-invalid"],
    ["no key", { summary: "x" }, "ticket-invalid"],
    ["a bad key", { key: "proj-1" }, "ticket-invalid"],
    ["another project", { key: "OTHER-1", summary: "x" }, "ticket-invalid"],
  ])("%s", (_n, ticket, code) => {
    const r = parse(ticket);
    expect(r.exitCode).toBe(1);
    expect(r.body.errors[0].code).toBe(code);
  });
  it("no tracker, missing file, missing --file, plugin-outdated, missing config", () => {
    const noTracker = CONFIG.slice(0, CONFIG.indexOf("tracker:"));
    expect(parse(story(), noTracker).body.errors[0].code).toBe("no-tracker");
    expect(cli(["parse-ticket", "--root", repo(), "--file", "nope.json"]).body.errors[0].code).toBe("ticket-invalid");
    expect(cli(["parse-ticket", "--root", repo()])).toMatchObject({ exitCode: 2, body: { errors: [{ code: "usage" }] } });
    expect(parse(story(), CONFIG.replace('"0.2"', '"9.0"')).body.errors[0].code).toBe("plugin-outdated");
    expect(cli(["parse-ticket", "--root", repo("liftoff: 1\n"), "--file", "x"]).body.errors[0].code).toBe("config-invalid");
  });
});
