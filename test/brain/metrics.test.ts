import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareSections, sectionHashes, summarize, type MetricEvent } from "../../src/brain/metrics.js";
import { run } from "../../src/cli/main.js";
import { CONFIG, repo } from "../plan/helpers.js";

const cfg = (brain: string) => CONFIG.replace('version: "0.2"', 'version: "0.4"') + `brain:\n${brain}`;
const ON = cfg("  lessons: {}\n");
const OFF = cfg("  lessons:\n    metrics: false\n");
const NO_LESSONS = cfg("  hotMaxLines: 15\n");
const PLAN = (a = "one", b = "two") => `---\nticket: PROJ-1\nstatus: draft\n---\n# Plan\n\n## 1. First\n- [ ] ${a}\n\n## 2. Second\n- [ ] ${b}\n`;
const put = (dir: string, rel: string, text: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const plan = (dir: string, key = "PROJ-1", ...extra: string[]) => { const r = run(["plan", "--root", dir, "--key", key, ...extra], "/"); return { exitCode: r.exitCode, body: JSON.parse(r.stdout) as Record<string, any> }; };
const events = (dir: string): any[] => {
  const d = join(dir, ".liftoff/metrics");
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(join(d, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))) : [];
};
const metrics = (dir: string) => JSON.parse(run(["lesson-metrics", "--root", dir], "/").stdout) as Record<string, any>;

describe("section hashes", () => {
  it("ignore checkbox state and Note: lines, see titles and content", () => {
    const base = sectionHashes(PLAN());
    expect(sectionHashes(PLAN().replace("[ ] one", "[x] one") + "Note: a deviation\n")).toEqual(base);
    expect(sectionHashes(PLAN("changed"))[0]).not.toEqual(base[0]);
    expect(sectionHashes(PLAN("changed"))[1]).toEqual(base[1]);
    expect(sectionHashes(PLAN().replace("## 2. Second", "## 2. Other"))[1]!.title).not.toBe(base[1]!.title);
  });
  it("compareSections counts changed, added and removed", () => {
    const a = sectionHashes(PLAN());
    expect(compareSections(a, sectionHashes(PLAN("x", "y")))).toEqual({ sections: 2, changed: 2, added: 0, removed: 0 });
    expect(compareSections(a, [...a, { title: "t", body: "b" }])).toEqual({ sections: 3, changed: 0, added: 1, removed: 0 });
    expect(compareSections(a, a.slice(0, 1))).toEqual({ sections: 1, changed: 0, added: 0, removed: 1 });
  });
});

describe("nothing is written unless metrics are on", () => {
  it.each([["no brain.lessons", NO_LESSONS], ["metrics: false", OFF]])("%s: plan and plan --approve leave only the plan file", (_n, config) => {
    const dir = repo(config, { ".liftoff/plans/PROJ-1.md": PLAN() });
    plan(dir);
    expect(plan(dir, "PROJ-1", "--approve").body.status).toBe("approved");
    expect(existsSync(join(dir, ".liftoff/metrics"))).toBe(false);
  });
  it("a correction recorded with metrics off writes no event", () => {
    const dir = repo(OFF);
    put(dir, ".liftoff/tmp/l.json", JSON.stringify({ key: "a-rule", rule: "Run `make test`.", kind: "command", target: "agents-md", skill: "build", evidence: "make test" }));
    run(["lesson-add", "--root", dir, "--file", ".liftoff/tmp/l.json", "--write"], "/");
    expect(existsSync(join(dir, ".liftoff/metrics"))).toBe(false);
  });
});

describe("with metrics on", () => {
  it("the first draft is snapshotted once; two sections edited before approval -> changed 2, approval 1", () => {
    const dir = repo(ON, { ".liftoff/plans/PROJ-1.md": PLAN() });
    plan(dir);
    expect(existsSync(join(dir, ".liftoff/metrics/drafts/PROJ-1.json"))).toBe(true);
    put(dir, ".liftoff/plans/PROJ-1.md", PLAN("edited one", "edited two"));
    plan(dir); // a later validation does not replace the snapshot
    plan(dir, "PROJ-1", "--approve");
    expect(events(dir)).toEqual([expect.objectContaining({ e: "plan-approved", key: "PROJ-1", sections: 2, changed: 2, added: 0, removed: 0, approval: 1, afterBuildStart: false, brainPages: 0, lessonRules: 0 })]);
  });

  it("a re-approval after a ticked section is a correction cycle after Build began", () => {
    const dir = repo(ON, { ".liftoff/plans/PROJ-1.md": PLAN() });
    plan(dir);
    plan(dir, "PROJ-1", "--approve");
    put(dir, ".liftoff/plans/PROJ-1.md", readFileSync(join(dir, ".liftoff/plans/PROJ-1.md"), "utf8").replace("[ ] one", "[x] one").replace("[ ] two", "[ ] two, changed"));
    plan(dir, "PROJ-1", "--approve");
    const [first, second] = events(dir);
    expect([first.approval, first.afterBuildStart]).toEqual([1, false]);
    expect(second).toMatchObject({ approval: 2, afterBuildStart: true, changed: 1 });
  });

  it("a plan approved without a draft snapshot records changed 0", () => {
    const dir = repo(ON, { ".liftoff/plans/PROJ-1.md": PLAN() });
    plan(dir, "PROJ-1", "--approve");
    expect(events(dir)[0]).toMatchObject({ changed: 0, approval: 1 });
  });

  it("a correction event holds the skill and kind, never the rule or the words", () => {
    const dir = repo(ON);
    put(dir, ".liftoff/tmp/l.json", JSON.stringify({ key: "a-rule", rule: "Run `make test-api` always.", kind: "command", target: "agents-md", skill: "plan", ticket: "PROJ-1", evidence: "my secret-ish words about make test-api" }));
    run(["lesson-add", "--root", dir, "--file", ".liftoff/tmp/l.json", "--write"], "/");
    const text = readdirSync(join(dir, ".liftoff/metrics")).filter((f) => f.endsWith(".jsonl")).map((f) => readFileSync(join(dir, ".liftoff/metrics", f), "utf8")).join("");
    expect(JSON.parse(text.trim())).toMatchObject({ e: "correction", key: "a-rule", skill: "plan", kind: "command", brainPages: 0, lessonRules: 0 });
    expect(text).not.toContain("make test-api");
    expect(text).not.toContain("PROJ-1");
  });

  it("brainPages and lessonRules count the wiki and the team blocks, and split the bucket", () => {
    const dir = repo(ON, { ".liftoff/plans/PROJ-1.md": PLAN(), ".liftoff/plans/PROJ-2.md": PLAN().replace("PROJ-1", "PROJ-2"), "AGENTS.md": "# a\n" });
    plan(dir);
    plan(dir, "PROJ-1", "--approve");
    put(dir, "brain/wiki/topics/p.md", "x");
    put(dir, "AGENTS.md", "# a\n\n<!-- liftoff lessons: begin (x) -->\n- A rule. <!-- lesson: a-rule; since: 2026-11-19 -->\n<!-- liftoff lessons: end -->\n");
    plan(dir, "PROJ-2", "--approve");
    const [a, b] = events(dir);
    expect([a.brainPages, a.lessonRules, b.brainPages, b.lessonRules]).toEqual([0, 0, 1, 1]);
  });
});

describe("lesson-metrics", () => {
  const approved = (dir: string, key: string) => { put(dir, `.liftoff/plans/${key}.md`, PLAN().replace("PROJ-1", key)); plan(dir, key); plan(dir, key, "--approve"); };

  it("no brain / no lessons -> errors; metrics off -> an empty answer", () => {
    expect(metrics(repo(CONFIG.replace('"0.2"', '"0.4"'))).errors[0].code).toBe("no-brain");
    expect(metrics(repo(NO_LESSONS)).errors[0].code).toBe("no-lessons");
    expect(metrics(repo(OFF))).toMatchObject({ ok: true, enabled: false, months: [] });
  });

  it("summarises by month and bucket and contains no key, rule, path or name", () => {
    const dir = repo(ON, { "AGENTS.md": "# a\n" });
    approved(dir, "PROJ-1");
    put(dir, ".liftoff/tmp/l.json", JSON.stringify({ key: "private-rule", rule: "Run `make secret-target` first.", kind: "command", target: "agents-md", skill: "build", evidence: "never do that again, Alice" }));
    run(["lesson-add", "--root", dir, "--file", ".liftoff/tmp/l.json", "--write"], "/");
    put(dir, ".liftoff/plans/PROJ-1.md", readFileSync(join(dir, ".liftoff/plans/PROJ-1.md"), "utf8") + "Note: used another command\n");
    put(dir, "brain/wiki/topics/p.md", "x");
    approved(dir, "PROJ-2");
    const body = metrics(dir);
    const text = JSON.stringify(body);
    for (const leak of ["PROJ-", "private-rule", "secret-target", "Alice", "/", "AGENTS", ".md"]) expect(text, leak).not.toContain(leak === "/" ? "/tmp" : leak);
    expect(body.months).toHaveLength(1);
    const [m] = body.months;
    expect(m.empty).toMatchObject({ tickets: 1, approvals: 1, corrections: 1, correctionsPerTicket: 1, correctionsBySkill: { build: 1 }, correctionsByKind: { command: 1 }, notesPerTicket: 1 });
    expect(m.brain).toMatchObject({ tickets: 1, corrections: 0, notesPerTicket: 0 });
  });

  it("summarize: mean changed sections and re-approvals after Build began", () => {
    const ev = (over: Partial<Extract<MetricEvent, { e: "plan-approved" }>>): MetricEvent => ({ e: "plan-approved", t: "2026-11-19", key: "K-1", sections: 3, changed: 0, added: 0, removed: 0, approval: 1, afterBuildStart: false, brainPages: 0, lessonRules: 0, ...over });
    const [m] = summarize([ev({ changed: 2 }), ev({ key: "K-2", changed: 0 }), ev({ key: "K-2", approval: 2, afterBuildStart: true, changed: 1 })], () => 0);
    expect(m!.empty).toMatchObject({ tickets: 2, approvals: 3, meanChangedSections: 1, reApprovalsAfterBuildStart: 1 });
    expect(m!.brain).toBeNull();
  });
});
