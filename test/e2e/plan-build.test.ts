// The whole development loop as a scripted engineer-agent would run it, against the shipped CLI bundle, a real git
// repo with a bare remote, a fake Jira (via the MCP entry the CLI generated) and a fake glab: teammate setup,
// read the ticket, plan, approve, build, push, open the merge request. The skills' words are not under test here;
// what is: that every string and file the CLI hands the agent works when executed for real.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { type FakeJira, McpClient, TOKEN, baseEnv, git, liftoff, runDir, sh, startJira, textFiles, write } from "./world.js";

let jira: FakeJira;
let dir: string, root: string, remote: string, env: Record<string, string>;
let mcp: McpClient;

beforeAll(async () => {
  dir = runDir("plan-build");
  jira = await startJira(dir);
  root = join(dir, "billing");
  remote = join(dir, "remote.git");
  git(dir, "init", "-q", "--bare", "-b", "main", remote);
  git(dir, "init", "-q", "-b", "main", root);
  git(root, "remote", "add", "origin", remote);
  env = { ...baseEnv(root, { LIFTOFF_JIRA_TOKEN: TOKEN, FAKE_GLAB_LOG: join(dir, "glab.log") }) };
  // a repo the lead already Init'ed (v1 only: no connector yet) and pushed
  write(root, "liftoff.yaml", config(jira.url, { connectors: false }));
  write(root, "AGENTS.md", "# Rules\nRun `sh check.sh` before every commit.\n");
  write(root, "backend/AGENTS.md", "# Backend\n");
  write(root, "CONSTRAINTS.md", "# Constraints\n");
  write(root, "check.sh", "#!/bin/sh\ngrep -q . backend/login.txt\n");
  write(root, ".gitlab/merge_request_templates/Default.md", "## What\n\n## Ticket\n\n## How to test\n");
  expect(liftoff(root, ["render"]).status).toBe(0);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  git(root, "push", "-q", "-u", "origin", "main");
});
afterAll(async () => { mcp?.close(); await jira.close(); });

describe("1. the teammate sequence after a lead adds Connect", () => {
  it("v1 repo is ok; the lead's connector edit needs apply (plugin pin and tracker changed); render brings it back to ok", () => {
    expect(liftoff(root, ["check-config"]).body.status).toBe("ok");
    writeFileSync(join(root, "liftoff.yaml"), config(jira.url));
    expect(liftoff(root, ["validate"]).status).toBe(0);
    const c = liftoff(root, ["check-config"]);
    expect(c.body.status).toBe("blocked");
    expect(c.body.reasons.map((r: any) => r.code)).toContain("required-changed");
    expect(liftoff(root, ["render"]).status).toBe(0);
    expect(liftoff(root, ["check-config"]).body.status).toBe("ok");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "chore: liftoff connect config");
    git(root, "push", "-q");
  });
  it("connect-info yields the MCP entry; the host can start it and sees the tools", async () => {
    const info = liftoff(root, ["connect-info"]).body;
    write(root, ".mcp.json", JSON.stringify({ mcpServers: { "liftoff-jira": info.mcp[0].entry } }, null, 2));
    mcp = McpClient.start(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers["liftoff-jira"], root, env);
    await mcp.init();
    expect((await mcp.tools()).length).toBe(12);
    git(root, "add", ".mcp.json");
    git(root, "commit", "-qm", "chore: liftoff-jira MCP entry"); // the lead commits it, as the skill tells them
    git(root, "push", "-q");
  });
});

describe("2. Plan", () => {
  it("reads the ticket from Jira through MCP and applies the team's reading map", async () => {
    const got = await mcp.call("jira_get_issue", { issue_key: "PROJ-123", fields: "*all", expand: "renderedFields" });
    write(root, ".liftoff/.gitignore", "*\n");
    write(root, ".liftoff/tmp/PROJ-123.json", JSON.stringify(got.json));
    const p = liftoff(root, ["parse-ticket", "--file", ".liftoff/tmp/PROJ-123.json"]);
    expect(p.status, p.stderr + JSON.stringify(p.body)).toBe(0);
    expect(p.body.ticket).toMatchObject({ key: "PROJ-123", summary: "Add login", issueType: "Story", status: "To Do" });
    expect(p.body.reading.acceptanceCriteria).toEqual({ source: "heading", text: "* valid credentials open the dashboard\n* a wrong password is refused" });
    expect(p.body.reading.fields).toEqual([{ id: "customfield_10016", label: "Story points", value: "5" }]);
    expect(p.body.warnings).toEqual([]);
    expect(p.body.build).toMatchObject({ branch: "feature/PROJ-123-add-login", title: "PROJ-123: Add login", targetBranch: "main" });
  });
  it("a bug is read through its criteria field, an epic is read with defaults and a warning", async () => {
    for (const [key, expected] of [["PROJ-124", { source: "field", text: "no crash on an empty cart; a message is shown" }], ["PROJ-125", { source: "none", text: "" }]] as const) {
      write(root, `.liftoff/tmp/${key}.json`, JSON.stringify((await mcp.call("jira_get_issue", { issue_key: key })).json));
      const p = liftoff(root, ["parse-ticket", "--file", `.liftoff/tmp/${key}.json`]);
      expect(p.body.reading.acceptanceCriteria).toEqual(expected);
      if (key === "PROJ-125") expect(p.body.warnings.map((w: any) => w.code)).toEqual(expect.arrayContaining(["unknown-issue-type", "no-acceptance-criteria"]));
    }
  });
  it("writes the plan, validates it, approves it once; nothing leaves the machine", () => {
    const writes = jira.requests.filter((r) => r.method !== "GET").length;
    write(root, ".liftoff/plans/PROJ-123.md", `---\nticket: PROJ-123\nstatus: draft\n---\n# Plan: PROJ-123 Add login\n\n## 1. Login endpoint\n- [ ] create backend/login.txt\n- [ ] run check.sh\n\n## 2. Wire the form\n- [ ] create frontend/form.txt\n`);
    expect(liftoff(root, ["plan", "--key", "PROJ-123"]).body).toMatchObject({ status: "draft", approvedValid: false, total: 3 });
    expect(liftoff(root, ["plan", "--key", "PROJ-123", "--approve"]).body).toMatchObject({ status: "approved", approvedValid: true });
    expect(jira.requests.filter((r) => r.method !== "GET").length).toBe(writes);
    expect(git(root, "status", "--short")).toBe(""); // .liftoff is ignored, nothing else changed
  });
});

describe("3. Build", () => {
  const key = "PROJ-123";
  const build = () => liftoff(root, ["parse-ticket", "--file", `.liftoff/tmp/${key}.json`]).body.build;

  it("gate: only an approved, unchanged plan passes", () => {
    const plan = join(root, ".liftoff/plans/PROJ-123.md");
    const approved = readFileSync(plan, "utf8");
    writeFileSync(plan, approved.replace("create frontend/form.txt", "create frontend/other.txt"));
    expect(liftoff(root, ["plan", "--key", key]).body).toMatchObject({ stale: true, approvedValid: false });
    writeFileSync(plan, approved);
    expect(liftoff(root, ["plan", "--key", key]).body).toMatchObject({ stale: false, approvedValid: true });
  });
  it("dry-run 1 approved: branch from the conventions, then the ticket moves to In Progress", async () => {
    git(root, "switch", "-q", "-c", build().branch);
    expect(git(root, "branch", "--show-current")).toBe("feature/PROJ-123-add-login");
    const available = (await mcp.call("jira_get_transitions", { issue_key: key })).json.transitions.map((t: any) => t.name);
    expect(available).toContain(build().transitions.start.name);
    expect((await mcp.call("jira_transition_issue", { issue_key: key, transition: build().transitions.start.name })).isError).toBe(false);
    expect(jira.issues.find((i) => i.key === key)!.fields.status).toEqual({ name: "In Progress" });
  });
  it("implements section by section: checks run, boxes ticked, one commit each; the approval survives", () => {
    const plan = join(root, ".liftoff/plans/PROJ-123.md");
    write(root, "backend/login.txt", "login\n");
    expect(sh("sh check.sh", root, env).status).toBe(0);
    writeFileSync(plan, readFileSync(plan, "utf8").replace(/- \[ \] (create backend|run check)/g, "- [x] $1"));
    git(root, "add", "-A"); git(root, "commit", "-qm", "PROJ-123: Login endpoint");
    write(root, "frontend/form.txt", "form\n");
    writeFileSync(plan, readFileSync(plan, "utf8").replace("- [ ] create frontend", "- [x] create frontend"));
    git(root, "add", "-A"); git(root, "commit", "-qm", "PROJ-123: Wire the form");
    expect(liftoff(root, ["plan", "--key", key]).body).toMatchObject({ approvedValid: true, stale: false, done: 3, total: 3 });
    expect(git(root, "rev-list", "--count", "main..HEAD")).toBe("2");
  });
  it("dry-run 2 approved: push, then the CLI's own glab command opens the merge request", () => {
    const b = build();
    write(root, b.mrDescriptionFile, "## What\nLogin\n\n## Ticket\nhttps://x/browse/PROJ-123\n\n## How to test\nsh check.sh\n");
    git(root, "push", "-q", "-u", "origin", b.branch);
    const r = sh(b.mrCreate, root, env);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe("https://gitlab.company.local/acme/billing/-/merge_requests/7");
    const calls = readFileSync(env.FAKE_GLAB_LOG!, "utf8").split("---\n").filter(Boolean).map((c) => c.trim().split("\n"));
    expect(calls).toEqual([[ "mr", "create", "--source-branch", "feature/PROJ-123-add-login", "--target-branch", "main", "--title", "PROJ-123: Add login", "--description-file", ".liftoff/plans/PROJ-123.mr.md", "--label", "backend", "--reviewer", "alice", "--yes" ]]);
    expect(readFileSync(env.FAKE_GLAB_LOG + ".description", "utf8")).toContain("## How to test");
  });
  it("the result: the remote has the branch with the two commits, main is untouched, the tree is clean, Close has not run", () => {
    expect(git(dir, "--git-dir", remote, "rev-list", "--count", "main..feature/PROJ-123-add-login")).toBe("2");
    expect(git(dir, "--git-dir", remote, "log", "-1", "--format=%s", "main")).toBe("chore: liftoff-jira MCP entry");
    expect(git(root, "status", "--short")).toBe("");
    expect(jira.issues.find((i) => i.key === "PROJ-123")!.fields.status).toEqual({ name: "In Progress" }); // not "In Review": that is Close
    expect(jira.requests.filter((r) => r.method === "POST").map((r) => r.path)).toEqual(["/rest/api/2/issue/PROJ-123/transitions"]);
  });
  it("the token is in no file of the whole run", () => {
    for (const [path, text] of textFiles(dir)) expect(text.includes(TOKEN), path).toBe(false);
    expect(existsSync(join(root, ".liftoff/plans/PROJ-123.md"))).toBe(true);
  });
});

describe("4. the lead chooses manual git: it is a required team rule", () => {
  it("changing build.git blocks teammates until applied; Build is told manual; nothing else about the ticket changes", () => {
    const before = liftoff(root, ["parse-ticket", "--file", ".liftoff/tmp/PROJ-123.json"]).body.build;
    expect(before.git).toBe("assisted");
    const cfg = readFileSync(join(root, "liftoff.yaml"), "utf8");
    writeFileSync(join(root, "liftoff.yaml"), cfg.replace('plugin: { version: "0.2" }', 'plugin: { version: "0.3" }') + "build:\n  required: true\n  git: manual\n");
    expect(liftoff(root, ["validate"]).status).toBe(0);
    const c = liftoff(root, ["check-config"]);
    expect(c.body.status).toBe("blocked");
    expect(c.body.reasons.map((r: any) => r.code)).toContain("required-changed");
    expect(liftoff(root, ["render"]).status).toBe(0);
    expect(liftoff(root, ["check-config"]).body.status).toBe("ok");
    const after = liftoff(root, ["parse-ticket", "--file", ".liftoff/tmp/PROJ-123.json"]).body.build;
    expect(after.git).toBe("manual");
    expect({ ...after, git: undefined }).toEqual({ ...before, git: undefined });
  });
});
