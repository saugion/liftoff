import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import { list, makeRepo, render } from "./repo.js";

const canChmod = process.platform !== "win32" && process.getuid?.() !== 0; // root and Windows ignore directory modes
const record = (dir: string) => JSON.parse(readFileSync(join(dir, ".liftoff/applied.json"), "utf8"));
const withConstraints = (dir: string, file = "CONSTRAINTS.md") => {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), "# bar\n");
  return dir;
};
const readOnly = <T>(path: string, fn: () => T): T => {
  chmodSync(path, 0o555);
  try {
    return fn();
  } finally {
    chmodSync(path, 0o755);
  }
};

describe.skipIf(!canChmod)("a write that fails half way", () => {
  it("reports write-failed with the file and what was already written, and leaves NO record; the next run converges", () => {
    const dir = withConstraints(makeRepo());
    const first = readOnly(join(dir, "apps/web"), () => render(dir));

    expect(first.exitCode).toBe(1);
    expect(first.body.ok).toBe(false);
    expect(first.body.errors).toHaveLength(1);
    expect(first.body.errors[0]).toMatchObject({ code: "write-failed", file: "apps/web/CLAUDE.md" });
    // files render writes in path order: copilot, root CLAUDE.md, then the module that failed
    expect(first.body.files.map((f: any) => [f.path, f.action])).toEqual([
      [".github/copilot-instructions.md", "created"],
      ["CLAUDE.md", "created"],
    ]);
    expect(existsSync(join(dir, ".liftoff/applied.json")), "the record must not claim a write that did not happen").toBe(false);
    expect(existsSync(join(dir, "src/api/CLAUDE.md"))).toBe(false);
    expect(list(dir).filter((p) => p.endsWith(".tmp"))).toEqual([]);

    const second = render(dir);
    expect(second.exitCode).toBe(0);
    expect(second.body.files.map((f: any) => [f.path, f.action])).toEqual([
      [".github/copilot-instructions.md", "unchanged"],
      ["CLAUDE.md", "unchanged"],
      ["apps/web/CLAUDE.md", "created"],
      ["src/api/CLAUDE.md", "created"],
    ]);
    expect(record(dir).files).toHaveLength(4);
  });

  it("a failing record write after all files were written is write-failed too, and a re-run just writes the record", () => {
    const dir = withConstraints(makeRepo());
    mkdirSync(join(dir, ".liftoff"));
    writeFileSync(join(dir, ".liftoff/.gitignore"), "*\n");
    const first = readOnly(join(dir, ".liftoff"), () => render(dir));

    expect(first.exitCode).toBe(1);
    expect(first.body.errors[0]).toMatchObject({ code: "write-failed", file: ".liftoff/applied.json" });
    expect(first.body.files).toHaveLength(4); // every file was written
    expect(existsSync(join(dir, ".liftoff/applied.json"))).toBe(false);

    const second = render(dir);
    expect(second.exitCode).toBe(0);
    expect(second.body.files.every((f: any) => f.action === "unchanged")).toBe(true);
    expect(existsSync(join(dir, ".liftoff/applied.json"))).toBe(true);
  });

  it("a fatal write error is still one JSON document with exit 1 (not a crash)", () => {
    const dir = withConstraints(makeRepo({ targets: "[claude-code]", modules: ["src/api"] }));
    const r = readOnly(join(dir, "src/api"), () => run(["render", "--root", dir], "/"));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout).errors[0].code).toBe("write-failed");
  });
});

describe("stale files: planned last time, not planned now", () => {
  const stale = (path: string) => `stale: ${path} is no longer generated; left in place`;
  const edit = (dir: string, from: string | RegExp, to: string) =>
    writeFileSync(join(dir, "liftoff.yaml"), readFileSync(join(dir, "liftoff.yaml"), "utf8").replace(from, to));

  it("dropping a target leaves its file in place and says so; the record forgets it", () => {
    const dir = withConstraints(makeRepo());
    expect(render(dir).body.notices).toEqual([]);
    edit(dir, "[claude-code, copilot]", "[claude-code]");
    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(0);
    expect(body.notices).toEqual([stale(".github/copilot-instructions.md")]);
    expect(existsSync(join(dir, ".github/copilot-instructions.md"))).toBe(true);
    expect(record(dir).files).not.toContain(".github/copilot-instructions.md");
  });

  it("the notice is given once: the next run has nothing to say", () => {
    const dir = withConstraints(makeRepo());
    render(dir);
    edit(dir, "[claude-code, copilot]", "[claude-code]");
    expect(render(dir).body.notices).toHaveLength(1);
    expect(render(dir).body.notices).toEqual([]);
  });

  it("removing modules notices their CLAUDE.md files, sorted", () => {
    const dir = withConstraints(makeRepo());
    render(dir);
    edit(dir, /modules:[\s\S]*$/, "");
    expect(render(dir).body.notices).toEqual([stale("apps/web/CLAUDE.md"), stale("src/api/CLAUDE.md")]);
    expect(existsSync(join(dir, "src/api/CLAUDE.md"))).toBe(true);
  });

  it("no notice for a stale file the user already deleted", () => {
    const dir = withConstraints(makeRepo());
    render(dir);
    rmSync(join(dir, ".github/copilot-instructions.md"));
    edit(dir, "[claude-code, copilot]", "[claude-code]");
    expect(render(dir).body.notices).toEqual([]);
  });

  it("a first render, a corrupt record and a record from a newer LiftOff give no stale notices; the record is rewritten", () => {
    for (const content of [undefined, "{ not json", '{"v": 2}', '{"v":1}']) {
      const dir = withConstraints(makeRepo());
      if (content !== undefined) {
        mkdirSync(join(dir, ".liftoff"));
        writeFileSync(join(dir, ".liftoff/applied.json"), content);
      }
      const { exitCode, body } = render(dir);
      expect(exitCode, String(content)).toBe(0);
      expect(body.notices, String(content)).toEqual([]);
      expect(record(dir)).toMatchObject({ v: 1, conflicts: [] });
    }
  });
});

describe("the constraints file the Copilot pointer names", () => {
  const MISSING = (file: string) => `${file} does not exist yet, and the Copilot instructions point to it`;

  it("missing: a notice naming the default file", () => {
    expect(render(makeRepo({ targets: "[copilot]", modules: [] })).body.notices).toEqual([MISSING("CONSTRAINTS.md")]);
  });

  it("present: no notice", () => {
    expect(render(withConstraints(makeRepo({ targets: "[copilot]", modules: [] }))).body.notices).toEqual([]);
  });

  it("the configured file is the one that is checked, normalized", () => {
    const extra = "constraints:\n  file: ./docs\\QUALITY.md\n";
    const missing = makeRepo({ targets: "[copilot]", modules: [], extra });
    expect(render(missing).body.notices).toEqual([MISSING("docs/QUALITY.md")]);
    const present = withConstraints(makeRepo({ targets: "[copilot]", modules: [], extra }), "docs/QUALITY.md");
    expect(render(present).body.notices).toEqual([]);
  });

  it("not a Copilot target: nothing points at it, so no notice", () => {
    expect(render(makeRepo({ targets: "[claude-code]", modules: [] })).body.notices).toEqual([]);
  });

  it("a notice is not an error: exit 0 and applied", () => {
    const { exitCode, body } = render(makeRepo({ targets: "[copilot]", modules: [] }));
    expect(exitCode).toBe(0);
    expect(body.applied).toBe(true);
  });
});

describe("the plugin pin blocks render (and only the pin does)", () => {
  const nothingWritten = (dir: string) => {
    expect(existsSync(join(dir, ".liftoff"))).toBe(false);
    expect(list(dir).filter((p) => /CLAUDE\.md$|copilot-instructions\.md$/.test(p))).toEqual([]);
  };

  it.each(["0.2", "9.0", "0.1.1", "1.0.0"])("a pin of %s is newer than the installed plugin: plugin-outdated, exit 1, nothing written", (pin) => {
    const dir = makeRepo({ pluginVersion: pin });
    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].code).toBe("plugin-outdated");
    expect(body.errors[0].message).toContain(`needs LiftOff ${pin}`);
    expect(body.errors[0].message).toMatch(/\/reload-plugins/);
    expect(body.errors[0].message).toMatch(/VS Code/);
    nothingWritten(dir);
  });

  it.each(["0.1", "0.1.0", "0.0.9", "0.0"])("a pin of %s is satisfied by the installed 0.1.0", (pin) => {
    expect(render(makeRepo({ pluginVersion: pin })).exitCode).toBe(0);
  });

  it("validate does not look at the pin (Init loops on it)", () => {
    const dir = makeRepo({ pluginVersion: "9.0" });
    expect(run(["validate", "--root", dir], "/").exitCode).toBe(0);
  });

  it("the pin is checked before the AGENTS.md preflight: an outdated plugin cannot judge the repo", () => {
    const dir = makeRepo({ pluginVersion: "9.0", agentsMd: false });
    expect(render(dir).body.errors.map((e: any) => e.code)).toEqual(["plugin-outdated"]);
  });
});

describe("exit codes", () => {
  it("0 when applied (even with conflicts), 1 for any fatal error, 2 for usage", () => {
    const ok = makeRepo({ targets: "[claude-code]", modules: [] });
    expect(render(ok).exitCode).toBe(0);
    writeFileSync(join(ok, "CLAUDE.md"), "# mine\n");
    expect(render(ok).exitCode).toBe(0);
    expect(render(makeRepo({ agentsMd: false })).exitCode).toBe(1);
    expect(render(makeRepo({ extra: "bogus: 1\n" })).exitCode).toBe(1);
    expect(render(ok, "--overwrite", "nope.md").exitCode).toBe(2);
  });
});
