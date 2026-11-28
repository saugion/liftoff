import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/main.js";
import { CONFIG, repo } from "../plan/helpers.js";

// `workspace` in liftoff.yaml needs the release that introduces it: until that is cut, the installed version is mocked.
vi.mock("../../src/cli/version.js", async (actual) => ({ ...(await actual<typeof import("../../src/cli/version.js")>()), INSTALLED_VERSION: "0.8.0" }));

const cfg = CONFIG.replace('version: "0.2"', 'version: "0.8"') + "modules:\n  items:\n    - { id: api, path: api }\nconstraints: { file: CONSTRAINTS.md }\nbrain:\n  lessons: {}\nworkspace:\n  exclude: [api]\n";

describe("lesson-promote: a module in a repository left out", () => {
  it("says why there is no file and what to do, without sending to Init", () => {
    const dir = repo(cfg, { "AGENTS.md": "# app\n", "CONSTRAINTS.md": "# Constraints\n" });
    mkdirSync(join(dir, ".liftoff", "tmp"), { recursive: true });
    const call = (cmd: string, file: object) => {
      writeFileSync(join(dir, ".liftoff/tmp/in.json"), JSON.stringify(file));
      return JSON.parse(run([cmd, "--root", dir, "--file", ".liftoff/tmp/in.json", "--write"], "/").stdout) as Record<string, any>;
    };
    const draft = { key: "api-tests", rule: "Run the API tests with `make test-api`.", kind: "command", target: "agents-md", module: "api", skill: "build", ticket: "PROJ-123", evidence: "use make test-api" };
    expect(call("lesson-add", draft)).toMatchObject({ ok: true });
    const answer = call("lesson-promote", { add: [{ key: "api-tests" }] });
    expect(answer.errors[0]).toMatchObject({ code: "lesson-invalid", message: expect.stringContaining("workspace.exclude") });
    expect(answer.errors[0].message).not.toContain("Init");
    expect(existsSync(join(dir, "api"))).toBe(false);
  });
});
