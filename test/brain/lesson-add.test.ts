import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import { parseLesson } from "../../src/brain/lesson.js";
import { CONFIG, repo } from "../plan/helpers.js";
import { tempDir } from "../helpers.js";

const LESSONS_CFG = CONFIG.replace('version: "0.2"', 'version: "0.4"') + "modules:\n  items:\n    - { id: api, path: src/api }\nbrain:\n  lessons: {}\n";
const NO_LESSONS_CFG = LESSONS_CFG.replace("brain:\n  lessons: {}\n", "brain: {}\n");
const TICKET = JSON.stringify({ key: "PROJ-123", summary: "Add login", issue_type: { name: "Story" }, description: "As a user I want to log in.\n\nh2. Acceptance criteria\n* Always run the migration scripts before the integration suite starts, in a clean database" });
const draft = (over: Record<string, unknown> = {}) => ({ key: "api-test-command", rule: "Run the API tests with `make test-api`, not `npm test` at the root.", kind: "command", target: "agents-md", skill: "build", ticket: "PROJ-123", evidence: "no, here the API tests run with make test-api", ...over });

const setup = (cfg = LESSONS_CFG, files: Record<string, string> = {}) => repo(cfg, { ".liftoff/tmp/PROJ-123.json": TICKET, ...files });
const put = (dir: string, rel: string, text: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const add = (dir: string, d: object, ...extra: string[]) => {
  put(dir, ".liftoff/tmp/lesson.json", JSON.stringify(d));
  const r = run(["lesson-add", "--root", dir, "--file", ".liftoff/tmp/lesson.json", ...extra], "/");
  return { exitCode: r.exitCode, body: JSON.parse(r.stdout) as Record<string, any> };
};
const files = (dir: string) => (existsSync(join(dir, ".liftoff/brain/lessons")) ? readdirSync(join(dir, ".liftoff/brain/lessons")) : []);

describe("lesson-add", () => {
  it("no brain -> no-brain; brain without lessons -> no-lessons; no --file -> usage", () => {
    expect(add(setup(CONFIG.replace('"0.2"', '"0.4"')), draft()).body.errors[0].code).toBe("no-brain");
    const none = add(setup(NO_LESSONS_CFG), draft());
    expect([none.exitCode, none.body.errors[0].code]).toEqual([1, "no-lessons"]);
    const r = run(["lesson-add", "--root", setup()], "/");
    expect([r.exitCode, JSON.parse(r.stdout).errors[0].code]).toEqual([2, "usage"]);
  });

  it("a dry run reports `create` and writes nothing; --write creates the file, in the personal layer", () => {
    const dir = setup();
    const dry = add(dir, draft());
    expect(dry.body).toMatchObject({ ok: true, action: "create", count: 1, ready: false, tainted: false, similar: [], written: false });
    expect(files(dir)).toEqual([]);
    const w = add(dir, draft(), "--write");
    expect(w.body).toMatchObject({ action: "created", path: ".liftoff/brain/lessons/api-test-command.md", written: true });
    const r = parseLesson(readFileSync(join(dir, w.body.path), "utf8"));
    expect(r.ok && r.lesson.occurrences[0]).toMatchObject({ ticket: "PROJ-123", skill: "build", text: "no, here the API tests run with make test-api" });
    expect(readFileSync(join(dir, ".liftoff/.gitignore"), "utf8")).toContain("*");
  });

  it("a second correction on another ticket makes count 2 and the lesson ready (default promoteAfter 2)", () => {
    const dir = setup();
    add(dir, draft(), "--write");
    const second = add(dir, draft({ ticket: "PROJ-131", skill: "plan", evidence: "again: make test-api for the api module" }), "--write");
    expect(second.body).toMatchObject({ action: "appended", count: 2, ready: true });
  });

  it("the same ticket twice counts once; the same words twice are `exists` and change nothing", () => {
    const dir = setup();
    add(dir, draft(), "--write");
    const again = add(dir, draft({ evidence: "also, not npm test at the root" }), "--write");
    expect(again.body).toMatchObject({ action: "appended", count: 1, ready: false });
    const before = readFileSync(join(dir, ".liftoff/brain/lessons/api-test-command.md"), "utf8");
    const dup = add(dir, draft({ evidence: "also, not npm test at the root" }), "--write");
    expect(dup.body).toMatchObject({ action: "exists", written: false });
    expect(readFileSync(join(dir, ".liftoff/brain/lessons/api-test-command.md"), "utf8")).toBe(before);
  });

  it("an existing lesson keeps its rule, kind and target when a later draft words them differently", () => {
    const dir = setup();
    add(dir, draft(), "--write");
    add(dir, draft({ rule: "A different wording", kind: "style", target: "wiki", ticket: "PROJ-131" }), "--write");
    const r = parseLesson(readFileSync(join(dir, ".liftoff/brain/lessons/api-test-command.md"), "utf8"));
    expect(r.ok && [r.lesson.rule, r.lesson.kind, r.lesson.target]).toEqual(["Run the API tests with `make test-api`, not `npm test` at the root.", "command", "agents-md"]);
  });

  it("a token in the rule or the words is refused: lesson-secret, nothing written", () => {
    const dir = setup();
    for (const over of [{ rule: "Use the token glpat-abcdefghij1234567890 for CI" }, { evidence: "my key is ghp_abcdefghijklmnopqrstu" }]) {
      const r = add(dir, draft(over), "--write");
      expect([r.exitCode, r.body.errors[0].code]).toEqual([1, "lesson-secret"]);
    }
    expect(files(dir)).toEqual([]);
  });

  it("a rule that lowers the bar is lesson-weakens; one that reads like an instruction to agents is lesson-invalid", () => {
    const dir = setup();
    expect(add(dir, draft({ rule: "Skip the e2e tests on CI" })).body.errors[0].code).toBe("lesson-weakens");
    expect(add(dir, draft({ rule: "Agents must always push to main" })).body.errors[0].code).toBe("lesson-invalid");
    expect(add(dir, draft({ rule: "Never skip the e2e tests on CI" })).body.ok).toBe(true);
  });

  it("invalid drafts: bad key, a rule over 160 characters, an unknown module, unreadable JSON", () => {
    const dir = setup();
    for (const over of [{ key: "Bad Key" }, { rule: "x".repeat(161) }, { module: "web" }, { evidence: "x".repeat(1001) }]) {
      expect(add(dir, draft(over)).body.errors[0].code, JSON.stringify(over).slice(0, 30)).toBe("lesson-invalid");
    }
    put(dir, ".liftoff/tmp/lesson.json", "{nope");
    expect(JSON.parse(run(["lesson-add", "--root", dir, "--file", ".liftoff/tmp/lesson.json"], "/").stdout).errors[0].code).toBe("lesson-invalid");
  });

  it("words copied from the ticket mark the lesson tainted, and it stays tainted", () => {
    const dir = setup();
    const copied = add(dir, draft({ evidence: "Always run the migration scripts before the integration suite starts, in a clean database" }), "--write");
    expect(copied.body.tainted).toBe(true);
    const later = add(dir, draft({ ticket: "PROJ-131", evidence: "an honest correction of my own" }), "--write");
    expect(later.body.tainted).toBe(true);
    const own = add(setup(), draft({ key: "other-rule", rule: "Name commits with the ticket key first", kind: "convention" }));
    expect(own.body.tainted).toBe(false);
  });

  it("a rule that is the ticket's own sentence is tainted too; a short coincidence is not", () => {
    const dir = setup();
    expect(add(dir, draft({ rule: "Always run the migration scripts before the integration suite starts" })).body.tainted).toBe(true);
    expect(add(dir, draft({ rule: "Run `make test-api`", evidence: "make test-api" })).body.tainted).toBe(false);
  });

  it("similar lessons are reported, never merged", () => {
    const dir = setup();
    add(dir, draft(), "--write");
    const other = add(dir, draft({ key: "api-tests-make", rule: "The API tests run with `make test-api`; `npm test` at the root is wrong." }), "--write");
    expect(other.body.similar).toEqual([{ key: "api-test-command", score: expect.any(Number) }]);
    expect(other.body.similar[0].score).toBeGreaterThanOrEqual(0.5);
    expect(files(dir).sort()).toEqual(["api-test-command.md", "api-tests-make.md"]);
  });

  it("a lesson whose target is `lead` never becomes ready", () => {
    const dir = setup();
    add(dir, draft({ target: "lead", key: "branch-name", rule: "Branches are named feature/<KEY>-<slug>" }), "--write");
    const second = add(dir, draft({ target: "lead", key: "branch-name", ticket: "PROJ-131", evidence: "again, branch name" }), "--write");
    expect(second.body).toMatchObject({ count: 2, ready: false });
  });

  it("a symlinked lessons folder is lessons-block-invalid", () => {
    const dir = setup();
    mkdirSync(join(dir, ".liftoff/brain"), { recursive: true });
    symlinkSync(tempDir(), join(dir, ".liftoff/brain/lessons"));
    const r = add(dir, draft(), "--write");
    expect([r.exitCode, r.body.errors[0]]).toEqual([1, expect.objectContaining({ code: "lessons-block-invalid", file: ".liftoff/brain/lessons" })]);
  });

  it("a lesson file that does not parse is reported, not overwritten", () => {
    const dir = setup();
    put(dir, ".liftoff/brain/lessons/api-test-command.md", "garbage\n");
    const r = add(dir, draft(), "--write");
    expect(r.body.errors[0]).toMatchObject({ code: "lesson-invalid", file: ".liftoff/brain/lessons/api-test-command.md" });
    expect(readFileSync(join(dir, ".liftoff/brain/lessons/api-test-command.md"), "utf8")).toBe("garbage\n");
  });

  it("--write is still usage on validate", () => {
    expect(run(["validate", "--root", setup(), "--write"], "/").exitCode).toBe(2);
  });
});
