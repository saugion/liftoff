// Smoke test of the template choices in the Connect lead flow, for each ticket type (Epic, Story, Bug):
//   1) the built-in defaults, used as they are;
//   2) a default the lead customized (sections added, one renamed);
//   3) a template that is totally different (the lead's own sections, in Jira wiki format, other acceptance-criteria section).
// Three projects: PROJ (the team's own, defaults), CUS and NEW (two linked Kanban streams). The lead proves each type with a
// test ticket and pushes the config; an engineer clones it and creates an Epic with a Story and a Bug under it in each project.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { INSTALLED_VERSION } from "../../src/cli/version.js";
import { type FakeJira, McpClient, baseEnv, git, liftoff, runDir, startJira, textFiles, write } from "./world.js";

const LEAD_TOKEN = "lead-PAT-smoke-do-not-leak", ENG_TOKEN = "engineer-PAT-smoke-do-not-leak";
const ASSET = (n: string) => readFileSync(join(import.meta.dirname, "..", "..", "plugin/skills/liftoff-connect/assets/defaults", `${n}.md`), "utf8");
const TYPES = ["Epic", "Story", "Bug"] as const;
type Type = (typeof TYPES)[number];
const DEFAULT_FILE: Record<Type, string> = { Epic: "epic", Story: "story", Bug: "bug" };
const MARKDOWN_HEADING = /^#{1,6}\s+(.+?)\s*$/gm, WIKI_HEADING = /^h[1-6]\.\s+(.+?)\s*$/gm;
const titles = (t: string) => [...t.matchAll(/^(?:#{1,6}|h[1-6]\.)\s+(.+?)\s*$/gm)].map((m) => m[1]!);

interface Strategy { id: "defaults" | "customized" | "different"; project: string; module: string; label: string;
  template: Record<Type, string>; criteria: Record<Type, string>; branchType: Record<Type, string> }
const branchType = { Epic: "epic", Story: "feature", Bug: "bugfix" };

// 1) as shipped
const DEFAULTS: Strategy = { id: "defaults", project: "PROJ", module: "core", label: "Built-in defaults, unchanged",
  template: { Epic: ASSET("epic"), Story: ASSET("story"), Bug: ASSET("bug") },
  criteria: { Epic: "Success criteria", Story: "Acceptance criteria", Bug: "What should happen" }, branchType };
// 2) a default the lead edited: sections added, one renamed, one dropped
const CUSTOMIZED: Strategy = { id: "customized", project: "CUS", module: "custom-svc", label: "A default, customized by the lead",
  template: {
    Epic: ASSET("epic").trimEnd() + "\n\n## Risks\n\n## Dependencies\n",
    Story: ASSET("story").replace("## Notes", "## Out of scope").trimEnd() + "\n\n## Security impact\n",
    Bug: ASSET("bug").replace("## Environment", "## Environment and version").trimEnd() + "\n\n## Logs\n\n## Workaround\n" },
  criteria: { Epic: "Success criteria", Story: "Acceptance criteria", Bug: "What should happen" }, branchType };
// 3) nothing from the defaults: the lead's own sections, in Jira wiki format
const DIFFERENT: Strategy = { id: "different", project: "NEW", module: "new-svc", label: "Totally different, the lead's own",
  template: {
    Epic: "h2. Vision\n\nh2. Bets\n\nh2. Metrics\n\nh2. Out of scope\n",
    Story: "h2. Hypothesis\n\nh2. Experiment design\n\nh2. Rollout plan\n\nh2. Definition of done\n",
    Bug: "h2. Symptom\n\nh2. Impact\n\nh2. Repro recipe\n\nh2. Fix verification\n\nh2. Postmortem\n" },
  criteria: { Epic: "Metrics", Story: "Definition of done", Bug: "Fix verification" }, branchType };
const STRATEGIES = [DEFAULTS, CUSTOMIZED, DIFFERENT];

// A description is the template skeleton with a mock paragraph under every heading (what the Ticket skill writes).
const mock = (title: string, about: string) => `mock text for ${title} of ${about}`;
const fill = (template: string, about: string) =>
  template.split("\n").flatMap((l) => { const h = /^(?:#{1,6}|h[1-6]\.)\s+(.+?)\s*$/.exec(l); return h ? [l, "", mock(h[1]!, about)] : [l]; }).join("\n").replace(/\n{3,}/g, "\n\n");
const issueTypesOf = (s: Strategy) => TYPES.map((t) => ({ name: t, branchType: s.branchType[t], readingMap: { acceptanceCriteria: { heading: s.criteria[t] } }, template: s.template[t],
  transitions: s.project === "PROJ" ? { start: { name: "Start progress" }, review: { name: "Ready for review" } } : { start: { name: "Work on it" }, review: { name: "Check" } } }));

let jira: FakeJira;
let dir: string, lead: string, eng: string, remote: string, root: string;
let leadEnv: Record<string, string>, engEnv: Record<string, string>;
const testKeys: string[] = [];
const made: { strategy: Strategy; type: Type; key: string; summary: string; description: string; fields: Record<string, any> }[] = [];

beforeAll(async () => {
  dir = runDir("templates-smoke");
  jira = await startJira(dir, [LEAD_TOKEN, ENG_TOKEN], { fresh: true });
  lead = join(dir, "lead", "app"); eng = join(dir, "engineer", "app"); remote = join(dir, "remote.git"); root = lead;
  leadEnv = baseEnv(join(dir, "lead"), { LIFTOFF_JIRA_TOKEN: LEAD_TOKEN });
  engEnv = baseEnv(join(dir, "engineer"), { LIFTOFF_JIRA_TOKEN: ENG_TOKEN });
  git(dir, "init", "-q", "--bare", "-b", "main", remote);
});
afterAll(async () => { await jira.close(); });

describe("the three template choices are real, and different from each other", () => {
  it("1) the defaults are the shipped files; 2) the customized ones add, rename and keep; 3) the different ones share nothing", () => {
    for (const t of TYPES) {
      expect(DEFAULTS.template[t]).toBe(ASSET(DEFAULT_FILE[t]));
      const base = titles(ASSET(DEFAULT_FILE[t])), custom = titles(CUSTOMIZED.template[t]), different = titles(DIFFERENT.template[t]);
      expect(custom.some((x) => !base.includes(x)), `${t}: something added or renamed`).toBe(true);
      expect(custom.some((x) => base.includes(x)), `${t}: something kept`).toBe(true);
      expect(different.filter((x) => base.includes(x) || custom.includes(x)), `${t}: nothing shared`).toEqual([]);
    }
    expect(WIKI_HEADING.test(DIFFERENT.template.Story)).toBe(true);
    expect(MARKDOWN_HEADING.test(DEFAULTS.template.Story)).toBe(true);
  });
});

describe("the lead: Init, then Connect with a proof ticket per type and project", () => {
  it("Init writes a new project with three modules", () => {
    const template = readFileSync(join(import.meta.dirname, "..", "..", "plugin/skills/liftoff-init/assets/liftoff-yaml-template.yaml"), "utf8");
    const items = "\n    - id: core\n      path: core\n    - id: custom-svc\n      path: custom-svc\n    - id: new-svc\n      path: new-svc";
    const v: Record<string, string> = { INSTALLED_VERSION, PLUGIN_MIN_VERSION: INSTALLED_VERSION.split(".").slice(0, 2).join("."), PROJECT_NAME: "smoke", PROJECT_KIND: "new", AGENT_TARGETS: "claude-code", LANGUAGES: "java", FRAMEWORKS: "spring-boot", MODULE_ITEMS: items, CONSTRAINTS_FILE: "CONSTRAINTS.md", BUILD_GIT: "manual" };
    write(root, "liftoff.yaml", template.replace(/\{\{([A-Z_]+)\}\}/g, (_m, k: string) => v[k] ?? `<<MISSING ${k}>>`));
    for (const m of ["core", "custom-svc", "new-svc"]) write(root, `${m}/AGENTS.md`, `# ${m}\n`);
    write(root, "AGENTS.md", "# smoke\n"); write(root, "CONSTRAINTS.md", "# Constraints\n");
    git(dir, "init", "-q", "-b", "main", root); git(root, "remote", "add", "origin", remote);
    expect(liftoff(root, ["render"]).status).toBe(0);
    expect(liftoff(root, ["check-config"]).body.status).toBe("ok");
  });
  it("Connect: a test ticket per type in each project is created with the template, read back, and its sections match; the config is then written", async () => {
    write(root, ".liftoff/.gitignore", "*\n");
    const info = (await (async () => { write(root, "liftoff.yaml", readFileSync(join(root, "liftoff.yaml"), "utf8").trimEnd() + "\n" + stringify({
      tracker: { kind: "jira-dc", url: jira.url, project: "PROJ", server: { version: "0.23.1", sslVerify: false }, epicLinkField: "customfield_10451" },
      codeHost: { kind: "gitlab", host: "gitlab.company.local" } })); return liftoff(root, ["connect-info"]).body; })());
    for (const m of info.mcp) write(root, m.file, JSON.stringify({ [m.serversKey]: { [m.server]: m.entry } }, null, 2) + "\n");
    const mcp = McpClient.start(info.mcp[0].entry, root, leadEnv);
    await mcp.init();
    for (const s of STRATEGIES) for (const t of TYPES) {
      const description = fill(s.template[t], `test ${t}`);
      const created = await mcp.call("jira_create_issue", { project_key: s.project, issue_type: t, summary: `[LiftOff test] ${t}`, description });
      expect(created.isError, created.text).toBe(false);
      const key = created.json.issue.key as string;
      testKeys.push(key);
      const back = (await mcp.call("jira_get_issue", { issue_key: key })).json;
      expect(titles(back.description), `${s.id} ${t}: the sections survived`).toEqual(titles(s.template[t]));
    }
    mcp.close();
    expect(testKeys).toHaveLength(9);
    // the proven types are written: PROJ's in tracker, the streams' own under streams
    const file = join(root, "liftoff.yaml");
    const cfg = parse(readFileSync(file, "utf8"));
    cfg.tracker.issueTypes = issueTypesOf(DEFAULTS);
    cfg.streams = { items: [CUSTOMIZED, DIFFERENT].map((s) => ({ id: s.module, project: s.project, mode: "kanban", module: s.module, issueTypes: issueTypesOf(s) })) };
    writeFileSync(file, stringify(cfg));
    expect(liftoff(root, ["validate"]).status).toBe(0);
    expect(liftoff(root, ["render"]).status).toBe(0);
    expect(liftoff(root, ["check-config"]).body.status).toBe("ok");
    git(root, "add", "-A"); git(root, "commit", "-qm", "chore: liftoff team config"); git(root, "push", "-q", "-u", "origin", "main");
  });
});

describe("the engineer: clone, apply, then an Epic with a Story and a Bug under it in each project", () => {
  let mcp: McpClient;
  afterAll(() => mcp?.close());

  it("clones, applies the config with no question, connects with their own token", async () => {
    root = eng;
    git(dir, "clone", "-q", remote, eng);
    expect(liftoff(root, ["render"]).status).toBe(0);
    expect(liftoff(root, ["check-config"]).body.status).toBe("ok");
    const info = liftoff(root, ["connect-info"]).body;
    expect(info.streams.map((s: any) => [s.project, s.issueTypes.map((t: any) => t.name)])).toEqual([["CUS", [...TYPES]], ["NEW", [...TYPES]]]);
    mcp = McpClient.start(info.mcp[0].entry, root, engEnv);
    await mcp.init();
  });
  it.each(STRATEGIES.map((s) => [s.label, s] as const))("%s: the batch is ok with no warning and is created", async (_label, s) => {
    const cfg = parse(readFileSync(join(root, "liftoff.yaml"), "utf8"));
    const typesOf = s.project === "PROJ" ? cfg.tracker.issueTypes : cfg.streams.items.find((x: any) => x.project === s.project).issueTypes;
    const about = (t: Type) => `${s.id} ${t.toLowerCase()}`;
    const drafts = TYPES.map((t, i) => ({ type: t, summary: `${t} for ${s.id}`, priority: "Medium", labels: [s.module], modules: [s.module],
      description: fill(typesOf.find((x: any) => x.name === t).template, about(t)), ...(i > 0 && { epic: "#0" }) }));
    write(root, `.liftoff/tmp/${s.id}.json`, JSON.stringify({ project: s.project, tickets: drafts }));
    const batch = liftoff(root, ["draft-tickets", "--file", `.liftoff/tmp/${s.id}.json`]).body;
    expect(batch, JSON.stringify(batch.tickets?.filter((t: any) => !t.ok))).toMatchObject({ ok: true, allOk: true, count: 3 });
    expect(batch.tickets.flatMap((t: any) => t.warnings)).toEqual([]);
    expect(batch.tickets[0]).toMatchObject({ isEpic: true });
    const keys: string[] = [];
    for (const [i, t] of batch.tickets.entries()) {
      const r = await mcp.call(t.call.tool, t.call.args);
      expect(r.isError, r.text).toBe(false);
      keys.push(r.json.issue.key);
      for (const a of t.after) {
        const fields = Object.fromEntries(Object.entries(a.args.fields).map(([k, v]) => [k, String(v).replace(/^<key of ticket (\d+)>$/, (_m, n) => keys[Number(n)]!)]));
        expect((await mcp.call(a.tool, { issue_key: keys[i], fields })).isError).toBe(false);
      }
      made.push({ strategy: s, type: TYPES[i]!, key: keys[i]!, summary: drafts[i]!.summary, description: drafts[i]!.description, fields: {} });
    }
  });
});

describe("every ticket is right, whichever template it came from", () => {
  const jiraFields = (key: string) => jira.issues.find((i) => i.key === key)!.fields as Record<string, any>;

  it("9 tickets, 3 per project, plus the 9 proof tickets the lead made", () => {
    expect(made).toHaveLength(9);
    for (const s of STRATEGIES) expect(made.filter((m) => m.strategy === s).map((m) => m.key.split("-")[0])).toEqual([s.project, s.project, s.project]);
    expect(jira.issues.filter((i) => String(i.fields.summary).startsWith("[LiftOff test]"))).toHaveLength(9);
  });
  it.each(STRATEGIES.flatMap((s) => TYPES.map((t) => [`${s.id} / ${t}`, s, t] as const)))("%s", async (_n, s, t) => {
    const m = made.find((x) => x.strategy === s && x.type === t)!;
    const f = jiraFields(m.key);
    expect(f.issuetype).toEqual({ name: t });
    expect(f.labels).toEqual([s.module]);
    // the sections are exactly the template's, in order; every section has its text and nothing is left over
    expect(titles(f.description)).toEqual(titles(s.template[t]));
    for (const h of titles(s.template[t])) expect(f.description).toContain(mock(h, `${s.id} ${t.toLowerCase()}`));
    // the Story and the Bug sit under the Epic of their project; the Epic has no link
    const epicKey = made.find((x) => x.strategy === s && x.type === "Epic")!.key;
    expect(f.customfield_10451).toBe(t === "Epic" ? undefined : epicKey);
    // read back as Plan would: the reading map of this template finds the criteria and only them
    write(root, `.liftoff/tmp/${m.key}.json`, JSON.stringify((await (async () => { return null; })()) ?? {}));
  });
  it("read back through MCP and the CLI: the acceptance criteria are the right section, with no warning", async () => {
    const info = liftoff(root, ["connect-info"]).body;
    const mcp = McpClient.start(info.mcp[0].entry, root, engEnv);
    await mcp.init();
    for (const m of made) {
      write(root, `.liftoff/tmp/${m.key}.json`, JSON.stringify((await mcp.call("jira_get_issue", { issue_key: m.key })).json));
      const p = liftoff(root, ["parse-ticket", "--file", `.liftoff/tmp/${m.key}.json`]);
      expect(p.status, `${m.key}: ${p.stderr}`).toBe(0);
      expect(p.body.known, m.key).toBe(true);
      expect(p.body.warnings, m.key).toEqual([]);
      expect(p.body.stream === null, m.key).toBe(m.strategy.project === "PROJ");
      const want = m.strategy.criteria[m.type];
      const ac = p.body.reading.acceptanceCriteria;
      expect(ac.source, m.key).toBe("heading");
      expect(ac.text, m.key).toBe(mock(want, `${m.strategy.id} ${m.type.toLowerCase()}`)); // exactly that section: not the one before, not the one after
      expect(p.body.build.branch, m.key).toMatch(new RegExp(`^${m.strategy.branchType[m.type]}-?|^${m.key}`));
    }
    mcp.close();
  });
  it("dumps tickets.json for review; the engineer changed no rule; no token is in any file", () => {
    const rows = made.map((m) => { const f = jiraFields(m.key); const base = titles(ASSET(DEFAULT_FILE[m.type])), mine = titles(m.strategy.template[m.type]);
      return { key: m.key, url: `${jira.url}/browse/${m.key}`, project: m.strategy.project, stream: m.strategy.project === "PROJ" ? null : `${m.strategy.module} (kanban)`, strategy: m.strategy.id, strategyLabel: m.strategy.label,
        type: m.type, summary: m.summary, labels: f.labels, priority: f.priority.name, epic: f.customfield_10451 ?? null, status: f.status.name,
        sections: mine, added: mine.filter((x) => !base.includes(x)), removed: base.filter((x) => !mine.includes(x)), criteriaSection: m.strategy.criteria[m.type],
        format: /^h[1-6]\./m.test(m.strategy.template[m.type]) ? "Jira wiki" : "Markdown", description: f.description }; });
    write(dir, "tickets.json", JSON.stringify({ jira: jira.url, createdBy: "engineer (own token), templates set by the lead", proofTickets: testKeys, tickets: rows }, null, 2));
    expect(git(root, "status", "--short")).toBe("");
    expect(git(root, "rev-parse", "HEAD")).toBe(git(lead, "rev-parse", "HEAD"));
    for (const [p, t] of textFiles(dir)) for (const tok of [LEAD_TOKEN, ENG_TOKEN]) expect(t.includes(tok), p).toBe(false);
  });
});
