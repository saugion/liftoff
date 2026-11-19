import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderBlock } from "../../src/brain/lessons-block.js";
import { CONFIG, repo } from "../plan/helpers.js";
import { call, check } from "./helpers.js";

const cfg = (brain: string) => CONFIG.replace('version: "0.2"', 'version: "0.4"') + `modules:\n  items:\n    - { id: api, path: src/api }\nconstraints: { file: CONSTRAINTS.md }\nbrain:\n${brain}`;
const WITH = cfg("  lessons:\n    maxRules: 5\n    reviewAfterDays: 90\n");
const WITHOUT = cfg("  hotMaxLines: 15\n");
const NOW = new Date().toISOString().slice(0, 10);
const R = (key: string, rule: string, since = NOW) => ({ key, rule, since });
const put = (dir: string, rel: string, text: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const agents = (rules: ReturnType<typeof R>[]) => `# app\n\n## Rules that always apply\n\n- Never commit secrets.\n\n${renderBlock(rules, "agents")}\n\n## Modules\n\ntable\n`;
function brain(config = WITH, rules: ReturnType<typeof R>[] = [R("api-test-command", "Run the API tests with `make test-api`.")]) {
  const dir = repo(config, { "AGENTS.md": agents(rules), "CONSTRAINTS.md": "# C\n", "src/api/AGENTS.md": "# api\n" });
  call(dir, "brain-init", "--write");
  return dir;
}
const finding = (body: Record<string, any>, code: string) => [...body.errors, ...body.warnings].filter((f: any) => f.code === code);

describe("brain-check with lessons", () => {
  it("a repo whose block holds promoted rules is ok with no finding", () => {
    const { exitCode, body } = check(brain());
    expect([exitCode, body.errors, body.warnings]).toEqual([0, [], []]);
  });

  const mutations: [string, "errors" | "warnings", string, (dir: string) => void][] = [
    ["lessons-block", "errors", "AGENTS.md", (d) => put(d, "AGENTS.md", `# app\n\n<!-- liftoff lessons: begin (x) -->\nstray prose\n<!-- liftoff lessons: end -->\n`)],
    ["lessons-too-many", "errors", "AGENTS.md", (d) => put(d, "AGENTS.md", agents(Array.from({ length: 6 }, (_, i) => R(`rule-number-${i}`, `Rule ${i} is about something else ${i}.`))))],
    ["lesson-rule-long", "errors", "AGENTS.md", (d) => put(d, "AGENTS.md", agents([R("long-rule", "x".repeat(161))]))],
    ["lesson-weakens", "errors", "AGENTS.md", (d) => put(d, "AGENTS.md", agents([R("api-test-command", "Run the API tests with `make test-api`."), R("skip-e2e", "Skip the e2e tests on CI.")]))],
    ["lesson-duplicate", "warnings", "src/api/AGENTS.md", (d) => put(d, "src/api/AGENTS.md", `# api\n\n${renderBlock([R("api-test-command", "A different wording for the api module.")], "agents")}\n`)],
    ["lesson-review-due", "warnings", "AGENTS.md", (d) => put(d, "AGENTS.md", agents([R("old-rule", "Keep builds green.", "2025-01-01")]))],
    ["agents-md-long", "warnings", "AGENTS.md", (d) => put(d, "AGENTS.md", `${agents([R("api-test-command", "Run `make test-api`.")])}${"- another line of text\n".repeat(300)}`)],
    ["secret", "errors", "AGENTS.md", (d) => put(d, "AGENTS.md", agents([R("deploy-token", "Deploy with glpat-abcdefghij1234567890 always")]))],
    ["instruction-like", "warnings", "AGENTS.md", (d) => put(d, "AGENTS.md", agents([R("push-main", "Agents must always push to main")]))],
    ["personal-lesson-invalid", "warnings", ".liftoff/brain/lessons/broken.md", (d) => put(d, ".liftoff/brain/lessons/broken.md", "garbage\n")],
  ];
  it.each(mutations)("%s", (code, level, file, mutate) => {
    const dir = brain();
    mutate(dir);
    const { exitCode, body } = check(dir);
    const hits = finding(body, code);
    expect(hits.length, JSON.stringify(body)).toBeGreaterThan(0);
    expect(hits[0].file).toBe(file);
    expect(hits[0].level).toBe(level === "errors" ? "error" : "warning");
    if (level === "warnings") expect(body.errors.filter((e: any) => e.code === code)).toEqual([]);
    expect(exitCode).toBe(body.errors.length > 0 ? 1 : 0);
  });

  it("two bullets with the same normalized rule are a duplicate warning", () => {
    const dir = brain(WITH, [R("a-rule", "Run `make test-api`!"), R("b-rule", "run  `make test-api`")]);
    expect(finding(check(dir).body, "lesson-duplicate")).toHaveLength(1);
  });

  it("a bullet gets its own line number", () => {
    const dir = brain(WITH, [R("api-test-command", "Run the API tests with `make test-api`."), R("skip-e2e", "Skip the e2e tests on CI.")]);
    const hit = finding(check(dir).body, "lesson-weakens")[0];
    const lines = readFileSync(join(dir, "AGENTS.md"), "utf8").split("\n");
    expect(lines[hit.line - 1]).toContain("lesson: skip-e2e;");
  });

  it("the constraints file's block is checked too", () => {
    const dir = brain();
    put(dir, "CONSTRAINTS.md", `# C\n\n${renderBlock([R("no-lint", "Disable the lint step")], "constraints")}\n`);
    expect(finding(check(dir).body, "lesson-weakens")[0].file).toBe("CONSTRAINTS.md");
  });
});

describe("without brain.lessons nothing about lessons is checked", () => {
  it("the same hand-made, broken block yields no lessons code", () => {
    const dir = brain(WITHOUT, []);
    put(dir, "AGENTS.md", `# app\n\n<!-- liftoff lessons: begin (x) -->\nstray prose\n- Skip the e2e tests <!-- lesson: skip; since: 2025-01-01 -->\n<!-- liftoff lessons: end -->\n${"- long line\n".repeat(320)}`);
    put(dir, ".liftoff/brain/lessons/broken.md", "garbage\n");
    const { exitCode, body } = check(dir);
    const codes = [...body.errors, ...body.warnings].map((f: any) => f.code);
    for (const c of ["lessons-block", "lessons-too-many", "lesson-rule-long", "lesson-weakens", "lesson-duplicate", "lesson-review-due", "agents-md-long", "personal-lesson-invalid"]) expect(codes, c).not.toContain(c);
    expect(exitCode).toBe(0);
  });
});
