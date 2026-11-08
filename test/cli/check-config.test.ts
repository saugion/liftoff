import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import { INSTALLED_VERSION } from "../../src/cli/version.js";
import { buildTempBundle, runBundle, tempDir } from "../helpers.js";
import { makeRepo, render } from "./repo.js";

const check = (dir: string) => {
  const r = run(["check-config", "--root", dir], "/");
  return { exitCode: r.exitCode, body: JSON.parse(r.stdout) as Record<string, any>, stderr: r.stderr };
};
const codes = (body: Record<string, any>) => body.reasons.map((r: any) => r.code);
const write = (dir: string, text: string) => writeFileSync(join(dir, "liftoff.yaml"), text);
const HEAD = (version: string, extra = "") =>
  `liftoff: 1\nplugin:\n  version: "${version}"\nproject:\n  name: acme\n  kind: new\nagents:\n  targets: [copilot]\n${extra}`;

describe("check-config: reads that fail are a CheckResult, not the fatal shape", () => {
  it("no liftoff.yaml: blocked, exit 1, config-missing, installedVersion always present", () => {
    const dir = tempDir();
    const { exitCode, body } = check(dir);
    expect(exitCode).toBe(1);
    expect(body).toMatchObject({ status: "blocked", root: dir, installedVersion: INSTALLED_VERSION });
    expect(body.ok).toBeUndefined();
    expect(body.reasons).toHaveLength(1);
    expect(body.reasons[0].code).toBe("config-missing");
    expect(body.reasons[0].message).toContain("liftoff.yaml");
    expect(body.hint).toBeUndefined(); // nothing above a temp dir
  });

  it("hint.nearestRoot is the nearest ancestor holding a liftoff.yaml or a .git (stat only)", () => {
    const base = tempDir();
    const deep = join(base, "a", "b", "c");
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(base, "liftoff.yaml"), "x");
    expect(check(deep).body.hint).toEqual({ nearestRoot: base });
    mkdirSync(join(base, "a", ".git")); // closer, and a directory
    expect(check(deep).body.hint).toEqual({ nearestRoot: join(base, "a") });
    writeFileSync(join(base, "a", "b", ".git"), "gitdir: ../../x"); // a worktree/submodule .git file counts too
    expect(check(deep).body.hint).toEqual({ nearestRoot: join(base, "a", "b") });
  });

  it("the root itself is never its own hint", () => {
    const base = tempDir();
    mkdirSync(join(base, ".git"));
    expect(check(base).body.hint).toBeUndefined();
  });

  it("an invalid config: blocked, exit 1, config-invalid carrying the errors with pointers", () => {
    const dir = tempDir();
    write(dir, HEAD("0.1", "bogus: 1\n"));
    const { exitCode, body } = check(dir);
    expect(exitCode).toBe(1);
    expect(body.status).toBe("blocked");
    expect(codes(body)).toEqual(["config-invalid"]);
    expect(body.reasons[0].errors).toContainEqual({ path: "/bogus", message: "must NOT have additional property 'bogus'" });
    expect(body.reasons[0].message).toMatch(/1 problem\b/);
    expect(body.installedVersion).toBe(INSTALLED_VERSION);
  });

  it("a YAML syntax error carries line and col in the reason's errors", () => {
    const dir = tempDir();
    write(dir, "liftoff: 1\nplugin: [unclosed\n");
    const { body } = check(dir);
    expect(codes(body)).toEqual(["config-invalid"]);
    expect(body.reasons[0].errors[0].line).toBeGreaterThan(0);
  });

  it("several problems are counted in the message", () => {
    const dir = tempDir();
    write(dir, "liftoff: 1\nplugin: {}\nproject: {}\nagents: {}\n");
    expect(check(dir).body.reasons[0].message).toMatch(/4 problems/);
  });

  it("liftoff.yaml that is a directory is config-invalid, not a crash", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "liftoff.yaml"));
    expect(codes(check(dir).body)).toEqual(["config-invalid"]);
  });
});

describe("check-config: the plugin pin comes first", () => {
  it.each(["0.4", "9.0", "0.3.1", "1.0.0"])("a pin of %s above the installed plugin: only plugin-outdated, with the minimum", (pin) => {
    const dir = tempDir();
    write(dir, HEAD(pin));
    const { exitCode, body } = check(dir);
    expect(exitCode).toBe(1);
    expect(body.status).toBe("blocked");
    expect(body.reasons).toHaveLength(1);
    expect(body.reasons[0]).toMatchObject({ code: "plugin-outdated", minimum: pin });
    expect(body.reasons[0].message).toContain(`needs LiftOff ${pin}`);
    expect(body.reasons[0].message).toMatch(/\/reload-plugins/);
    expect(body.reasons[0].message).toMatch(/VS Code/);
  });

  it("a newer schema never shows as unknown-key noise: pinned above, with keys this version rejects", () => {
    const dir = tempDir();
    write(dir, HEAD("9.0", "shiny-new-section: { a: 1 }\nproject2: 3\n").replace("kind: new", "kind: new\n  colour: red"));
    const { body } = check(dir);
    expect(codes(body)).toEqual(["plugin-outdated"]);
    expect(body.reasons[0].errors).toBeUndefined();
  });

  it("liftoff: 2 with a pin the installed plugin satisfies: plugin-outdated without a minimum", () => {
    const dir = tempDir();
    write(dir, HEAD("0.1", "extra: 1\n").replace("liftoff: 1", "liftoff: 2"));
    const { body } = check(dir);
    expect(codes(body)).toEqual(["plugin-outdated"]);
    expect(body.reasons[0].minimum).toBeUndefined();
    expect(body.reasons[0].message).toMatch(/newer LiftOff/);
  });

  it("liftoff: 2 and a newer pin: plugin-outdated with the minimum", () => {
    const dir = tempDir();
    write(dir, HEAD("9.0").replace("liftoff: 1", "liftoff: 2"));
    expect(check(dir).body.reasons[0]).toMatchObject({ code: "plugin-outdated", minimum: "9.0" });
  });

  it.each(["0.1", "0.1.0", "0.0.9"])("a pin of %s is satisfied: a problem in the file is then config-invalid, not outdated", (pin) => {
    const dir = tempDir();
    write(dir, HEAD(pin, "bogus: 1\n"));
    expect(codes(check(dir).body)).toEqual(["config-invalid"]);
  });

  it("an unquoted pin (a number) is judged by the schema, not by the pin", () => {
    const dir = tempDir();
    write(dir, HEAD("0.1").replace('version: "0.1"', "version: 99.5"));
    const { body } = check(dir);
    expect(codes(body)).toEqual(["config-invalid"]);
    expect(body.reasons[0].errors.map((e: any) => e.path)).toContain("/plugin/version");
  });

  it("a YAML syntax error wins over a pin that cannot even be read", () => {
    const dir = tempDir();
    write(dir, 'liftoff: 1\nplugin:\n  version: "9.0"\nproject: [unclosed\n');
    expect(codes(check(dir).body)).toEqual(["config-invalid"]);
  });

  it("validate still ignores the pin", () => {
    const dir = tempDir();
    write(dir, HEAD("9.0"));
    expect(run(["validate", "--root", dir], "/").exitCode).toBe(0);
  });
});

describe("check-config: an applied record is needed (not-applied, three messages)", () => {
  const applied = (setup?: (dir: string) => void) => {
    const dir = makeRepo({ targets: "[claude-code]", modules: [] });
    setup?.(dir);
    return check(dir);
  };
  const putRecord = (text: string) => (dir: string) => {
    mkdirSync(join(dir, ".liftoff"));
    writeFileSync(join(dir, ".liftoff/applied.json"), text);
  };

  it("no record (a fresh clone): blocked, not-applied, pointing at the Init skill", () => {
    const { exitCode, body } = applied();
    expect(exitCode).toBe(1);
    expect(body.status).toBe("blocked");
    expect(codes(body)).toEqual(["not-applied"]);
    expect(body.reasons[0].message).toMatch(/not been applied here yet/);
    expect(body.reasons[0].message).toMatch(/Init/);
  });

  it.each([["not json", "{ nope"], ["a list", "[]"], ["wrong shape", '{"v":1}'], ["null", "null"]])("a corrupt record (%s): its own message", (_n, text) => {
    const { body } = applied(putRecord(text));
    expect(codes(body)).toEqual(["not-applied"]);
    expect(body.reasons[0].message).toMatch(/unreadable/);
  });

  it("a record from a newer LiftOff: its own message, says to update the plugin", () => {
    const { body } = applied(putRecord('{"v": 2, "anything": true}'));
    expect(codes(body)).toEqual(["not-applied"]);
    expect(body.reasons[0].message).toMatch(/newer LiftOff/);
    expect(body.reasons[0].message).toMatch(/update the plugin/);
  });

  it("the three messages are different", () => {
    const messages = [applied(), applied(putRecord("{")), applied(putRecord('{"v":9}'))].map((r) => r.body.reasons[0].message);
    expect(new Set(messages).size).toBe(3);
  });

  it("the pin is judged before the record: an outdated plugin says so even with no record", () => {
    const dir = makeRepo({ pluginVersion: "9.0" });
    expect(codes(check(dir).body)).toEqual(["plugin-outdated"]);
  });
});

describe("check-config from the built bundle", () => {
  let file = "";
  beforeAll(async () => {
    file = (await buildTempBundle()).file;
  });

  it("blocked exits 1 with one JSON document and nothing on stderr", () => {
    const r = runBundle(file, ["check-config", "--root", tempDir()]);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toMatchObject({ status: "blocked", installedVersion: INSTALLED_VERSION });
  });

  it("--overwrite is a usage error for check-config", () => {
    const r = runBundle(file, ["check-config", "--overwrite", "x", "--root", tempDir()]);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).errors[0].code).toBe("usage");
  });
});

describe("render uses the same pin-first read", () => {
  it("a newer schema is plugin-outdated, not config-invalid noise, and nothing is written", () => {
    const dir = makeRepo({ pluginVersion: "9.0", extra: "shiny: { a: 1 }\n" });
    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(1);
    expect(body.errors.map((e: any) => e.code)).toEqual(["plugin-outdated"]);
    expect(body.errors[0].message).toContain("needs LiftOff 9.0");
    expect(existsSync(join(dir, ".liftoff"))).toBe(false);
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
  });

  it("liftoff: 2 is plugin-outdated without a minimum", () => {
    const dir = makeRepo({ extra: "unknown-new-thing: 1\n" });
    write(dir, readFileSync(join(dir, "liftoff.yaml"), "utf8").replace("liftoff: 1", "liftoff: 2"));
    const { body } = render(dir);
    expect(body.errors.map((e: any) => e.code)).toEqual(["plugin-outdated"]);
    expect(body.errors[0].message).toMatch(/newer LiftOff/);
    expect(body.errors[0].message).not.toMatch(/needs LiftOff \d/);
  });
});
