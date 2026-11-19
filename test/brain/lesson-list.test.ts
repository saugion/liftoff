import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import { renderBlock } from "../../src/brain/lessons-block.js";
import { CONFIG, repo } from "../plan/helpers.js";
import { tempDir } from "../helpers.js";

const CFG = CONFIG.replace('version: "0.2"', 'version: "0.4"') + "modules:\n  items:\n    - { id: api, path: src/api }\nbrain:\n  lessons: {}\n";
const put = (dir: string, rel: string, text: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const list = (dir: string) => { const r = run(["lesson-list", "--root", dir], "/"); return { exitCode: r.exitCode, body: JSON.parse(r.stdout) as Record<string, any> }; };
const add = (dir: string, d: object) => { put(dir, ".liftoff/tmp/lesson.json", JSON.stringify(d)); return JSON.parse(run(["lesson-add", "--root", dir, "--file", ".liftoff/tmp/lesson.json", "--write"], "/").stdout); };
const draft = (over: Record<string, unknown> = {}) => ({ key: "api-test-command", rule: "Run the API tests with `make test-api`, not `npm test` at the root.", kind: "command", target: "agents-md", skill: "build", ticket: "PROJ-123", evidence: "no, make test-api", ...over });
const twice = (dir: string, over: Record<string, unknown> = {}) => { add(dir, draft(over)); add(dir, draft({ ticket: "PROJ-131", evidence: "again, make test-api", ...over })); };
const block = (key: string, rule: string, since = "2026-11-19") => `# rules\n\n${renderBlock([{ key, rule, since }], "agents")}\n`;

describe("lesson-list", () => {
  it("no brain -> no-brain; no lessons -> no-lessons", () => {
    expect(list(repo(CONFIG.replace('"0.2"', '"0.4"'))).body.errors[0].code).toBe("no-brain");
    expect(list(repo(CFG.replace("brain:\n  lessons: {}\n", "brain: {}\n"))).body.errors[0].code).toBe("no-lessons");
  });

  it("nothing yet: empty lists and exit 0", () => {
    expect(list(repo(CFG, { "AGENTS.md": "# rules\n" }))).toMatchObject({ exitCode: 0, body: { ok: true, lessons: [], shared: [], ready: [], warnings: [] } });
  });

  it("a lesson corrected on two tickets is ready; on one ticket it is not", () => {
    const dir = repo(CFG, { "AGENTS.md": "# rules\n" });
    add(dir, draft());
    expect(list(dir).body.ready).toEqual([]);
    add(dir, draft({ ticket: "PROJ-131", evidence: "again, make test-api" }));
    const { body } = list(dir);
    expect(body.ready).toEqual(["api-test-command"]);
    expect(body.lessons[0]).toMatchObject({ key: "api-test-command", status: "open", count: 2, ready: true, module: null, path: ".liftoff/brain/lessons/api-test-command.md" });
  });

  it("a key in the root AGENTS.md block is promoted, and not ready", () => {
    const dir = repo(CFG, { "AGENTS.md": block("api-test-command", "Run the API tests with `make test-api`.") });
    twice(dir);
    const { body } = list(dir);
    expect(body.lessons[0]).toMatchObject({ status: "promoted", ready: false });
    expect(body.shared).toEqual([{ file: "AGENTS.md", key: "api-test-command", rule: "Run the API tests with `make test-api`.", since: "2026-11-19", reviewDue: false }]);
    expect(body.ready).toEqual([]);
  });

  it("a key in a module's AGENTS.md block is promoted too; remove the block and it is ready again", () => {
    const dir = repo(CFG, { "AGENTS.md": "# rules\n", "src/api/AGENTS.md": block("api-test-command", "Run `make test-api`.") });
    twice(dir, { module: "api" });
    expect(list(dir).body.lessons[0].status).toBe("promoted");
    expect(list(dir).body.shared[0].file).toBe("src/api/AGENTS.md");
    put(dir, "src/api/AGENTS.md", "# api\n");
    const back = list(dir).body;
    expect(back.lessons[0]).toMatchObject({ status: "open", ready: true });
    expect(back.ready).toEqual(["api-test-command"]);
  });

  it("a rule in the constraints file is listed, and a rule older than reviewAfterDays is due for review", () => {
    const dir = repo(CFG, { "AGENTS.md": "# rules\n", "CONSTRAINTS.md": `# C\n\n${renderBlock([{ key: "old-rule", rule: "Keep builds green.", since: "2025-01-01" }, { key: "new-rule", rule: "Run lint.", since: new Date().toISOString().slice(0, 10) }], "constraints")}\n` });
    const { body } = list(dir);
    expect(body.shared.map((s: any) => [s.key, s.reviewDue])).toEqual([["old-rule", true], ["new-rule", false]]);
  });

  it("a dismissed lesson is never ready; a lesson for the lead is never ready", () => {
    const dir = repo(CFG, { "AGENTS.md": "# rules\n" });
    twice(dir);
    twice(dir, { key: "branch-names", rule: "Branches are named feature/<KEY>-<slug>.", target: "lead" });
    const file = join(dir, ".liftoff/brain/lessons/api-test-command.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("status: open", "status: dismissed"));
    const { body } = list(dir);
    expect(body.ready).toEqual([]);
    expect(body.lessons.find((l: any) => l.key === "api-test-command").status).toBe("dismissed");
    expect(body.lessons.find((l: any) => l.key === "branch-names")).toMatchObject({ count: 2, ready: false });
  });

  it("a personal file that does not parse is a warning only, and exit stays 0", () => {
    const dir = repo(CFG, { "AGENTS.md": "# rules\n" });
    twice(dir);
    put(dir, ".liftoff/brain/lessons/broken.md", "garbage\n");
    const { exitCode, body } = list(dir);
    expect(exitCode).toBe(0);
    expect(body.warnings).toEqual([expect.objectContaining({ code: "personal-lesson-invalid", file: ".liftoff/brain/lessons/broken.md" })]);
    expect(body.lessons.map((l: any) => l.key)).toEqual(["api-test-command"]);
  });

  it("a malformed shared block is a warning with its line; similar lessons are listed", () => {
    const dir = repo(CFG, { "AGENTS.md": "# rules\n\n<!-- liftoff lessons: begin (x) -->\nstray\n<!-- liftoff lessons: end -->\n" });
    twice(dir);
    add(dir, draft({ key: "api-tests-make", rule: "The API tests run with `make test-api`; `npm test` at the root is wrong." }));
    const { body } = list(dir);
    expect(body.warnings).toEqual([expect.objectContaining({ code: "lessons-block-invalid", file: "AGENTS.md", line: 4 })]);
    expect(body.lessons.find((l: any) => l.key === "api-tests-make").similar).toEqual([{ key: "api-test-command", score: expect.any(Number) }]);
  });

  it("a symlinked lessons folder is lessons-block-invalid", () => {
    const dir = repo(CFG, { "AGENTS.md": "# rules\n" });
    mkdirSync(join(dir, ".liftoff/brain"), { recursive: true });
    symlinkSync(tempDir(), join(dir, ".liftoff/brain/lessons"));
    expect(list(dir).body.errors[0].code).toBe("lessons-block-invalid");
  });
});
