import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkVersionArg, isReleasePath, release } from "../../scripts/release.mjs";
import { tempDir } from "../helpers.js";

describe("checkVersionArg", () => {
  it.each([
    ["0.1.0", "0.1.1"],
    ["0.1.0", "0.2.0"],
    ["0.9.9", "0.10.0"],
    ["0.1.0", "1.0.0"],
  ])("%s -> %s is fine", (current, next) => {
    expect(checkVersionArg(current, next)).toBeUndefined();
  });

  it.each([
    ["0.1.0", "0.1.0", /current version/],
    ["0.2.0", "0.1.9", /not newer/],
    ["0.1.0", "0.1", /x\.y\.z/],
    ["0.1.0", "v0.2.0", /x\.y\.z/],
    ["0.1.0", "0.2.0-beta.1", /x\.y\.z/],
    ["0.1.0", "", /x\.y\.z/],
    ["0.1.0", undefined, /x\.y\.z/],
  ])("%s -> %s is refused", (current, next, why) => {
    expect(checkVersionArg(current, next as string)).toMatch(why);
  });
});

describe("isReleasePath", () => {
  it("allows the version files, the lockfile and the plugin, nothing else", () => {
    for (const p of ["package.json", "package-lock.json", "plugin/skills/liftoff-init/scripts/liftoff.mjs", "plugin/LICENSE"]) expect(isReleasePath(p), p).toBe(true);
    for (const p of ["src/cli/main.ts", "test/x.ts", "README.md", "pluginx/a", "scripts/build.mjs"]) expect(isReleasePath(p), p).toBe(false);
  });
});

// A repo-shaped temp dir and a fake exec: the real script runs, no git or npm is touched.
function setup(version = "0.1.0", pluginVersion = version) {
  const cwd = tempDir();
  mkdirSync(join(cwd, "plugin", ".claude-plugin"), { recursive: true });
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "liftoff", version }, null, 2) + "\n");
  writeFileSync(join(cwd, "plugin/.claude-plugin/plugin.json"), JSON.stringify({ name: "liftoff", version: pluginVersion }, null, 2) + "\n");
  return cwd;
}

interface World {
  status?: string;
  branch?: string;
  existingTag?: string;
  staged?: string;
}
function fake(world: World = {}) {
  const calls: string[] = [];
  const exec = (cmd: string, args: string[]) => {
    const line = `${cmd} ${args.join(" ")}`;
    calls.push(line);
    if (line === "git status --porcelain") return world.status ?? "";
    if (line === "git rev-parse --abbrev-ref HEAD") return world.branch ?? "main\n";
    if (line.startsWith("git tag --list")) return world.existingTag ?? "";
    if (line === "git diff --cached --name-only") return world.staged ?? "package.json\npackage-lock.json\nplugin/skills/liftoff-init/scripts/liftoff.mjs\n";
    return "";
  };
  return { calls, exec };
}
const run = (cwd: string, version: string, world?: World, extra: { dryRun?: boolean } = {}) => {
  const f = fake(world);
  const logs: string[] = [];
  const go = () => release({ version, cwd, exec: f.exec, log: (m: string) => logs.push(m), ...extra });
  return { ...f, logs, go };
};
const mutating = (calls: string[]) => calls.filter((c) => !/^git (status|rev-parse|tag --list|diff)/.test(c));

describe("release: the happy path", () => {
  it("bumps both versions, builds from a clean install, tests, commits, tags, and does not push", () => {
    const cwd = setup();
    const r = run(cwd, "0.2.0");
    r.go();
    expect(mutating(r.calls)).toEqual([
      "npm version 0.2.0 --no-git-tag-version",
      "npm ci",
      "npm run build",
      "npm test",
      "git add package.json package-lock.json plugin",
      "git commit -m release: v0.2.0",
      "git tag -a v0.2.0 -m LiftOff v0.2.0",
    ]);
    expect(r.calls.some((c) => c.startsWith("git push"))).toBe(false);
    expect(JSON.parse(readFileSync(join(cwd, "plugin/.claude-plugin/plugin.json"), "utf8")).version).toBe("0.2.0");
    expect(r.logs.at(-1)).toMatch(/git push origin main && git push origin v0\.2\.0/);
  });

  it("the tests run before anything is committed or tagged (a failing build or test tags nothing)", () => {
    const r = run(setup(), "0.2.0");
    r.go();
    const at = (needle: string) => r.calls.findIndex((c) => c.startsWith(needle));
    expect(at("npm ci")).toBeLessThan(at("npm run build"));
    expect(at("npm run build")).toBeLessThan(at("npm test"));
    expect(at("npm test")).toBeLessThan(at("git commit"));
    expect(at("git commit")).toBeLessThan(at("git tag -a"));
  });

  it("a failing test stops the release before the commit", () => {
    const cwd = setup();
    const calls: string[] = [];
    const exec = (cmd: string, args: string[]) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      if (cmd === "git" && args[0] === "status") return "";
      if (cmd === "git" && args[0] === "rev-parse") return "main\n";
      if (cmd === "git" && args[0] === "tag") return "";
      if (cmd === "npm" && args[0] === "test") throw new Error("tests failed");
      return "";
    };
    expect(() => release({ version: "0.2.0", cwd, exec, log: () => {} })).toThrow(/tests failed/);
    expect(calls.some((c) => c.startsWith("git commit") || c.startsWith("git tag -a"))).toBe(false);
  });
});

describe("release: refusals (nothing is changed)", () => {
  const refused = (cwd: string, version: string, world: World | undefined, why: RegExp) => {
    const r = run(cwd, version, world);
    expect(r.go).toThrow(why);
    expect(mutating(r.calls)).toEqual([]);
    return cwd;
  };

  it("a dirty working tree", () => refused(setup(), "0.2.0", { status: " M src/cli/main.ts\n" }, /not clean/));
  it("a branch other than main", () => refused(setup(), "0.2.0", { branch: "cp-d-skill\n" }, /release from main, not cp-d-skill/));
  it("a tag that already exists (published tags are immutable)", () => refused(setup(), "0.2.0", { existingTag: "v0.2.0\n" }, /tag v0\.2\.0 already exists/));
  it("a version that is not newer", () => refused(setup("0.2.0"), "0.1.0", undefined, /not newer/));
  it("a version that is not x.y.z", () => refused(setup(), "0.2", undefined, /x\.y\.z/));
  it("package.json and plugin.json that already disagree", () => refused(setup("0.1.0", "0.1.1"), "0.2.0", undefined, /already differ/));

  it("a staged file a release should not touch is never committed", () => {
    const cwd = setup();
    const r = run(cwd, "0.2.0", { staged: "package.json\nsrc/cli/main.ts\n" });
    expect(r.go).toThrow(/src\/cli\/main\.ts/);
    expect(r.calls.some((c) => c.startsWith("git commit") || c.startsWith("git tag -a"))).toBe(false);
  });

  it("the files are left alone when a check fails", () => {
    const cwd = setup();
    run(cwd, "0.2.0", { status: "dirty" }).go.bind(null);
    const r = run(cwd, "0.2.0", { status: "dirty" });
    expect(r.go).toThrow();
    expect(JSON.parse(readFileSync(join(cwd, "plugin/.claude-plugin/plugin.json"), "utf8")).version).toBe("0.1.0");
  });
});

describe("release --dry-run", () => {
  it("runs the read-only checks, logs the steps, changes nothing", () => {
    const cwd = setup();
    const r = run(cwd, "0.2.0", undefined, { dryRun: true });
    r.go();
    expect(mutating(r.calls)).toEqual([]);
    expect(r.logs.filter((l) => l.startsWith("[dry run] $ ")).map((l) => l.replace("[dry run] $ ", ""))).toEqual([
      "npm version 0.2.0 --no-git-tag-version",
      "npm ci",
      "npm run build",
      "npm test",
      "git add package.json package-lock.json plugin",
      "git commit -m release: v0.2.0",
      "git tag -a v0.2.0 -m LiftOff v0.2.0",
    ]);
    expect(JSON.parse(readFileSync(join(cwd, "plugin/.claude-plugin/plugin.json"), "utf8")).version).toBe("0.1.0");
  });

  it("still refuses a dirty tree", () => {
    const r = run(setup(), "0.2.0", { status: "x" }, { dryRun: true });
    expect(r.go).toThrow(/not clean/);
  });
});
