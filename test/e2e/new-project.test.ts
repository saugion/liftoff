// The final scenario, in two acts on two machines. ACT ONE, the lead: a brand-new project (Java backend, React
// frontend; modules testBE, testFE, streamBE; streamBE is a Kanban work stream, the other two are not) is set up the
// way Init and the Connect lead flow do it, and pushed. ACT TWO, an engineer: clones it, applies the team config,
// connects with their own token, and creates one user story and one bug for every module and every combination of
// modules with the flow the lead set (the ticket sections of the control-plane team: CPL for the team's project,
// CPSC for the stream: no stakeholders, no team). Every created ticket is checked in the (fake) Jira and read back
// through MCP and the CLI. The engineer never edits liftoff.yaml.
// Section titles are the control-plane team's; all text is mock.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { INSTALLED_VERSION } from "../../src/cli/version.js";
import { type FakeJira, McpClient, baseEnv, git, liftoff, runDir, startJira, textFiles, write } from "./world.js";

// ---- the world ---------------------------------------------------------------------------------------------------
const NAME: Record<string, string> = { "test-be": "testBE", "test-fe": "testFE", "stream-be": "streamBE" };
const MODULES = Object.keys(NAME);
const STREAM_MODULES = ["stream-be"];
const TEAM_PROJECT = "PROJ", STREAM_PROJECT = "STR", STREAM_EPIC = "STR-1";
const LEAD_TOKEN = "lead-PAT-1a2b3c-do-not-leak", ENG_TOKEN = "engineer-PAT-9z8y7x-do-not-leak";
const TEAM_FIELD = "customfield_17064", EPIC_FIELD = "customfield_10451";

const h2 = (t: string, body: string) => `h2. ${t}\n\n${body}\n`;
const DOCS = "* (x) Technical documentation\n* (x) User documentation\n* (x) API documentation";
const STAKEHOLDERS = "* (x) Stakeholder A\n* (x) Stakeholder B\n* (x) Stakeholder C";
const OBS = "* *Logs:* {what to log}\n* *Metrics:* {what to count}\n* *Alerts:* {what to alert on}";
const GWT = (n: number) => `**Scenario ${n}: {scenario name}**\n* *Given* {initial state}\n* *When* {action}\n* *Then* {outcome}`;
const storyTemplate = (team: boolean) => [
  h2("Context", "{current behavior and why it is insufficient}"),
  h2("Scope", "{the new behavior}\n\n**In-Scope:**\n* {capability}\n\n**Out-of-Scope:**\n* {exclusion}"),
  h2("What value it brings?", "{impact for users and operators}"),
  h2("Doc required", DOCS),
  h2("Acceptance criteria", `${GWT(1)}\n\n${GWT(2)}`),
  ...(team ? [h2("Impacted Stakeholders", STAKEHOLDERS)] : []),
  h2("Observability", OBS),
].join("\n");
const bugTemplate = (team: boolean) => [
  h2("Context", "{module involved, wrong behavior, how it was found}\n\n* *Environment:* {Production / Staging / Dev}\n* *Discovery:* {how}"),
  h2("Users", "* *Affected user(s):* {who}\n* *User role(s):* {role}"),
  h2("Environment", "* *Environment:* {where}\n* *Version / build:* {version}"),
  h2("Steps to Reproduce", "1. {first step}\n1. {second step}\n1. {observed result}"),
  h2("Expected Result", "{what should happen}"),
  h2("Actual Result", "{what happens}"),
  h2("Doc required", "* (x) Technical documentation\n* (x) User documentation\n* (x) Runbook / incident documentation"),
  h2("Acceptance criteria", `${GWT(1)}\n\n${GWT(2)}`),
  h2("Additional Information", "* *Error message:* {text}\n* *Logs:* {lines}"),
  ...(team ? [h2("Impacted Stakeholders", STAKEHOLDERS)] : []),
  h2("Observability", OBS),
].join("\n");

const types = (team: boolean, start: string, review: string) => [
  { name: "Story", branchType: "feature", readingMap: { acceptanceCriteria: { heading: "Acceptance criteria" } }, template: storyTemplate(team),
    ...(team && { createFields: { [TEAM_FIELD]: { value: "Team Mock" } } }), transitions: { start: { name: start }, review: { name: review } } },
  { name: "Bug", branchType: "bugfix", readingMap: { acceptanceCriteria: { heading: "Acceptance criteria" } }, template: bugTemplate(team),
    ...(team && { createFields: { [TEAM_FIELD]: { value: "Team Mock" } } }), transitions: { start: { name: start }, review: { name: review } } },
];
const headings = (t: string) => [...t.matchAll(/^h2\. (.+)$/gm)].map((m) => m[1]!);
const fillTemplate = (t: string, about: string) => t.replace(/\{[^{}]*\}/g, `mock text about ${about}`).replace("(x) Technical documentation", "(/) Technical documentation");

// every non-empty set of modules, in a stable order
const subsets = <T,>(xs: T[]): T[][] => xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]).filter((s) => s.length > 0);
const COMBOS = subsets(MODULES);
// a piece of work that touches modules of two projects is one ticket per project
const parts = (mods: string[]) => [
  ...(mods.some((m) => !STREAM_MODULES.includes(m)) ? [{ project: TEAM_PROJECT, modules: mods.filter((m) => !STREAM_MODULES.includes(m)) }] : []),
  ...(mods.some((m) => STREAM_MODULES.includes(m)) ? [{ project: STREAM_PROJECT, modules: mods.filter((m) => STREAM_MODULES.includes(m)) }] : []),
];
interface Expected { project: string; type: "Story" | "Bug"; modules: string[]; summary: string; combo: string }
const EXPECTED: Expected[] = (["Story", "Bug"] as const).flatMap((type) =>
  COMBOS.flatMap((combo) => parts(combo).map((p) => ({ ...p, type, combo: combo.join("+"), summary: `[${p.modules.map((m) => NAME[m]).join("+")}] ${type === "Story" ? "US" : "Bug"} for ${combo.map((m) => NAME[m]).join("+")}` }))));

let jira: FakeJira;
let dir: string, leadRoot: string, engRoot: string, remote: string, root: string;
let leadEnv: Record<string, string>, engEnv: Record<string, string>;
let mcp: McpClient; // the engineer's
const keyOf = new Map<string, string>(); // summary -> created key

beforeAll(async () => {
  dir = runDir("new-project");
  jira = await startJira(dir, [LEAD_TOKEN, ENG_TOKEN], { fresh: true });
  leadRoot = join(dir, "lead", "test-project");
  engRoot = join(dir, "engineer", "test-project");
  remote = join(dir, "remote.git");
  root = leadRoot; // act one works in the lead's clone; act two switches to the engineer's
  leadEnv = baseEnv(join(dir, "lead"), { LIFTOFF_JIRA_TOKEN: LEAD_TOKEN });
  engEnv = baseEnv(join(dir, "engineer"), { LIFTOFF_JIRA_TOKEN: ENG_TOKEN });
  git(dir, "init", "-q", "--bare", "-b", "main", remote);
});
afterAll(async () => { mcp?.close(); await jira.close(); });

describe("ACT ONE (lead) 1. a new project: Java backend, React frontend, three modules (what Init does)", () => {
  it("writes liftoff.yaml from the Init template, the layout, the AGENTS.md files; render makes check-config ok", () => {
    const template = readFileSync(join(import.meta.dirname, "..", "..", "plugin/skills/liftoff-init/assets/liftoff-yaml-template.yaml"), "utf8");
    const items = "\n    - id: test-be\n      path: backend/test-be\n      description: Java backend (Spring Boot)\n    - id: stream-be\n      path: backend/stream-be\n      description: Java backend, Kanban work stream\n    - id: test-fe\n      path: frontend/test-fe\n      description: React frontend";
    const values: Record<string, string> = { INSTALLED_VERSION, PLUGIN_MIN_VERSION: INSTALLED_VERSION.split(".").slice(0, 2).join("."), PROJECT_NAME: "test-project", PROJECT_KIND: "new",
      AGENT_TARGETS: "claude-code, copilot", LANGUAGES: "java, typescript", FRAMEWORKS: "spring-boot, react", MODULE_ITEMS: items, CONSTRAINTS_FILE: "CONSTRAINTS.md", BUILD_GIT: "manual" };
    write(root, "liftoff.yaml", template.replace(/\{\{([A-Z_]+)\}\}/g, (_m, k: string) => values[k] ?? `<<MISSING ${k}>>`));
    expect(readFileSync(join(root, "liftoff.yaml"), "utf8")).not.toContain("<<MISSING");
    for (const m of ["backend/test-be", "backend/stream-be"]) {
      write(root, `${m}/pom.xml`, "<project><modelVersion>4.0.0</modelVersion><groupId>com.acme</groupId><artifactId>x</artifactId><version>0</version></project>\n");
      write(root, `${m}/AGENTS.md`, "# Java module\nRun `mvn -q test`.\n");
    }
    write(root, "frontend/test-fe/package.json", JSON.stringify({ name: "test-fe", dependencies: { react: "^19.0.0" }, scripts: { test: "vitest run" } }, null, 2));
    write(root, "frontend/test-fe/AGENTS.md", "# React module\nRun `npm test`.\n");
    write(root, "AGENTS.md", "# test-project\nJava backend + React frontend.\n");
    write(root, "CONSTRAINTS.md", "# Constraints\n");
    git(dir, "init", "-q", "-b", "main", root);
    git(root, "remote", "add", "origin", remote);
    const v = liftoff(root, ["validate"]);
    expect(v.status, JSON.stringify(v.body)).toBe(0);
    expect(liftoff(root, ["check-config"]).body.status).toBe("blocked"); // not applied yet
    const r = liftoff(root, ["render"]);
    expect(r.status, JSON.stringify(r.body)).toBe(0);
    expect(liftoff(root, ["check-config"]).body.status).toBe("ok");
    for (const f of ["CLAUDE.md", ".github/copilot-instructions.md", "backend/test-be/CLAUDE.md", "frontend/test-fe/CLAUDE.md"]) expect(existsSync(join(root, f)), f).toBe(true);
    git(root, "add", "-A"); git(root, "commit", "-qm", "init: test-project");
  });
});

describe("ACT ONE (lead) 2. the lead connects the tracker and links the Kanban stream (what Connect does)", () => {
  it("appends tracker, codeHost and the stream; it validates and is applied; connect-info exposes the stream with its module", () => {
    const tracker = { kind: "jira-dc", url: jira.url, project: TEAM_PROJECT, server: { version: "0.23.1", sslVerify: false }, epicLinkField: EPIC_FIELD, issueTypes: types(true, "Start progress", "Ready for review") };
    const codeHost = { kind: "gitlab", host: "gitlab.company.local", conventions: { targetBranch: "main", branchPattern: "{type}/{key}-{slug}", titlePattern: "{key}: {summary}", labels: ["backend"], reviewers: ["alice"] } };
    const streams = { items: [{ id: "stream-be", project: STREAM_PROJECT, mode: "kanban", module: "stream-be", epics: [STREAM_EPIC], issueTypes: types(false, "Work on it", "Check") }] };
    const file = join(root, "liftoff.yaml");
    writeFileSync(file, readFileSync(file, "utf8").trimEnd() + "\n" + stringify({ tracker, codeHost, streams }));
    const v = liftoff(root, ["validate"]);
    expect(v.status, JSON.stringify(v.body)).toBe(0);
    expect(liftoff(root, ["check-config"]).body.status).toBe("warn"); // optional sections changed
    expect(liftoff(root, ["render"]).status).toBe(0);
    expect(liftoff(root, ["check-config"]).body.status).toBe("ok");
    const info = liftoff(root, ["connect-info"]).body;
    expect(info.streams.map((s: any) => [s.id, s.project, s.mode, s.module])).toEqual([["stream-be", "STR", "kanban", "stream-be"]]);
    expect(info.streams[0].issueTypes.map((t: any) => t.name)).toEqual(["Story", "Bug"]);
    expect(info.mcp).toHaveLength(2);
    for (const m of info.mcp) write(root, m.file, JSON.stringify({ [m.serversKey]: { [m.server]: m.entry } }, null, 2) + "\n");
  });
  it("the stream's ticket sections are CPSC-like (no stakeholders), the team's are CPL-like (with stakeholders)", () => {
    const cfg = parse(readFileSync(join(root, "liftoff.yaml"), "utf8"));
    const teamStory = headings(cfg.tracker.issueTypes[0].template), streamStory = headings(cfg.streams.items[0].issueTypes[0].template);
    expect(teamStory).toEqual(["Context", "Scope", "What value it brings?", "Doc required", "Acceptance criteria", "Impacted Stakeholders", "Observability"]);
    expect(streamStory).toEqual(["Context", "Scope", "What value it brings?", "Doc required", "Acceptance criteria", "Observability"]);
    expect(headings(cfg.tracker.issueTypes[1].template)).toContain("Steps to Reproduce");
  });
  it("the lead's own machine works (member flow step 5: a read), then the lead commits and pushes the base", async () => {
    const lead = McpClient.start(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers["liftoff-jira"], root, leadEnv);
    await lead.init();
    expect((await lead.call("jira_search", { jql: `project = ${STREAM_PROJECT} ORDER BY updated DESC`, limit: 1 })).json.issues[0].key).toBe(STREAM_EPIC);
    lead.close();
    git(root, "add", "-A"); git(root, "commit", "-qm", "chore: liftoff team config, Jira entry, stream");
    git(root, "push", "-q", "-u", "origin", "main");
    expect(git(dir, "--git-dir", remote, "log", "-1", "--format=%s", "main")).toBe("chore: liftoff team config, Jira entry, stream");
  });
});

describe("ACT TWO (engineer) 3. the engineer joins: clone, apply, connect with their own token", () => {
  it("a fresh clone is not applied yet; render (what Init does for a teammate) brings it to ok with no question", () => {
    root = engRoot;
    git(dir, "clone", "-q", remote, engRoot);
    expect(liftoff(root, ["validate"]).status).toBe(0);
    const c = liftoff(root, ["check-config"]);
    expect(c.body.status).toBe("blocked");
    expect(c.body.reasons.map((r: any) => r.code)).toContain("not-applied");
    expect(liftoff(root, ["render"]).status).toBe(0);
    expect(liftoff(root, ["check-config"]).body.status).toBe("ok");
  });
  it("connect-info on the clone gives exactly the entry the lead committed; the engineer's server starts with their own token", async () => {
    const info = liftoff(root, ["connect-info"]).body;
    for (const m of info.mcp) expect(JSON.parse(readFileSync(join(root, m.file), "utf8"))[m.serversKey][m.server], m.file).toEqual(m.entry);
    expect(info.streams.map((s: any) => s.module)).toEqual(["stream-be"]);
    mcp = McpClient.start(info.mcp[0].entry, root, engEnv);
    await mcp.init();
    expect((await mcp.tools()).length).toBe(12);
  });
});

describe("ACT TWO (engineer) 4. the matrix: one user story and one bug per module and per combination of modules", () => {
  it("is 7 combinations x 2 types, and mixing the stream with the team's modules is two tickets (one per project)", () => {
    expect(COMBOS).toHaveLength(7);
    expect(EXPECTED).toHaveLength(2 * (4 + 3 * 2)); // per type: 4 single-project combos + 3 mixed combos split in two
    expect(EXPECTED.filter((e) => e.project === TEAM_PROJECT)).toHaveLength(12);
    expect(EXPECTED.filter((e) => e.project === STREAM_PROJECT)).toHaveLength(8);
    expect(new Set(EXPECTED.map((e) => e.summary)).size).toBe(EXPECTED.length); // every summary is unique
  });
  it("a single ticket that mixes the stream's module with a team module is refused in both projects, and nothing is created", () => {
    for (const [project, type] of [[TEAM_PROJECT, "Story"], [STREAM_PROJECT, "Bug"]] as const) {
      write(root, ".liftoff/tmp/mixed.json", JSON.stringify({ project, tickets: [{ type, summary: "mixed", description: "h2. Context\nx", modules: ["test-be", "stream-be"] }] }));
      const t = liftoff(root, ["draft-tickets", "--file", ".liftoff/tmp/mixed.json"]).body.tickets[0];
      expect(t.ok).toBe(false);
      expect(t.errors.map((e: any) => e.code)).toEqual([project === TEAM_PROJECT ? "module-in-stream" : "module-wrong-project"]);
    }
    expect(jira.requests.filter((r) => r.method !== "GET")).toEqual([]);
  });
});

describe("ACT TWO (engineer) 5. create the batch: draft-tickets checks it, MCP creates it with the CLI's own calls", () => {
  it.each([TEAM_PROJECT, STREAM_PROJECT])("project %s: every draft is ok with no warning, then it is created", async (project) => {
    const cfg = parse(readFileSync(join(root, "liftoff.yaml"), "utf8"));
    const typesOf = project === TEAM_PROJECT ? cfg.tracker.issueTypes : cfg.streams.items[0].issueTypes;
    const mine = EXPECTED.filter((e) => e.project === project);
    const tickets = mine.map((e) => ({
      type: e.type, summary: e.summary, priority: "Medium", labels: e.modules.map((m) => NAME[m]), modules: e.modules,
      description: fillTemplate(typesOf.find((t: any) => t.name === e.type).template, e.summary),
      ...(project === STREAM_PROJECT && { epic: STREAM_EPIC }),
    }));
    write(root, `.liftoff/tmp/batch-${project}.json`, JSON.stringify({ project, tickets }));
    const batch = liftoff(root, ["draft-tickets", "--file", `.liftoff/tmp/batch-${project}.json`]).body;
    expect(batch, JSON.stringify(batch.tickets?.filter((t: any) => !t.ok))).toMatchObject({ ok: true, allOk: true, count: mine.length });
    expect(batch.tickets.flatMap((t: any) => t.warnings)).toEqual([]);
    expect(batch.stream?.id ?? null).toBe(project === STREAM_PROJECT ? "stream-be" : null);

    for (const [i, t] of batch.tickets.entries()) {
      const made = await mcp.call(t.call.tool, t.call.args);
      expect(made.isError, made.text).toBe(false);
      const key = made.json.issue.key as string;
      keyOf.set(mine[i]!.summary, key);
      for (const a of t.after) expect((await mcp.call(a.tool, { ...a.args, issue_key: key })).isError).toBe(false);
    }
  });
});

describe("ACT TWO (engineer) 6. every created ticket is correct in Jira", () => {
  const fieldsOf = (e: Expected) => jira.issues.find((i) => i.key === keyOf.get(e.summary))!.fields as Record<string, any>;

  it("dumps every created ticket to tickets.json in the run folder, for a human to review", () => {
    const out = EXPECTED.map((e) => { const f = fieldsOf(e); const key = keyOf.get(e.summary)!;
      return { key, url: `${jira.url}/browse/${key}`, project: e.project, stream: e.project === STREAM_PROJECT ? "stream-be (kanban)" : null, type: e.type, combo: e.combo.split("+").map((m) => NAME[m]),
        modules: e.modules.map((m) => NAME[m]), summary: f.summary, labels: f.labels, priority: f.priority.name, team: f[TEAM_FIELD]?.value ?? null, epic: f[EPIC_FIELD] ?? null, status: f.status.name, description: f.description }; });
    write(dir, "tickets.json", JSON.stringify({ jira: jira.url, createdBy: "engineer (own token), flow set by the lead", tickets: out }, null, 2));
    expect(out).toHaveLength(20);
  });
  it("exactly 20 tickets exist, 12 in the team's project and 8 in the stream (plus the stream's epic); each summary once", () => {
    expect(keyOf.size).toBe(20);
    expect(jira.issues.filter((i) => i.key.startsWith("PROJ-"))).toHaveLength(12);
    expect(jira.issues.filter((i) => i.key.startsWith("STR-"))).toHaveLength(9);
    for (const e of EXPECTED) expect(jira.issues.filter((i) => i.fields.summary === e.summary), e.summary).toHaveLength(1);
  });
  it.each(EXPECTED.map((e) => [`${e.type} ${e.project} ${e.modules.map((m) => NAME[m]).join("+")} (for ${e.combo})`, e] as const))("%s", (_n, e) => {
    const f = fieldsOf(e);
    const key = keyOf.get(e.summary)!;
    const template = parse(readFileSync(join(root, "liftoff.yaml"), "utf8"));
    const wanted = (e.project === TEAM_PROJECT ? template.tracker.issueTypes : template.streams.items[0].issueTypes).find((t: any) => t.name === e.type);
    const desc = String(f.description);

    expect(key.startsWith(`${e.project}-`)).toBe(true);
    expect(f.issuetype).toEqual({ name: e.type });
    expect(f.labels).toEqual(e.modules.map((m) => NAME[m]));
    expect(f.priority).toEqual({ name: "Medium" });
    // sections: exactly the team's, in order
    expect(headings(desc)).toEqual(headings(wanted.template));
    // clean wiki: no leftover placeholder, no Markdown heading or bullet, one ticked doc item and it is the one that was asked
    expect(desc).not.toMatch(/\{[^{}]*\}/);
    expect(desc).not.toMatch(/^(#{1,6} |- )/m);
    const docs = desc.split(/^h2\. /m).find((s) => s.startsWith("Doc required"))!;
    expect(docs.match(/\(\/\)/g)).toHaveLength(1);
    expect(docs).toContain("(/) Technical documentation");
    // the sections that only the team's project has
    expect(desc.includes("h2. Impacted Stakeholders")).toBe(e.project === TEAM_PROJECT);
    expect(f[TEAM_FIELD]).toEqual(e.project === TEAM_PROJECT ? { value: "Team Mock" } : undefined);
    // module routing: the stream's module only in the stream, never in the team's project
    expect(f.labels.includes("streamBE")).toBe(e.project === STREAM_PROJECT);
    // Kanban stream: linked to its epic, starts in Backlog; the team's project: no epic, starts in To Do
    expect(f[EPIC_FIELD]).toBe(e.project === STREAM_PROJECT ? STREAM_EPIC : undefined);
    expect(f.status).toEqual({ name: e.project === STREAM_PROJECT ? "Backlog" : "To Do" });
    // type-specific content
    if (e.type === "Bug") for (const s of ["Steps to Reproduce", "Expected Result", "Actual Result"]) expect(headings(desc)).toContain(s);
    else for (const s of ["Scope", "What value it brings?"]) expect(headings(desc)).toContain(s);
  });
  it("every module and every combination has its story and its bug, in the right project(s)", () => {
    for (const type of ["Story", "Bug"] as const) {
      for (const combo of COMBOS) {
        const got = EXPECTED.filter((e) => e.type === type && e.combo === combo.join("+"));
        expect(got.map((g) => g.project).sort(), `${type} ${combo}`).toEqual(parts(combo).map((p) => p.project).sort());
        expect(got.flatMap((g) => g.modules).sort(), `${type} ${combo}`).toEqual([...combo].sort());
      }
    }
  });
  it("Jira received exactly 20 creations and 8 epic links (the stream's tickets), and nothing else", () => {
    const writes = jira.requests.filter((r) => r.method !== "GET");
    expect(writes.filter((r) => r.method === "POST" && r.path === "/rest/api/2/issue")).toHaveLength(20);
    expect(writes.filter((r) => r.method === "PUT")).toHaveLength(8);
    expect(writes).toHaveLength(28);
    expect(jira.requests.filter((r) => /sprint|agile/i.test(r.path))).toEqual([]);
  });
});

describe("ACT TWO (engineer) 7. read back through MCP and the CLI, as Plan would", () => {
  it("every ticket is known to the config, in the right stream, with its criteria found by the reading map and no warning", async () => {
    for (const e of EXPECTED) {
      const key = keyOf.get(e.summary)!;
      write(root, `.liftoff/tmp/${key}.json`, JSON.stringify((await mcp.call("jira_get_issue", { issue_key: key })).json));
      const p = liftoff(root, ["parse-ticket", "--file", `.liftoff/tmp/${key}.json`]);
      expect(p.status, `${key}: ${p.stderr}`).toBe(0);
      const b = p.body;
      expect(b.known, key).toBe(true);
      expect(b.warnings, key).toEqual([]);
      expect(b.stream === null, key).toBe(e.project === TEAM_PROJECT);
      if (b.stream) expect(b.stream).toMatchObject({ id: "stream-be", mode: "kanban", module: "stream-be" });
      expect(b.reading.acceptanceCriteria.source, key).toBe("heading");
      for (const w of ["Scenario 1", "Scenario 2", "Given", "When", "Then"]) expect(b.reading.acceptanceCriteria.text, `${key} ${w}`).toContain(w);
      expect(b.reading.acceptanceCriteria.text, key).not.toContain("Observability");
      expect(b.build.branch, key).toMatch(new RegExp(`^${e.type === "Story" ? "feature" : "bugfix"}/${key}-`));
      expect(b.build.transitions.start.name, key).toBe(e.project === TEAM_PROJECT ? "Start progress" : "Work on it");
      expect(b.build.git, key).toBe("manual");
    }
  });
});

describe("8. the engineer changed no rule, and the whole run leaks nothing", () => {
  it("liftoff.yaml in the engineer's clone is exactly what the lead pushed; no tracked file changed", () => {
    expect(git(root, "status", "--short")).toBe("");
    expect(git(root, "diff", "HEAD", "--stat")).toBe("");
    expect(git(root, "rev-parse", "HEAD")).toBe(git(leadRoot, "rev-parse", "HEAD"));
  });
  it("the ticket writes used the engineer's token, never the lead's; neither token is in any file", () => {
    const creations = jira.requests.filter((r) => r.method === "POST" && r.path === "/rest/api/2/issue");
    expect(creations).toHaveLength(20);
    expect(creations.every((r) => r.auth === `Bearer ${ENG_TOKEN}`)).toBe(true);
    expect(jira.requests.filter((r) => r.auth === `Bearer ${LEAD_TOKEN}`).every((r) => r.method === "GET")).toBe(true);
    for (const [path, text] of textFiles(dir)) for (const t of [LEAD_TOKEN, ENG_TOKEN]) expect(text.includes(t), path).toBe(false);
    expect(git(root, "status", "--short")).not.toMatch(/\.liftoff/);
  });
});
