import { describe, expect, it } from "vitest";
import { MIN_WORKSPACE_PLUGIN, configHash, parseConfig, requiredSections, sectionHashes } from "../../src/config/index.js";
import type { Config } from "../../src/config/index.js";

const HEAD = (v = "0.8") => `liftoff: 1\nplugin:\n  version: "${v}"\nproject:\n  name: acme\n  kind: new\nagents:\n  targets: [claude-code]\n`;
const parse = (extra: string, v = "0.8"): Config => {
  const r = parseConfig(HEAD(v) + extra);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};
const errors = (extra: string, v = "0.8") => {
  const r = parseConfig(HEAD(v) + extra);
  return r.ok ? [] : r.errors;
};

describe("workspace", () => {
  it("MIN_WORKSPACE_PLUGIN is 0.8", () => expect(MIN_WORKSPACE_PLUGIN).toBe("0.8"));

  it("keeps the repositories left out, in the order written", () => {
    expect(parse("workspace:\n  exclude: [legacy-tool, docs.site, 'old app', ..dots]\n").workspace).toEqual({ exclude: ["legacy-tool", "docs.site", "old app", "..dots"] });
  });

  it("an empty section leaves nothing out", () => {
    expect(parse("workspace: {}\n").workspace).toEqual({ exclude: [] });
  });

  it("refuses an entry that is not the bare name of a folder, at its own pointer", () => {
    for (const bad of ["a/b", "/abs", "..", ".", "", "a\\b", "line\nbreak"]) {
      expect(errors(`workspace:\n  exclude: [ok, ${JSON.stringify(bad)}]\n`), JSON.stringify(bad)).toMatchObject([{ path: "/workspace/exclude/1" }]);
    }
  });

  it("refuses a name given twice, a wrong type and an unknown key", () => {
    for (const bad of ["exclude: [a, a]", "exclude: a", "exclude: [1]", "include: [a]", "required: true"]) {
      expect(errors(`workspace:\n  ${bad}\n`).length, bad).toBeGreaterThan(0);
    }
  });

  it("needs plugin.version 0.8", () => {
    expect(errors("workspace:\n  exclude: [a]\n", "0.7")).toMatchObject([{ path: "/plugin/version", message: expect.stringContaining("0.8") }]);
    expect(errors("workspace: {}\n", "0.7.9")).toMatchObject([{ path: "/plugin/version" }]);
    expect(errors("workspace:\n  exclude: [a]\n", "0.9")).toEqual([]);
  });

  it("an absent section has no hash; adding it changes only `workspace`", () => {
    expect(parse("").workspace).toBeUndefined();
    const [a, b] = [sectionHashes(parse("")), sectionHashes(parse("workspace:\n  exclude: [a]\n"))];
    expect(Object.keys(a)).not.toContain("workspace");
    expect(Object.keys(b).filter((k) => a[k] !== b[k])).toEqual(["workspace"]);
    expect(configHash(parse(""))).not.toBe(configHash(parse("workspace:\n  exclude: [a]\n")));
  });

  it("is never a required section", () => {
    expect(requiredSections(parse("workspace:\n  exclude: [a]\n"))).not.toContain("workspace");
  });
});
