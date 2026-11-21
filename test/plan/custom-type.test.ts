import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isCustomType, jiraTypeOf, typeLabel, validateConfig } from "../../src/config/index.js";
import { CONFIG, cli, repo } from "./helpers.js";

// A team's own ticket type ("e2e") that Jira only knows as a Task: created as a Task with a label, read back by the label.
const WITH = CONFIG.replace('version: "0.2"', 'version: "0.3"').replace("    - name: Bug\n", `    - name: Task
      branchType: chore
      readingMap:
        acceptanceCriteria: { heading: "Context" }
    - name: e2e
      jiraType: Task
      branchType: chore
      commitType: test
      readingMap:
        acceptanceCriteria: { heading: "Scenarios" }
    - name: Bug\n`);
const jiraTicket = (extra: object = {}) => ({ key: "PROJ-7", summary: "Check out flow", issue_type: { name: "Task" }, status: { name: "To Do" }, description: "## Context\nthe context\n\n## Scenarios\n- a buyer pays", ...extra });
const parse1 = (ticket: object) => cli(["parse-ticket", "--root", repo(WITH, { "t.json": JSON.stringify(ticket) }), "--file", "t.json"]).body;
const draft = (tickets: object[]) => cli(["draft-tickets", "--root", repo(WITH, { "d.json": JSON.stringify({ tickets }) }), "--file", "d.json"]).body;

describe("a type the team named itself", () => {
  it("knows which Jira type it is and the label that tells it apart", () => {
    expect(jiraTypeOf({ name: "e2e", jiraType: "Task" })).toBe("Task");
    expect(jiraTypeOf({ name: "Bug" })).toBe("Bug");
    expect(isCustomType({ name: "e2e", jiraType: "Task" })).toBe(true);
    expect(isCustomType({ name: "Task", jiraType: "task" })).toBe(false); // the same type, only another spelling
    expect(typeLabel({ name: "Support prio" })).toBe("liftoff-support-prio");
    expect(typeLabel({ name: "E2E / Smoke" })).toBe("liftoff-e2e-smoke");
    expect(typeLabel({ name: "Défaut" })).toBe("liftoff-defaut"); // accents are dropped, not split into pieces
  });
  it("is created as its Jira type, with the label, and the preview says so", () => {
    const t = draft([{ type: "e2e", summary: "Pay by card", description: "## Scenarios\n- a buyer pays", labels: ["checkout"] }]).tickets[0];
    expect(t.errors).toEqual([]);
    expect(t.call.args.issue_type).toBe("Task");
    expect(t.call.args.additional_fields.labels).toEqual(["checkout", "liftoff-e2e"]);
    expect(t.preview).toContain("liftoff-e2e");
  });
  it("a type that is its own Jira type gets no label", () => {
    const t = draft([{ type: "Task", summary: "Tidy up", description: "## Context\nx" }]).tickets[0];
    expect(t.call.args.issue_type).toBe("Task");
    expect(t.call.args.additional_fields?.labels).toBeUndefined();
  });
  it("is read back by its label, and a plain Task stays a Task", () => {
    const e2e = parse1(jiraTicket({ labels: ["liftoff-e2e"] }));
    expect(e2e.known).toBe(true);
    expect(e2e.reading.acceptanceCriteria).toMatchObject({ source: "heading", text: "- a buyer pays" });
    expect(e2e.build.title).toContain("PROJ-7");
    const plain = parse1(jiraTicket());
    expect(plain.known).toBe(true);
    expect(plain.reading.acceptanceCriteria.text).toBe("the context");
  });
  it("the label is found wherever the server put it", () => {
    for (const shape of [{ labels: ["liftoff-e2e"] }, { fields: { labels: ["liftoff-e2e"] } }, { labels: "liftoff-e2e, other" }]) {
      expect(parse1(jiraTicket(shape)).reading.acceptanceCriteria.text, JSON.stringify(shape)).toBe("- a buyer pays");
    }
  });
  it("its commit word is its own, in the merge request title", () => {
    const cfg = WITH.replace('"{key}: {summary}"', '"{commitType}({key}): {summary}"');
    const dir = repo(cfg, { "t.json": JSON.stringify(jiraTicket({ labels: ["liftoff-e2e"] })) });
    expect(cli(["parse-ticket", "--root", dir, "--file", "t.json"]).body.build.title).toBe("test(PROJ-7): Check out flow");
    const plain = repo(cfg, { "t.json": JSON.stringify(jiraTicket()) });
    expect(cli(["parse-ticket", "--root", plain, "--file", "t.json"]).body.build.title).toBe("chore(PROJ-7): Check out flow"); // a plain Task
  });
  it("a draft with no labels at all still gets the label of its type", () => {
    const t = draft([{ type: "e2e", summary: "No labels given", description: "## Scenarios\n- x" }]).tickets[0];
    expect(t.call.args.additional_fields.labels).toEqual(["liftoff-e2e"]);
  });
  it("a type that is based on Bug still counts as a bug where that matters (the label hides it, the Jira type says it)", () => {
    expect(jiraTypeOf({ name: "support", jiraType: "Bug" })).toBe("Bug");
  });

});

describe("the config", () => {
  const cfg = (patch: (c: any) => void) => {
    const c = parse(WITH);
    patch(c);
    return validateConfig(c);
  };
  it("accepts a type with a jiraType", () => expect(cfg(() => {})).toMatchObject({ ok: true }));
  it("refuses two types that would share a label", () => {
    const r = cfg((c) => c.tracker.issueTypes.push({ name: "E2E!", jiraType: "Task" }));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("liftoff-e2e");
  });
  it("refuses an empty jiraType", () => expect(cfg((c) => (c.tracker.issueTypes[2].jiraType = "")).ok).toBe(false));
});

describe("every command reads a labelled ticket as its own type", () => {
  const CFG = WITH.replace('version: "0.3"', 'version: "0.5"') + 'practices:\n  verify-first: "on"\n  clean-review: "on"\n';
  const TICKET = (labels: string[]) => JSON.stringify({ key: "PROJ-7", fields: { summary: "Check out", issuetype: { name: "Task" }, labels, description: "## Context\nthe context only\n\n## Scenarios\n- a buyer pays by card\n- a buyer pays by invoice\n" } });
  const PLAN = "---\nticket: PROJ-7\nstatus: draft\n---\n# Plan: PROJ-7\n\n## 1. Pay\n- [ ] verify AC1: manual: pay by card\n- [ ] verify AC2: manual: pay by invoice\n";
  const setup = (labels: string[]) => repo(CFG, { ".liftoff/tmp/PROJ-7.json": TICKET(labels), ".liftoff/plans/PROJ-7.md": PLAN });
  it("plan counts the criteria of e2e (the Scenarios) for a ticket carrying its label", () => {
    const v = cli(["plan", "--root", setup(["liftoff-e2e"]), "--key", "PROJ-7"]).body.verify;
    expect(v.criteria.map((c: { id: string }) => c.id)).toEqual(["AC1", "AC2"]);
    expect(v.uncovered).toEqual([]);
  });
  it("and those of Task (the Context) for the same ticket without the label", () => {
    const v = cli(["plan", "--root", setup([]), "--key", "PROJ-7"]).body.verify;
    expect(v.criteria.map((c: { id: string }) => c.id)).toEqual(["AC1"]); // one paragraph, so one criterion: not the two scenarios
    expect(v.unknownRefs).toEqual(["AC2"]);
  });
  it("clean-review asks a verdict for each of e2e's criteria", () => {
    const dir = setup(["liftoff-e2e"]);
    writeFileSync(join(dir, ".liftoff/tmp/clean-review-PROJ-7.json"), JSON.stringify({ findings: [], criteria: [{ id: "AC1", verdict: "met", evidence: "x" }] }));
    const out = cli(["clean-review", "--root", dir, "--key", "PROJ-7"]).body;
    expect(out.criteriaKnown).toBe(true);
    expect(JSON.stringify(out)).toContain("AC2"); // the second scenario has no verdict yet
  });
});
