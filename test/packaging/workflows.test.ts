import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "..", "..", ".github", "workflows");
const load = (name: string) => parse(readFileSync(join(DIR, name), "utf8")) as Record<string, any>;
const steps = (wf: Record<string, any>, job: string): any[] => wf.jobs[job].steps;
const runs = (wf: Record<string, any>, job: string): string[] => steps(wf, job).filter((s) => s.run).map((s) => s.run as string);

describe("workflows", () => {
  it("are exactly ci.yml and release-check.yml", () => {
    expect(readdirSync(DIR).sort()).toEqual(["ci.yml", "release-check.yml"]);
  });

  it.each(["ci.yml", "release-check.yml"])("%s: read-only token, and every action is pinned to a major version", (name) => {
    const wf = load(name);
    expect(wf.permissions).toEqual({ contents: "read" });
    for (const job of Object.values<any>(wf.jobs)) {
      for (const s of job.steps.filter((x: any) => x.uses)) expect(s.uses, s.uses).toMatch(/^actions\/[a-z-]+@v\d+$/);
    }
  });
});

describe("ci.yml", () => {
  const wf = load("ci.yml");

  it("runs on pull requests and on pushes to main", () => {
    expect(wf.on.pull_request).toBeDefined();
    expect(wf.on.push.branches).toEqual(["main"]);
  });

  it("tests on Node 22 and 24, on Linux (the authority for the byte-identical artifact)", () => {
    expect(wf.jobs.test["runs-on"]).toBe("ubuntu-latest");
    expect(wf.jobs.test.strategy.matrix.node).toEqual(["22", "24"]);
    expect(steps(wf, "test").find((s) => s.uses?.startsWith("actions/setup-node"))!.with["node-version"]).toBe("${{ matrix.node }}");
  });

  it("installs from the lockfile, then typechecks, builds and tests, then checks the committed plugin files", () => {
    expect(runs(wf, "test")).toEqual(["npm ci", "npm run typecheck", "npm run build", "npm test", "git diff --exit-code -- plugin"]);
  });
});

describe("release-check.yml", () => {
  const wf = load("release-check.yml");
  const script = runs(wf, "check").join("\n");

  it("runs only on v* tags", () => {
    expect(wf.on.push.tags).toEqual(["v*"]);
    expect(wf.on.push.branches).toBeUndefined();
  });

  it("checks that the tag, package.json and plugin.json name the same version", () => {
    expect(script).toContain("GITHUB_REF_NAME");
    expect(script).toContain("package.json");
    expect(script).toContain("plugin/.claude-plugin/plugin.json");
    expect(script).toMatch(/test "\$tag" = "\$pkg" && test "\$tag" = "\$plugin"/);
  });

  it("rebuilds from a clean install and compares with what is committed, then runs the tests", () => {
    expect(runs(wf, "check").slice(-4)).toEqual(["npm ci", "npm run build", "git diff --exit-code -- plugin", "npm test"]);
  });

  it("says how to delete a bad tag (a published tag is immutable, so it has to go before anyone pins it)", () => {
    expect(readFileSync(join(DIR, "release-check.yml"), "utf8")).toMatch(/git push origin :refs\/tags\/vX\.Y\.Z/);
  });
});
