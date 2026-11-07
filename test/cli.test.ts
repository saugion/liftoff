import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type Handler, run } from "../src/cli/main.js";
import { buildTempBundle, runBundle, tempDir } from "./helpers.js";

const parse = (stdout: string) => {
  expect(stdout.endsWith("\n")).toBe(true);
  return JSON.parse(stdout) as Record<string, any>;
};

describe("run()", () => {
  const dir = tempDir();

  it("--help prints {usage} and exits 0", () => {
    const r = run(["--help"], dir);
    expect(r.exitCode).toBe(0);
    expect(parse(r.stdout).usage).toContain("liftoff");
  });

  it.each([
    ["no command", []],
    ["unknown command", ["frobnicate"]],
    ["extra argument", ["validate", "extra"]],
    ["unknown flag", ["validate", "--nope"]],
    ["--overwrite on validate", ["validate", "--overwrite", "CLAUDE.md"]],
    ["--overwrite on check-config", ["check-config", "--overwrite", "CLAUDE.md"]],
    ["root does not exist", ["validate", "--root", join(dir, "missing")]],
  ])("usage error, exit 2: %s", (_name, argv) => {
    const r = run(argv, dir);
    expect(r.exitCode).toBe(2);
    const out = parse(r.stdout);
    expect(out.ok).toBe(false);
    expect(out.errors[0].code).toBe("usage");
    expect(out.root).toBeTypeOf("string");
  });

  it("root that is a file is a usage error", () => {
    const file = join(dir, "a-file");
    writeFileSync(file, "x");
    const r = run(["validate", "--root", file], dir);
    expect(r.exitCode).toBe(2);
    expect(parse(r.stdout).errors[0].code).toBe("usage");
  });

  it("resolves --root to an absolute path and defaults to cwd", () => {
    expect(parse(run(["validate", "--root", dir], "/").stdout).root).toBe(dir);
    expect(parse(run(["validate"], dir).stdout).root).toBe(dir);
  });

  it("dispatches to the handler and adds root; --overwrite is collected for render", () => {
    let seen: unknown;
    const table: Record<string, Handler> = {
      render: (ctx) => {
        seen = ctx;
        return { exitCode: 1, body: { ok: false, errors: [] } };
      },
    };
    const r = run(["render", "--root", dir, "--overwrite", "a", "--overwrite=b"], "/", table);
    expect(r.exitCode).toBe(1);
    expect(parse(r.stdout).root).toBe(dir);
    expect(seen).toEqual({ root: dir, overwrite: ["a", "b"] });
  });

  it("a throwing handler becomes an internal error: JSON on stdout, stack on stderr, exit 2", () => {
    const table: Record<string, Handler> = {
      validate: () => {
        throw new Error("boom");
      },
    };
    const r = run(["validate"], dir, table);
    expect(r.exitCode).toBe(2);
    expect(parse(r.stdout).errors[0]).toEqual({ code: "internal", message: "boom" });
    expect(r.stderr).toContain("boom");
  });

  it("check-config and render are registered stubs (exit 2, internal) until their tasks land", () => {
    for (const c of ["check-config", "render"]) {
      const r = run([c], dir);
      expect(r.exitCode).toBe(2);
      expect(parse(r.stdout).errors[0].code).toBe("internal");
    }
  });
});

describe("built binary", () => {
  let file = "";
  beforeAll(async () => {
    file = (await buildTempBundle()).file;
  });

  it("--help: exit 0, one JSON document", () => {
    const r = runBundle(file, ["--help"]);
    expect(r.status).toBe(0);
    expect(parse(r.stdout).usage).toContain("liftoff");
  });

  it("bad command: exit 2, one JSON document, nothing on stderr", () => {
    const r = runBundle(file, ["frobnicate"]);
    expect(r.status).toBe(2);
    expect(parse(r.stdout).errors[0].code).toBe("usage");
    expect(r.stderr).toBe("");
  });

  it("starts with a shebang", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(file, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});
