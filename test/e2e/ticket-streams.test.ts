// Ticket flow and a Kanban work stream end to end: an epic of the stream is read through MCP, split into tickets,
// the batch is checked by the CLI and created through MCP with exactly the calls the CLI returned, the Epic Link is
// set, and one of the new tickets goes through Plan and Build with the stream's own workflow.
import { readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { type FakeJira, McpClient, TOKEN, baseEnv, git, liftoff, runDir, sh, startJira, textFiles, write } from "./world.js";

const STREAMS = `streams:
  items:
    - id: checkout-mvp
      project: STR
      mode: kanban
      module: backend
      epics: [STR-1]
      issueTypes:
        - name: Epic
          template: |
            ## Purpose
            ## User Journey
            ## Success Criteria
          createFields:
            customfield_10011: Epic Name Mock
        - name: Task
          branchType: chore
          template: |
            ## Context
            ## Done when
          createFields:
            customfield_17064: { value: Team A }
          transitions:
            start: { name: Work on it }
            review: { name: Check }
`;
const full = (url: string) => config(url).replace('version: "0.2"', 'version: "0.3"').replace('  server: { version: "0.23.1", sslVerify: false, readOnly: false }\n', '  server: { version: "0.23.1", sslVerify: false, readOnly: false }\n  epicLinkField: customfield_10451\n') + STREAMS;

let jira: FakeJira;
let dir: string, root: string, remote: string, env: Record<string, string>;
let mcp: McpClient;
const created: string[] = [];

beforeAll(async () => {
  dir = runDir("ticket-streams");
  jira = await startJira(dir);
  root = join(dir, "billing");
  remote = join(dir, "remote.git");
  git(dir, "init", "-q", "--bare", "-b", "main", remote);
  git(dir, "init", "-q", "-b", "main", root);
  git(root, "remote", "add", "origin", remote);
  env = baseEnv(root, { LIFTOFF_JIRA_TOKEN: TOKEN, FAKE_GLAB_LOG: join(dir, "glab.log") });
  write(root, "liftoff.yaml", full(jira.url));
  write(root, "AGENTS.md", "# Rules\n");
  write(root, "backend/AGENTS.md", "# Backend\n");
  write(root, "CONSTRAINTS.md", "# Constraints\n");
  write(root, ".liftoff/.gitignore", "*\n");
  expect(liftoff(root, ["render"]).status).toBe(0);
  git(root, "add", "-A"); git(root, "commit", "-qm", "init"); git(root, "push", "-q", "-u", "origin", "main");
  const info = liftoff(root, ["connect-info"]).body;
  mcp = McpClient.start(info.mcp[0].entry, root, env);
  await mcp.init();
});
afterAll(async () => { mcp?.close(); await jira.close(); });

describe("the stream is linked and visible to every command", () => {
  it("validates, is applied, and connect-info exposes it with its own issue types", () => {
    expect(liftoff(root, ["validate"]).status).toBe(0);
    expect(liftoff(root, ["check-config"]).body.status).toBe("ok");
    const info = liftoff(root, ["connect-info"]).body;
    expect(info.streams).toHaveLength(1);
    expect(info.streams[0]).toMatchObject({ id: "checkout-mvp", project: "STR", module: "backend", epics: ["STR-1"] });
    expect(info.streams[0].issueTypes.find((t: any) => t.name === "Task").template).toContain("## Done when");
  });
});

describe("Ticket flow: break an epic of the stream into tickets", () => {
  it("reads the epic through MCP; the stream is recognised, no sprint is mentioned", async () => {
    const epic = await mcp.call("jira_get_issue", { issue_key: "STR-1" });
    write(root, ".liftoff/tmp/STR-1.json", JSON.stringify(epic.json));
    const p = liftoff(root, ["parse-ticket", "--file", ".liftoff/tmp/STR-1.json"]);
    expect(p.status, p.stderr).toBe(0);
    expect(p.body.stream).toEqual({ id: "checkout-mvp", mode: "kanban", module: "backend", epics: ["STR-1"] });
    expect(p.body.ticket.summary).toBe("Checkout MVP");
  });
  it("a bad batch is caught before anything is created; the fixed batch is all ok", () => {
    const good = (summary: string, extra: object = {}) => ({ type: "Task", summary, description: `## Context\n${summary} context\n\n## Done when\n* it works`, priority: "Medium", labels: ["checkout"], epic: "STR-1", ...extra });
    write(root, ".liftoff/tmp/drafts-1.json", JSON.stringify({ project: "STR", tickets: [good("Cart model"), good("Payment form", { type: "Spike" }), good("Order summary", { epic: "STR-9" })] }));
    const bad = liftoff(root, ["draft-tickets", "--file", ".liftoff/tmp/drafts-1.json"]).body;
    expect(bad).toMatchObject({ ok: true, allOk: false, count: 3 });
    expect(bad.tickets.map((t: any) => t.errors.map((e: any) => e.code))).toEqual([[], ["unknown-issue-type"], ["bad-epic"]]);
    expect(jira.issues.filter((i) => i.key.startsWith("STR-")).length).toBe(1); // still just the epic

    write(root, ".liftoff/tmp/drafts-2.json", JSON.stringify({ project: "STR", tickets: [good("Cart model"), good("Payment form"), good("Order summary")] }));
    const ok = liftoff(root, ["draft-tickets", "--file", ".liftoff/tmp/drafts-2.json"]).body;
    expect(ok).toMatchObject({ allOk: true, count: 3, stream: { id: "checkout-mvp" }, inheritedTypes: false });
    expect(ok.tickets[0].call.args.additional_fields).toEqual({ customfield_17064: { value: "Team A" }, labels: ["checkout"], priority: { name: "Medium" } });
    expect(ok.tickets[0].after[0].args.fields).toEqual({ customfield_10451: "STR-1" });
  });
  it("approved once, the batch is created with exactly the CLI's calls, and the epic is linked", async () => {
    const batch = liftoff(root, ["draft-tickets", "--file", ".liftoff/tmp/drafts-2.json"]).body;
    for (const t of batch.tickets) {
      const made = await mcp.call(t.call.tool, t.call.args);
      expect(made.isError, made.text).toBe(false);
      const key = made.json.issue.key as string;
      created.push(key);
      for (const a of t.after) {
        const r = await mcp.call(a.tool, { ...a.args, issue_key: key });
        expect(r.isError, r.text).toBe(false);
      }
    }
    expect(created).toEqual(["STR-2", "STR-3", "STR-4"]);
    const stored = jira.issues.find((i) => i.key === "STR-3")!;
    expect(stored.fields).toMatchObject({ summary: "Payment form", issuetype: { name: "Task" }, labels: ["checkout"], priority: { name: "Medium" }, customfield_17064: { value: "Team A" }, customfield_10451: "STR-1", status: { name: "Backlog" } });
    expect(String(stored.fields.description)).toContain("## Done when");
  });
  it("nothing outside the stream was touched, no sprint endpoint was used, no delete", () => {
    expect(jira.requests.filter((r) => r.method === "POST" && r.path === "/rest/api/2/issue").length).toBe(3);
    expect(jira.requests.filter((r) => /sprint|agile/i.test(r.path))).toEqual([]);
    expect(jira.requests.filter((r) => r.method === "DELETE")).toEqual([]);
    expect(jira.issues.filter((i) => i.key.startsWith("PROJ-")).every((i) => (i.fields.status as any).name === "To Do")).toBe(true);
  });
  it("a read-only tracker refuses to draft", () => {
    const keep = readFileSync(join(root, "liftoff.yaml"), "utf8");
    writeFileSync(join(root, "liftoff.yaml"), keep.replace("readOnly: false", "readOnly: true"));
    expect(liftoff(root, ["draft-tickets", "--file", ".liftoff/tmp/drafts-2.json"]).body.errors[0].code).toBe("tracker-read-only");
    writeFileSync(join(root, "liftoff.yaml"), keep);
  });
});

describe("Plan and Build on a stream ticket use the stream's workflow", () => {
  const key = "STR-3";
  it("the created ticket is read back as a stream ticket with the stream's transitions and branch type", async () => {
    write(root, `.liftoff/tmp/${key}.json`, JSON.stringify((await mcp.call("jira_get_issue", { issue_key: key })).json));
    const p = liftoff(root, ["parse-ticket", "--file", `.liftoff/tmp/${key}.json`]);
    expect(p.body).toMatchObject({ known: true, stream: { id: "checkout-mvp", module: "backend" } });
    expect(p.body.build).toMatchObject({ branch: "chore/STR-3-payment-form", transitions: { start: { name: "Work on it" }, review: { name: "Check" } } });
    expect(p.body.reading.acceptanceCriteria.source).toBe("none"); // the stream's Task type has no criteria in its map
    write(root, `.liftoff/plans/${key}.md`, `---\nticket: ${key}\nstatus: draft\n---\n# Plan\n\n## 1. Form\n- [ ] create backend/form.txt\n`);
    expect(liftoff(root, ["plan", "--key", key, "--approve"]).body).toMatchObject({ status: "approved", approvedValid: true });
  });
  it("the stream's lane names are only a hint: the workflow offers them, the ticket stays where it is", async () => {
    const build = liftoff(root, ["parse-ticket", "--file", `.liftoff/tmp/${key}.json`]).body.build;
    const names = (await mcp.call("jira_get_transitions", { issue_key: key })).json.transitions.map((t: any) => t.name);
    expect(names).toEqual(["Work on it"]);
    expect(names).toContain(build.transitions.start.name);
    expect(names).not.toContain("Start progress");
    git(root, "switch", "-q", "-c", build.branch);
    expect(jira.issues.find((i) => i.key === key)!.fields.status).toEqual({ name: "Backlog" });
  });
  it("commit and push by the agent; the merge request command the engineer would run follows the stream's conventions", () => {
    const build = liftoff(root, ["parse-ticket", "--file", `.liftoff/tmp/${key}.json`]).body.build;
    write(root, "backend/form.txt", "form\n");
    git(root, "add", "-A"); git(root, "commit", "-qm", "STR-3: Form");
    write(root, build.mrDescriptionFile, "## What\nForm\n");
    git(root, "push", "-q", "-u", "origin", build.branch);
    const r = sh(build.mrCreate, root, env);
    expect(r.status, r.stderr).toBe(0);
    expect(git(dir, "--git-dir", remote, "rev-list", "--count", `main..${build.branch}`)).toBe("1");
  });
  it("the token is in no file of the whole run", () => {
    for (const [path, text] of textFiles(dir)) expect(text.includes(TOKEN), path).toBe(false);
  });
});

describe("Epics: create one, put new tickets under it, register it, add more tickets later", () => {
  const epicDraft = { type: "Epic", summary: "Payments", description: "## Purpose\nTake payments.\n\n## User Journey\nPay.\n\n## Success Criteria\nPaid orders." };
  const task = (summary: string, epic: string) => ({ type: "Task", summary, description: `## Context\n${summary}\n\n## Done when\nit works`, epic });
  const field = (k: string, f: string) => (jira.issues.find((i) => i.key === k)!.fields as Record<string, any>)[f];
  let epicKey = "";

  const createBatch = async (file: string, drafts: object[]) => {
    write(root, `.liftoff/tmp/${file}`, JSON.stringify({ project: "STR", tickets: drafts }));
    const batch = liftoff(root, ["draft-tickets", "--file", `.liftoff/tmp/${file}`]).body;
    expect(batch, JSON.stringify(batch.tickets?.filter((t: any) => !t.ok))).toMatchObject({ ok: true, allOk: true });
    const keys: string[] = [];
    for (const t of batch.tickets) {
      const made = await mcp.call(t.call.tool, t.call.args);
      expect(made.isError, made.text).toBe(false);
      keys.push(made.json.issue.key);
      for (const a of t.after) {
        const fields = Object.fromEntries(Object.entries(a.args.fields).map(([k, v]) => [k, String(v).replace(/^<key of ticket (\d+)>$/, (_m, n) => keys[Number(n)]!)]));
        expect((await mcp.call(a.tool, { issue_key: keys.at(-1), fields })).isError).toBe(false);
      }
    }
    return { batch, keys };
  };

  it("an epic and two tasks under it are one approved batch: the epic first, the tasks point at it with #0", async () => {
    const { batch, keys } = await createBatch("epic-batch.json", [epicDraft, task("Payment form", "#0"), task("Payment webhook", "#0")]);
    epicKey = keys[0]!;
    expect(batch.tickets[0]).toMatchObject({ isEpic: true, registerInStream: "checkout-mvp", after: [] });
    expect(batch.tickets[0].call.args).toMatchObject({ issue_type: "Epic", additional_fields: { customfield_10011: "Epic Name Mock" } });
    expect(epicKey).toBe("STR-5");
    expect(field(epicKey, "issuetype")).toEqual({ name: "Epic" });
    expect(field(epicKey, "customfield_10451")).toBeUndefined(); // an epic has no epic link
    expect(keys.slice(1).map((k) => field(k, "customfield_10451"))).toEqual([epicKey, epicKey]);
    expect(String(field(epicKey, "description"))).toContain("## Success Criteria");
  });
  it("the new epic is not in the stream's list yet: a later ticket naming it is refused until the config registers it", () => {
    write(root, ".liftoff/tmp/later.json", JSON.stringify({ project: "STR", tickets: [task("Refunds", epicKey)] }));
    expect(liftoff(root, ["draft-tickets", "--file", ".liftoff/tmp/later.json"]).body.tickets[0].errors.map((e: any) => e.code)).toEqual(["bad-epic"]);
  });
  it("the engineer approves the proposed diff that registers the epic; the config validates and is applied", () => {
    const file = join(root, "liftoff.yaml");
    const cfg = parse(readFileSync(file, "utf8"));
    cfg.streams.items[0].epics.push(epicKey);
    writeFileSync(file, stringify(cfg));
    expect(liftoff(root, ["validate"]).status).toBe(0);
    expect(liftoff(root, ["check-config"]).body.status).toBe("warn");
    expect(liftoff(root, ["render"]).status).toBe(0);
    expect(liftoff(root, ["check-config"]).body.status).toBe("ok");
    expect(liftoff(root, ["connect-info"]).body.streams[0].epics).toEqual(["STR-1", epicKey]);
  });
  it("new tickets created afterwards go under the existing epic by its key", async () => {
    const { keys } = await createBatch("later-batch.json", [task("Refunds", epicKey), task("Receipts", epicKey)]);
    expect(keys.map((k) => field(k, "customfield_10451"))).toEqual([epicKey, epicKey]);
    const children = jira.issues.filter((i) => (i.fields as any).customfield_10451 === epicKey).map((i) => (i.fields as any).summary).sort();
    expect(children).toEqual(["Payment form", "Payment webhook", "Receipts", "Refunds"]);
  });
  it("the epic reads back as a stream ticket of type Epic; an epic cannot be put under an epic", async () => {
    write(root, `.liftoff/tmp/${epicKey}.json`, JSON.stringify((await mcp.call("jira_get_issue", { issue_key: epicKey })).json));
    const p = liftoff(root, ["parse-ticket", "--file", `.liftoff/tmp/${epicKey}.json`]).body;
    expect(p).toMatchObject({ known: true, stream: { id: "checkout-mvp" }, ticket: { issueType: "Epic", summary: "Payments" } });
    write(root, ".liftoff/tmp/epic-in-epic.json", JSON.stringify({ project: "STR", tickets: [{ ...epicDraft, epic: epicKey }] }));
    expect(liftoff(root, ["draft-tickets", "--file", ".liftoff/tmp/epic-in-epic.json"]).body.tickets[0].errors.map((e: any) => e.code)).toContain("epic-in-epic");
  });
  it("no sprint endpoint, no delete; the token is in no file", () => {
    expect(jira.requests.filter((r) => /sprint|agile/i.test(r.path) || r.method === "DELETE")).toEqual([]);
    for (const [path, text] of textFiles(dir)) expect(text.includes(TOKEN), path).toBe(false);
  });
});
