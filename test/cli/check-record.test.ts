import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import { buildTempBundle, runBundle } from "../helpers.js";
import { list, makeRepo, render } from "./repo.js";

const check = (dir: string) => {
  const r = run(["check-config", "--root", dir], "/");
  return { exitCode: r.exitCode, body: JSON.parse(r.stdout) as Record<string, any> };
};
const summary = (body: Record<string, any>) => body.reasons.map((r: any) => `${r.code}:${r.section ?? r.file}`);

// A repo whose config has been applied (render ran), so check-config has a record to compare with.
function applied(extra = "", targets = "[claude-code]"): string {
  const dir = makeRepo({ targets, modules: [], extra });
  expect(render(dir).exitCode).toBe(0);
  return dir;
}
const config = (dir: string) => readFileSync(join(dir, "liftoff.yaml"), "utf8");
const edit = (dir: string, from: string | RegExp, to: string) => {
  const before = config(dir);
  const after = before.replace(from, to);
  expect(after, `edit did not change the config: ${String(from)}`).not.toBe(before);
  writeFileSync(join(dir, "liftoff.yaml"), after);
};
const personal = (dir: string, text: string) => {
  mkdirSync(join(dir, ".liftoff"), { recursive: true });
  writeFileSync(join(dir, ".liftoff/personal.json"), text);
};

const STACK = "stack:\n  languages: [typescript]\n";
const CONSTRAINTS_REQUIRED = "constraints:\n  required: true\n  file: CONSTRAINTS.md\n";

describe("nothing changed", () => {
  it("is ok: exit 0, no reasons, no suppressed key", () => {
    const { exitCode, body } = check(applied(STACK));
    expect(exitCode).toBe(0);
    expect(body.status).toBe("ok");
    expect(body.reasons).toEqual([]);
    expect("suppressed" in body).toBe(false);
  });

  it("stays ok when the file is only reformatted: comments, key order, quotes, CRLF, explicit defaults", () => {
    const dir = applied(STACK);
    const text = config(dir);
    writeFileSync(
      join(dir, "liftoff.yaml"),
      "# a note\r\n" +
        text
          .replace(/\n/g, "\r\n")
          .replace("kind: new", "kind: 'new'\r\n  required: false")
          .replace("languages: [typescript]", "languages:\r\n    - typescript\r\n  frameworks: []"),
    );
    expect(check(dir).body.status).toBe("ok");
  });
});

describe("optional changes warn", () => {
  it("a changed section: warn, exit 0, one optional-changed reason for that section", () => {
    const dir = applied(STACK);
    edit(dir, "typescript", "kotlin");
    const { exitCode, body } = check(dir);
    expect(exitCode).toBe(0);
    expect(body.status).toBe("warn");
    expect(body.reasons).toEqual([expect.objectContaining({ code: "optional-changed", section: "stack" })]);
    expect(body.reasons[0].message).toMatch(/section 'stack' changed/);
  });

  it.each([
    ["project name", "name: acme", "name: other", "project"],
    ["agent targets", "[claude-code]", "[claude-code, copilot]", "agents"],
  ])("a changed %s is a warning, not a block (those sections are not flagged required)", (_what, from, to, section) => {
    const dir = applied();
    edit(dir, from, to);
    const { body } = check(dir);
    expect(body.status).toBe("warn");
    expect(summary(body)).toEqual([`optional-changed:${section}`]);
  });

  it("an added optional section says 'was added'", () => {
    const dir = applied();
    writeFileSync(join(dir, "liftoff.yaml"), config(dir) + STACK);
    const { body } = check(dir);
    expect(body.status).toBe("warn");
    expect(body.reasons[0]).toMatchObject({ code: "optional-changed", section: "stack" });
    expect(body.reasons[0].message).toMatch(/was added/);
  });

  it("a removed optional section says 'was removed'", () => {
    const dir = applied(STACK);
    edit(dir, STACK, "");
    const { body } = check(dir);
    expect(body.status).toBe("warn");
    expect(body.reasons[0].message).toMatch(/was removed/);
  });
});

describe("required changes block", () => {
  it("a changed required section: blocked, exit 1, required-changed", () => {
    const dir = applied(CONSTRAINTS_REQUIRED);
    edit(dir, "file: CONSTRAINTS.md", "file: docs/QUALITY.md");
    const { exitCode, body } = check(dir);
    expect(exitCode).toBe(1);
    expect(body.status).toBe("blocked");
    expect(body.reasons).toEqual([expect.objectContaining({ code: "required-changed", section: "constraints" })]);
    expect(body.reasons[0].message).toMatch(/required section 'constraints' changed/);
  });

  it("a section that was required in the OLD config blocks even when the new one un-requires it", () => {
    const dir = applied(CONSTRAINTS_REQUIRED);
    edit(dir, "required: true", "required: false");
    expect(summary(check(dir).body)).toEqual(["required-changed:constraints"]);
    expect(check(dir).body.status).toBe("blocked");
  });

  it("... and when the flag is simply dropped", () => {
    const dir = applied(CONSTRAINTS_REQUIRED);
    edit(dir, "  required: true\n", "");
    expect(check(dir).body.status).toBe("blocked");
  });

  it("a section required only in the NEW config blocks too", () => {
    const dir = applied(STACK);
    edit(dir, "languages: [typescript]", "languages: [typescript]\n  required: true");
    expect(summary(check(dir).body)).toEqual(["required-changed:stack"]);
  });

  it("an added required section blocks ('was added'); a removed required one blocks ('was removed')", () => {
    const added = applied();
    writeFileSync(join(added, "liftoff.yaml"), config(added) + CONSTRAINTS_REQUIRED);
    expect(check(added).body.reasons[0]).toMatchObject({ code: "required-changed", section: "constraints" });
    expect(check(added).body.reasons[0].message).toMatch(/was added/);

    const removed = applied(CONSTRAINTS_REQUIRED);
    edit(removed, CONSTRAINTS_REQUIRED, "");
    expect(check(removed).body.status).toBe("blocked");
    expect(check(removed).body.reasons[0].message).toMatch(/was removed/);
  });

  it("a plugin.version bump is a required change for everyone (plugin is always required)", () => {
    const dir = applied();
    edit(dir, 'version: "0.1"', 'version: "0.0.9"'); // still satisfied by the installed 0.1.0
    const { exitCode, body } = check(dir);
    expect(exitCode).toBe(1);
    expect(summary(body)).toEqual(["required-changed:plugin"]);
  });

  it("agents flagged required: a changed target list blocks", () => {
    const dir = applied("", "[claude-code]");
    edit(dir, "[claude-code]", "[claude-code]\n  required: true");
    expect(check(dir).body.status).toBe("blocked"); // flipping the flag is itself a change of that section
  });
});

describe("all reasons are collected, required first, each group sorted", () => {
  it("required changes, then optional ones, then conflicts", () => {
    const dir = makeRepo({ targets: "[claude-code]", modules: [], extra: STACK + CONSTRAINTS_REQUIRED });
    writeFileSync(join(dir, "CLAUDE.md"), "# my rules\n");
    render(dir);
    edit(dir, "file: CONSTRAINTS.md", "file: docs/Q.md");
    edit(dir, "name: acme", "name: other");
    edit(dir, "typescript", "kotlin");
    const { exitCode, body } = check(dir);
    expect(exitCode).toBe(1);
    expect(body.status).toBe("blocked");
    expect(summary(body)).toEqual([
      "required-changed:constraints",
      "optional-changed:project",
      "optional-changed:stack",
      "unresolved-conflict:CLAUDE.md",
    ]);
  });
});

describe("warn_on_config_update: false (personal)", () => {
  const quietRepo = () => {
    const dir = applied(STACK);
    personal(dir, '{ "warn_on_config_update": false }');
    return dir;
  };

  it("turns optional changes into ok, and still returns them as suppressed", () => {
    const dir = quietRepo();
    edit(dir, "typescript", "kotlin");
    const { exitCode, body } = check(dir);
    expect(exitCode).toBe(0);
    expect(body.status).toBe("ok");
    expect(body.reasons).toEqual([]);
    expect(body.suppressed).toEqual([expect.objectContaining({ code: "optional-changed", section: "stack" })]);
  });

  it("never hides a required change (which still blocks), and lists the optional ones as suppressed", () => {
    const dir = applied(STACK + CONSTRAINTS_REQUIRED);
    personal(dir, '{ "warn_on_config_update": false }');
    edit(dir, "typescript", "kotlin");
    edit(dir, "file: CONSTRAINTS.md", "file: x.md");
    const { body } = check(dir);
    expect(body.status).toBe("blocked");
    expect(summary(body)).toEqual(["required-changed:constraints"]);
    expect(summary({ reasons: body.suppressed })).toEqual(["optional-changed:stack"]);
  });

  it("never hides an unresolved conflict", () => {
    const dir = makeRepo({ targets: "[claude-code]", modules: [] });
    writeFileSync(join(dir, "CLAUDE.md"), "# mine\n");
    render(dir);
    personal(dir, '{ "warn_on_config_update": false }');
    const { body } = check(dir);
    expect(body.status).toBe("warn");
    expect(summary(body)).toEqual(["unresolved-conflict:CLAUDE.md"]);
  });

  it.each([
    ["not JSON", "{ nope"],
    ["a list", "[]"],
    ["null", "null"],
    ["empty object", "{}"],
    ["a string instead of a boolean", '{ "warn_on_config_update": "no" }'],
    ["a number", '{ "warn_on_config_update": 0 }'],
    ["explicit true", '{ "warn_on_config_update": true }'],
    ["camelCase (not the documented key)", '{ "warnOnConfigUpdate": false }'],
  ])("an unusable personal.json (%s) falls back to the default: still warns", (_what, text) => {
    const dir = applied(STACK);
    personal(dir, text);
    edit(dir, "typescript", "kotlin");
    expect(check(dir).body.status).toBe("warn");
  });
});

describe("unresolved conflicts", () => {
  it("a hand-written file left as it is keeps check-config at warn, until it is resolved", () => {
    const dir = makeRepo({ targets: "[claude-code]", modules: [] });
    writeFileSync(join(dir, "CLAUDE.md"), "# my own rules\n");
    render(dir);
    const first = check(dir);
    expect(first.exitCode).toBe(0);
    expect(first.body.status).toBe("warn");
    expect(first.body.reasons).toEqual([expect.objectContaining({ code: "unresolved-conflict", file: "CLAUDE.md" })]);
    expect(first.body.reasons[0].message).toMatch(/differs from what LiftOff would generate/);

    render(dir, "--overwrite", "CLAUDE.md");
    expect(check(dir).body.status).toBe("ok");
  });

  it("each conflicting file is its own reason, sorted by path", () => {
    const dir = makeRepo({ targets: "[claude-code, copilot]", modules: [] });
    mkdirSync(join(dir, ".github"));
    writeFileSync(join(dir, ".github/copilot-instructions.md"), "# mine\n");
    writeFileSync(join(dir, "CLAUDE.md"), "# mine\n");
    render(dir);
    expect(summary(check(dir).body)).toEqual(["unresolved-conflict:.github/copilot-instructions.md", "unresolved-conflict:CLAUDE.md"]);
  });
});

describe("the loop: change, check, apply, check", () => {
  it("re-applying clears a warning", () => {
    const dir = applied(STACK);
    edit(dir, "typescript", "kotlin");
    expect(check(dir).body.status).toBe("warn");
    expect(render(dir).exitCode).toBe(0);
    expect(check(dir).body.status).toBe("ok");
  });

  it("re-applying clears a block", () => {
    const dir = applied(CONSTRAINTS_REQUIRED);
    edit(dir, "file: CONSTRAINTS.md", "file: docs/Q.md");
    expect(check(dir).body.status).toBe("blocked");
    render(dir);
    expect(check(dir).body.status).toBe("ok");
  });
});

describe("check-config is read-only and judges the pin first", () => {
  it("writes nothing: same files, same mtimes", () => {
    const dir = applied(STACK);
    edit(dir, "typescript", "kotlin");
    const snapshot = () => list(dir).map((p) => `${p}@${statSync(join(dir, p)).mtimeMs}`);
    const before = snapshot();
    check(dir);
    check(dir);
    expect(snapshot()).toEqual(before);
  });

  it("an outdated plugin says so, not 'changed' (the pin is read first)", () => {
    const dir = applied();
    edit(dir, 'version: "0.1"', 'version: "9.0"');
    expect(summary(check(dir).body)).toEqual(["plugin-outdated:undefined"]);
  });

  it("a config that became invalid after it was applied is config-invalid", () => {
    const dir = applied();
    writeFileSync(join(dir, "liftoff.yaml"), config(dir) + "bogus: 1\n");
    expect(check(dir).body.reasons[0].code).toBe("config-invalid");
  });

  it("without a .liftoff directory at all it is not-applied (and nothing is created)", () => {
    const dir = makeRepo();
    expect(check(dir).body.reasons[0].code).toBe("not-applied");
    expect(existsSync(join(dir, ".liftoff"))).toBe(false);
  });
});

describe("check-config after render, from the built bundle", () => {
  let file = "";
  beforeAll(async () => {
    file = (await buildTempBundle()).file;
  });

  it("render, then check-config: ok, exit 0; change a required section: blocked, exit 1", () => {
    const dir = makeRepo({ targets: "[claude-code]", modules: [], extra: CONSTRAINTS_REQUIRED });
    expect(runBundle(file, ["render", "--root", dir]).status).toBe(0);
    const ok = runBundle(file, ["check-config", "--root", dir]);
    expect(ok.status).toBe(0);
    expect(ok.stderr).toBe("");
    expect(JSON.parse(ok.stdout)).toMatchObject({ status: "ok", reasons: [] });

    edit(dir, "file: CONSTRAINTS.md", "file: other.md");
    const blocked = runBundle(file, ["check-config", "--root", dir]);
    expect(blocked.status).toBe(1);
    expect(JSON.parse(blocked.stdout).reasons[0]).toMatchObject({ code: "required-changed", section: "constraints" });
  });
});
