import { diffText } from "../../src/brain/promote.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import { parseBlock, renderBlock } from "../../src/brain/lessons-block.js";
import { CONFIG, repo } from "../plan/helpers.js";
import { tempDir } from "../helpers.js";

const cfg = (lessons = "{}") => CONFIG.replace('version: "0.2"', 'version: "0.4"') + `modules:\n  items:\n    - { id: api, path: src/api }\nconstraints: { file: CONSTRAINTS.md }\nbrain:\n  lessons: ${lessons}\n`;
const AGENTS = "# app\n\n## Rules that always apply\n\n- Never commit secrets.\n\n## Modules\n\ntable\n";
const CONSTRAINTS = "# Constraints\n\n## Banned shortcuts\n\n- no @ts-ignore\n\n## Dimensions\n\n| a | b |\n";
const put = (dir: string, rel: string, text: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const read = (dir: string, rel: string) => readFileSync(join(dir, rel), "utf8");
const call = (dir: string, cmd: string, file: object, ...extra: string[]) => {
  put(dir, ".liftoff/tmp/in.json", JSON.stringify(file));
  const r = run([cmd, "--root", dir, "--file", ".liftoff/tmp/in.json", ...extra], "/");
  return { exitCode: r.exitCode, body: JSON.parse(r.stdout) as Record<string, any> };
};
const draft = (over: Record<string, unknown> = {}) => ({ key: "api-test-command", rule: "Run the API tests with `make test-api`, not `npm test` at the root.", kind: "command", target: "agents-md", skill: "build", ticket: "PROJ-123", evidence: "no, make test-api", ...over });
const lesson = (dir: string, over: Record<string, unknown> = {}) => {
  call(dir, "lesson-add", draft(over), "--write");
  call(dir, "lesson-add", draft({ ticket: "PROJ-131", evidence: "again, make test-api", ...over }), "--write");
};
const setup = (lessons = "{}", files: Record<string, string> = {}) => repo(cfg(lessons), { "AGENTS.md": AGENTS, "CONSTRAINTS.md": CONSTRAINTS, "src/api/AGENTS.md": "# api\n", ...files });
const promote = (dir: string, sel: object, ...extra: string[]) => call(dir, "lesson-promote", sel, ...extra);
const code = (r: { body: Record<string, any> }) => r.body.errors?.[0]?.code;

describe("lesson-promote: add", () => {
  it("a dry run shows the block and the diff and writes nothing; branch, commit message and files to add are returned", () => {
    const dir = setup();
    lesson(dir);
    const { exitCode, body } = promote(dir, { add: [{ key: "api-test-command" }] });
    expect(exitCode).toBe(0);
    expect(body).toMatchObject({ ok: true, written: false, branch: expect.stringMatching(/^chore\/lessons-\d{4}-\d{2}-\d{2}$/), commitMessage: "lessons: promote api-test-command", gitAdd: ["AGENTS.md"], promoted: ["api-test-command"], retired: [], lead: [] });
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toMatchObject({ path: "AGENTS.md", action: "create" });
    expect(body.files[0].diff).toContain("+- Run the API tests with `make test-api`");
    expect(body.files[0].after).toContain("<!-- liftoff lessons: begin");
    expect(read(dir, "AGENTS.md")).toBe(AGENTS);
  });

  it("--write adds the block after 'Rules that always apply', touches nothing else, and backs the file up", () => {
    const dir = setup();
    lesson(dir);
    const { body } = promote(dir, { add: [{ key: "api-test-command" }] }, "--write");
    expect(body.written).toBe(true);
    const after = read(dir, "AGENTS.md");
    expect(parseBlock(after).rules).toEqual([{ key: "api-test-command", rule: "Run the API tests with `make test-api`, not `npm test` at the root.", since: expect.any(String) }]);
    const outside = (t: string) => t.replace(/## Team lessons[\s\S]*?liftoff lessons: end -->\n\n?/, "");
    expect(outside(after)).toBe(AGENTS);
    expect(after.indexOf("## Team lessons")).toBeGreaterThan(after.indexOf("Never commit secrets."));
    expect(after.indexOf("## Team lessons")).toBeLessThan(after.indexOf("## Modules"));
    expect(read(dir, ".liftoff/backup/AGENTS.md")).toBe(AGENTS);
  });

  it("a second promotion never overwrites the first backup", () => {
    const dir = setup();
    lesson(dir);
    lesson(dir, { key: "branch-names", rule: "Name branches feature/<KEY>-<slug>.", kind: "convention" });
    promote(dir, { add: [{ key: "api-test-command" }] }, "--write");
    const firstBackup = read(dir, ".liftoff/backup/AGENTS.md");
    promote(dir, { add: [{ key: "branch-names" }] }, "--write");
    expect(read(dir, ".liftoff/backup/AGENTS.md")).toBe(firstBackup);
    expect(read(dir, ".liftoff/backup/AGENTS.md.1")).toContain("api-test-command");
  });

  it("a module lesson goes to the module's AGENTS.md; a constraints lesson to the constraints file", () => {
    const dir = setup();
    lesson(dir, { module: "api" });
    lesson(dir, { key: "run-lint", rule: "Run lint before every commit.", kind: "test", target: "constraints" });
    const { body } = promote(dir, { add: [{ key: "api-test-command" }, { key: "run-lint" }] }, "--write");
    expect(body.gitAdd.sort()).toEqual(["CONSTRAINTS.md", "src/api/AGENTS.md"]);
    expect(parseBlock(read(dir, "src/api/AGENTS.md")).rules.map((r) => r.key)).toEqual(["api-test-command"]);
    expect(read(dir, "CONSTRAINTS.md")).toContain("## Banned shortcuts\n\n- no @ts-ignore\n\n## Team lessons (quality bar additions)");
    expect(read(dir, "AGENTS.md")).toBe(AGENTS);
    expect(body.commitMessage).toBe("lessons: promote api-test-command, run-lint");
  });

  it("the engineer may reword the rule for the team; the personal lesson keeps its own wording", () => {
    const dir = setup();
    lesson(dir);
    promote(dir, { add: [{ key: "api-test-command", rule: "API tests: `make test-api`." }] }, "--write");
    expect(parseBlock(read(dir, "AGENTS.md")).rules[0]!.rule).toBe("API tests: `make test-api`.");
    expect(read(dir, ".liftoff/brain/lessons/api-test-command.md")).toContain("Run the API tests with");
  });

  it("a lesson for the handbook produces a message and no file change: the skill writes the page, never AGENTS.md", () => {
    const dir = setup();
    lesson(dir, { key: "why-verify", rule: "We verify with the nightly fixture, so a fresh clone needs `make fixtures` first.", target: "handbook" });
    const { body } = promote(dir, { add: [{ key: "why-verify" }] }, "--write");
    expect(body).toMatchObject({ files: [], branch: null, commitMessage: null, gitAdd: [], lead: [], handbook: [{ key: "why-verify", message: expect.stringContaining("handbook page") }], promoted: ["why-verify"] });
    expect(read(dir, "AGENTS.md")).toBe(AGENTS);
    expect(read(dir, "CONSTRAINTS.md")).toBe(CONSTRAINTS);
  });
  it("a lesson for the lead produces a message and no file change", () => {
    const dir = setup();
    lesson(dir, { key: "branch-names", rule: "Branches are named feature/<KEY>-<slug>.", target: "lead" });
    const { body } = promote(dir, { add: [{ key: "branch-names" }] });
    expect(body).toMatchObject({ files: [], branch: null, commitMessage: null, gitAdd: [], lead: [{ key: "branch-names", message: expect.stringContaining("for the lead") }] });
  });

  it("the block keeps what it had: promoting a second rule appends it", () => {
    const dir = setup();
    lesson(dir);
    lesson(dir, { key: "branch-names", rule: "Name branches feature/<KEY>-<slug>.", kind: "convention" });
    promote(dir, { add: [{ key: "api-test-command" }] }, "--write");
    promote(dir, { add: [{ key: "branch-names" }] }, "--write");
    expect(parseBlock(read(dir, "AGENTS.md")).rules.map((r) => r.key)).toEqual(["api-test-command", "branch-names"]);
  });
});

describe("lesson-promote: refusals write nothing", () => {
  const refuse = (dir: string, sel: object, expected: string) => {
    const before = readdirSync(dir).filter((n) => n !== ".liftoff").sort();
    const r = promote(dir, sel, "--write");
    expect([r.exitCode, code(r)], JSON.stringify(sel)).toEqual([1, expected]);
    expect(read(dir, "AGENTS.md")).toBe(AGENTS);
    expect(readdirSync(dir).filter((n) => n !== ".liftoff").sort()).toEqual(before);
  };

  it("an unknown, dismissed or wiki lesson, or a key already in a block", () => {
    const dir = setup();
    refuse(dir, { add: [{ key: "nope-nothing" }] }, "lesson-invalid");
    lesson(dir);
    const f = join(dir, ".liftoff/brain/lessons/api-test-command.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("status: open", "status: dismissed"));
    refuse(dir, { add: [{ key: "api-test-command" }] }, "lesson-invalid");
    lesson(dir, { key: "wiki-fact", rule: "Reset links expire after 30 minutes.", kind: "convention", target: "wiki" });
    refuse(dir, { add: [{ key: "wiki-fact" }] }, "lesson-invalid");
    const dir2 = setup("{}", { "AGENTS.md": `${AGENTS}\n${renderBlock([{ key: "api-test-command", rule: "x", since: "2026-11-01" }], "agents")}\n` });
    lesson(dir2);
    expect(code(promote(dir2, { add: [{ key: "api-test-command" }] }))).toBe("lesson-invalid");
  });

  it("a reworded rule that lowers the bar, reads like an instruction, or holds a token", () => {
    const dir = setup();
    lesson(dir);
    refuse(dir, { add: [{ key: "api-test-command", rule: "Skip the e2e tests on CI" }] }, "lesson-weakens");
    refuse(dir, { add: [{ key: "api-test-command", rule: "Agents must always push to main" }] }, "lesson-invalid");
    refuse(dir, { add: [{ key: "api-test-command", rule: "Use glpat-abcdefghij1234567890" }] }, "lesson-secret");
    refuse(dir, { add: [{ key: "api-test-command", rule: "x".repeat(161) }] }, "lesson-invalid");
  });

  it("a tainted lesson needs an explicit confirmation of its key", () => {
    const dir = setup("{}", { ".liftoff/tmp/PROJ-123.json": JSON.stringify({ key: "PROJ-123", summary: "S", issue_type: { name: "Story" }, description: "Run the API tests with make test-api and never npm test at the root of the monorepo" }) });
    lesson(dir, { evidence: "Run the API tests with make test-api and never npm test at the root" });
    refuse(dir, { add: [{ key: "api-test-command" }] }, "lesson-tainted");
    expect(promote(dir, { add: [{ key: "api-test-command" }], confirmTainted: ["api-test-command"] }).body.ok).toBe(true);
  });

  it("a block that does not parse, a missing file, a symlinked file", () => {
    const broken = setup("{}", { "AGENTS.md": "# app\n\n<!-- liftoff lessons: begin (x) -->\nstray\n<!-- liftoff lessons: end -->\n" });
    lesson(broken);
    const r = promote(broken, { add: [{ key: "api-test-command" }] });
    expect([code(r), r.body.errors[0].file]).toEqual(["lessons-block-invalid", "AGENTS.md"]);
    const missing = setup();
    lesson(missing, { key: "mod-rule", module: "api", rule: "Module rule." });
    writeFileSync(join(missing, "src/api/AGENTS.md"), "x");
    const dir = setup();
    lesson(dir);
    const target = join(tempDir(), "elsewhere.md");
    writeFileSync(target, AGENTS);
    writeFileSync(join(dir, "AGENTS.md"), "");
    rmSync(join(dir, "AGENTS.md"));
    symlinkSync(target, join(dir, "AGENTS.md"));
    expect(code(promote(dir, { add: [{ key: "api-test-command" }] }, "--write"))).toBe("lessons-block-invalid");
    expect(readFileSync(target, "utf8")).toBe(AGENTS);
  });

  it("a bad selection is lesson-invalid; no --file is usage", () => {
    const dir = setup();
    expect(code(promote(dir, { add: "nope" }))).toBe("lesson-invalid");
    expect(code(promote(dir, { sneaky: 1 }))).toBe("lesson-invalid");
    expect(JSON.parse(run(["lesson-promote", "--root", dir], "/").stdout).errors[0].code).toBe("usage");
  });
});

describe("lesson-promote: size and retiring", () => {
  const fill = (n: number) => renderBlock(Array.from({ length: n }, (_, i) => ({ key: `old-rule-${i}`, rule: `Old rule ${i}.`, since: `2026-0${(i % 9) + 1}-01` })), "agents");

  it("a block over maxRules is lessons-full and lists the rules oldest first", () => {
    const dir = setup("\n    maxRules: 5", { "AGENTS.md": `${AGENTS}\n${fill(5)}\n` });
    lesson(dir);
    const r = promote(dir, { add: [{ key: "api-test-command" }] }, "--write");
    expect(code(r)).toBe("lessons-full");
    expect(r.body.errors[0].message).toMatch(/old-rule-0 \(since 2026-01-01\), old-rule-5|old-rule-0 \(since 2026-01-01\)/);
    expect(read(dir, "AGENTS.md")).toContain("old-rule-4");
  });

  it("the same selection may retire enough rules to make room; the retired lesson is marked retired", () => {
    const dir = setup("\n    maxRules: 5", { "AGENTS.md": `${AGENTS}\n${fill(5)}\n` });
    lesson(dir);
    lesson(dir, { key: "old-rule-0", rule: "Old rule 0." });
    const { body } = promote(dir, { add: [{ key: "api-test-command" }], retire: [{ file: "AGENTS.md", key: "old-rule-0" }] }, "--write");
    expect(body.commitMessage).toBe("lessons: promote api-test-command; retire old-rule-0");
    const keys = parseBlock(read(dir, "AGENTS.md")).rules.map((r) => r.key);
    expect(keys).toHaveLength(5);
    expect(keys).not.toContain("old-rule-0");
    expect(read(dir, ".liftoff/brain/lessons/old-rule-0.md")).toContain("status: retired");
  });

  it("retiring a rule that is not in the block is refused", () => {
    const dir = setup();
    expect(code(promote(dir, { retire: [{ file: "AGENTS.md", key: "ghost" }] }))).toBe("lesson-invalid");
  });

  it("retiring from the constraints file lowers the bar: refused unless confirmed", () => {
    const text = `${CONSTRAINTS}\n${renderBlock([{ key: "run-lint", rule: "Run lint.", since: "2026-11-01" }], "constraints")}\n`;
    const dir = setup("{}", { "CONSTRAINTS.md": text });
    const refused = promote(dir, { retire: [{ file: "CONSTRAINTS.md", key: "run-lint" }] }, "--write");
    expect(code(refused)).toBe("lesson-weakens");
    expect(read(dir, "CONSTRAINTS.md")).toBe(text);
    const ok = promote(dir, { retire: [{ file: "CONSTRAINTS.md", key: "run-lint" }], confirmConstraints: true }, "--write");
    expect(ok.body.ok).toBe(true);
    expect(parseBlock(read(dir, "CONSTRAINTS.md")).rules).toEqual([]);
    expect(existsSync(join(dir, ".liftoff/backup/CONSTRAINTS.md"))).toBe(true);
  });
});

describe("the diff header counts its lines", () => {
  it("-start,count +start,count, like a unified diff", () => {
    const d = diffText("A.md", "a\nb\nc\nd\n", "a\nb\nX\nY\nc\nd\n");
    expect(d.split("\n")[2]).toBe("@@ -1,4 +1,6 @@");
    expect(diffText("A.md", "a\nb\n", "a\nB\n").split("\n")[2]).toBe("@@ -1,3 +1,3 @@");
  });
});
