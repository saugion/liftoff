import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG, cli, repo } from "./helpers.js";

const WITH = CONFIG.replace('version: "0.2"', 'version: "0.3"')
  .replace('  server: { version: "0.23.1" }\n', '  server: { version: "0.23.1" }\n  epicLinkField: customfield_10451\n')
  .replace("    - name: Story\n      branchType: feature\n", "    - name: Story\n      branchType: feature\n      template: |\n        ## Context\n        ## Acceptance criteria\n      createFields:\n        customfield_17064: { value: Team A }\n") +
  `streams:
  items:
    - id: checkout-mvp
      project: STR
      mode: kanban
      epics: [STR-1, STR-2]
      issueTypes:
        - name: Task
          branchType: chore
          transitions:
            start: { name: Work on it }
            review: { name: Check }
    - id: bare
      project: BARE
      mode: kanban
`;
const draft = (body: unknown, config = WITH) => {
  const dir = repo(config, { "d.json": JSON.stringify(body) });
  return cli(["draft-tickets", "--root", dir, "--file", "d.json"]);
};
const story = { type: "Story", summary: "Add login", description: "## Context\nx\n\n## Acceptance criteria\n* y", priority: "High", labels: ["backend"] };

describe("parse-ticket on a stream", () => {
  const parse = (ticket: object) => {
    const dir = repo(WITH, { "t.json": JSON.stringify(ticket) });
    return cli(["parse-ticket", "--root", dir, "--file", "t.json"]);
  };
  it("uses the stream's own types and transitions and reports the stream", () => {
    const { body } = parse({ key: "STR-7", summary: "Wire it", issue_type: { name: "Task" }, description: "d" });
    expect(body.stream).toEqual({ id: "checkout-mvp", mode: "kanban", module: null, epics: ["STR-1", "STR-2"] });
    expect(body.known).toBe(true);
    expect(body.build.transitions).toEqual({ start: { name: "Work on it" }, review: { name: "Check" } });
    expect(body.build.branch).toBe("chore/STR-7-wire-it");
    expect(body.ticket.url).toBe("https://jira.company.local/browse/STR-7");
  });
  it("a stream without its own types reads with the tracker's and warns", () => {
    const { body } = parse({ key: "BARE-1", summary: "x", issue_type: { name: "Story" }, description: "## Acceptance criteria\na" });
    expect(body.warnings.map((w: any) => w.code)).toContain("types-inherited");
    expect(body.known).toBe(true);
  });
  it("the tracker's own tickets have stream null; a foreign project is rejected naming the known ones", () => {
    expect(parse({ key: "PROJ-1", summary: "x", issue_type: { name: "Story" }, description: "d" }).body.stream).toBeNull();
    const r = parse({ key: "OTHER-1", summary: "x" });
    expect(r.body.errors[0]).toMatchObject({ code: "ticket-invalid" });
    expect(r.body.errors[0].message).toMatch(/PROJ, STR, BARE/);
  });
});

describe("draft-tickets", () => {
  it("a good batch: exact creation call, template-derived fields, epic link as an after-step, nothing else", () => {
    const { exitCode, body } = draft({ project: "PROJ", tickets: [{ ...story, epic: "PROJ-9", fields: { customfield_99: "x" } }] });
    expect(exitCode).toBe(0);
    expect(body).toMatchObject({ ok: true, project: "PROJ", stream: null, count: 1, allOk: true });
    const t = body.tickets[0];
    expect(t.call).toEqual({ tool: "jira_create_issue", args: { project_key: "PROJ", issue_type: "Story", summary: "Add login", description: story.description,
      additional_fields: { customfield_17064: { value: "Team A" }, customfield_99: "x", labels: ["backend"], priority: { name: "High" } } } });
    expect(t.after).toEqual([{ tool: "jira_update_issue", args: { issue_key: "<created key>", fields: { customfield_10451: "PROJ-9" } } }]);
    expect(t.warnings).toEqual([]);
    expect(t.preview).toBe("Story · High · backend · epic PROJ-9\nAdd login");
  });
  it("defaults to the tracker's project; a stream batch uses the stream's types and epics", () => {
    expect(draft({ tickets: [story] }).body.project).toBe("PROJ");
    const r = draft({ project: "STR", tickets: [{ type: "task", summary: "Do", description: "d", epic: "STR-2" }] }).body;
    expect(r).toMatchObject({ project: "STR", stream: { id: "checkout-mvp" }, allOk: true });
    expect(r.tickets[0].call.args).toMatchObject({ project_key: "STR", issue_type: "Task" });
  });
  it.each([
    ["unknown type", { ...story, type: "Epic" }, "unknown-issue-type"],
    ["empty summary", { ...story, summary: " " }, "bad-summary"],
    ["multi-line summary", { ...story, summary: "a\nb" }, "bad-summary"],
    ["no description", { ...story, description: "" }, "bad-description"],
    ["label with a space", { ...story, labels: ["a b"] }, "bad-label"],
    ["odd priority", { ...story, priority: "High; DROP" }, "bad-priority"],
    ["bad field key", { ...story, fields: { "a-b": 1 } }, "bad-fields"],
    ["epic of another project", { ...story, epic: "STR-1" }, "bad-epic"],
    ["credential", { ...story, description: "token ghp_abcdefghij1234567890" }, "credential-like"],
    ["not an object", "nope", "bad-ticket"],
  ])("%s is an error on that ticket only", (_n, t, code) => {
    const { body } = draft({ tickets: [t, story] });
    expect(body.allOk).toBe(false);
    expect(body.tickets[0].errors.map((e: any) => e.code)).toContain(code);
    expect(body.tickets[0].call).toBeNull();
    expect(body.tickets[1].ok).toBe(true);
  });
  it("stream rules: an epic outside the stream's list; a project that is neither; a read-only tracker", () => {
    expect(draft({ project: "STR", tickets: [{ type: "Task", summary: "x", description: "d", epic: "STR-99" }] }).body.tickets[0].errors[0].code).toBe("bad-epic");
    expect(draft({ project: "NOPE", tickets: [story] })).toMatchObject({ exitCode: 1, body: { errors: [{ code: "ticket-draft-invalid" }] } });
    expect(draft({ tickets: [story] }, WITH.replace('server: { version: "0.23.1" }', 'server: { version: "0.23.1", readOnly: true }'))).toMatchObject({ exitCode: 1, body: { errors: [{ code: "tracker-read-only" }] } });
  });
  it("an epic needs the Epic Link field; a project without issue types asks for Connect", () => {
    const noField = WITH.replace("  epicLinkField: customfield_10451\n", "");
    expect(draft({ tickets: [{ ...story, epic: "PROJ-9" }] }, noField).body.tickets[0].errors.map((e: any) => e.code)).toContain("epic-link-field-missing");
    expect(draft({ project: "BARE", tickets: [{ type: "Story", summary: "x", description: "d" }] }).body.tickets[0].ok).toBe(true); // inherits
    const none = WITH.replace(/  issueTypes:\n    - name: Story[\s\S]*?codeHost:/, "codeHost:");
    expect(draft({ tickets: [story] }, none).body.tickets[0].errors.map((e: any) => e.code)).toContain("no-issue-types");
  });
  it("template conformance is a warning per missing section", () => {
    const { body } = draft({ tickets: [{ ...story, description: "## Context\nonly" }] });
    expect(body.tickets[0].ok).toBe(true);
    expect(body.tickets[0].warnings).toEqual([{ code: "template-section-missing", message: expect.stringContaining("acceptance criteria") }]);
    expect(draft({ tickets: [{ ...story, description: "h2. Context\nx\nh2. Acceptance Criteria\ny" }] }).body.tickets[0].warnings).toEqual([]);
  });
  it("hostile text stays data: it is in the JSON args, never in a command string", () => {
    const evil = "x'; rm -rf / #`$(id)";
    const { body } = draft({ tickets: [{ ...story, summary: evil }] });
    expect(body.tickets[0].call.args.summary).toBe(evil);
    expect(JSON.stringify(body)).not.toMatch(/glab|sh -c/);
  });
  it("failures: no file, bad JSON, empty batch, no tracker, plugin pin", () => {
    const dir = repo(WITH, { "bad.json": "{nope", "empty.json": '{"tickets":[]}' });
    expect(cli(["draft-tickets", "--root", dir])).toMatchObject({ exitCode: 2 });
    for (const f of ["bad.json", "empty.json", "missing.json"]) expect(cli(["draft-tickets", "--root", dir, "--file", f]).body.errors[0].code).toBe("ticket-draft-invalid");
    writeFileSync(join(dir, "liftoff.yaml"), WITH.slice(0, WITH.indexOf("tracker:")));
    expect(cli(["draft-tickets", "--root", dir, "--file", "bad.json"]).body.errors[0].code).toBe("no-tracker");
  });
});
