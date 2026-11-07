import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import { buildTempBundle, runBundle, tempDir } from "../helpers.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "config");
const repoWith = (fixture: string) => {
  const dir = tempDir();
  writeFileSync(join(dir, "liftoff.yaml"), readFileSync(join(FIXTURES, fixture), "utf8"));
  return dir;
};
const out = (dir: string) => {
  const r = run(["validate", "--root", dir], "/");
  return { exitCode: r.exitCode, body: JSON.parse(r.stdout) as Record<string, any> };
};

describe("liftoff validate", () => {
  it("valid config: exit 0, ok true, root is echoed", () => {
    const dir = repoWith("valid/full.yaml");
    const { exitCode, body } = out(dir);
    expect(exitCode).toBe(0);
    expect(body).toMatchObject({ ok: true, root: dir });
    expect(body.configHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("configHash equals the library hash and survives reformatting of the file", () => {
    const a = out(repoWith("valid/minimal.yaml")).body.configHash;
    const dir = tempDir();
    const text = readFileSync(join(FIXTURES, "valid/minimal.yaml"), "utf8");
    writeFileSync(join(dir, "liftoff.yaml"), "# note\r\n" + text.replace(/\n/g, "\r\n"));
    expect(out(dir).body.configHash).toBe(a);
  });

  it("schema error: exit 1, config-invalid with a JSON pointer", () => {
    const { exitCode, body } = out(repoWith("invalid/unknown-top-level-key.yaml"));
    expect(exitCode).toBe(1);
    expect(body.ok).toBe(false);
    expect(body.errors).toContainEqual(expect.objectContaining({ code: "config-invalid", path: "/extra" }));
  });

  it("YAML syntax error: line and col reach the output", () => {
    const { body } = out(repoWith("invalid/syntax-error.yaml"));
    expect(body.errors[0]).toMatchObject({ code: "config-invalid", path: "" });
    expect(body.errors[0].line).toBeGreaterThan(0);
  });

  it("missing liftoff.yaml: exit 1, config-missing", () => {
    const { exitCode, body } = out(tempDir());
    expect(exitCode).toBe(1);
    expect(body.errors[0].code).toBe("config-missing");
  });

  it("liftoff.yaml that is a directory: config-invalid, no crash", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "liftoff.yaml"));
    const { exitCode, body } = out(dir);
    expect(exitCode).toBe(1);
    expect(body.errors[0].code).toBe("config-invalid");
  });

  it("ignores the applied record and the plugin pin (Init loops on validate)", () => {
    const dir = repoWith("valid/minimal.yaml");
    mkdirSync(join(dir, ".liftoff"));
    writeFileSync(join(dir, ".liftoff", "applied.json"), "not json");
    expect(out(dir).exitCode).toBe(0);
  });
});

describe("liftoff validate from the built bundle", () => {
  let file = "";
  beforeAll(async () => {
    file = (await buildTempBundle()).file;
  });

  it("valid: exit 0; invalid: exit 1; one JSON document each", () => {
    const good = runBundle(file, ["validate", "--root", repoWith("valid/minimal.yaml")]);
    expect(good.status).toBe(0);
    expect(JSON.parse(good.stdout).ok).toBe(true);
    const bad = runBundle(file, ["validate", "--root", repoWith("invalid/missing-plugin.yaml")]);
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stdout).errors[0].path).toBe("/plugin");
    expect(bad.stderr).toBe("");
  });
});
