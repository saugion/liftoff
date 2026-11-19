import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_BRAIN_PLUGIN, configHash, parseConfig, readConfig, requiredSections, sectionHashes } from "../../src/config/index.js";
import type { Config } from "../../src/config/index.js";

const HEAD = `liftoff: 1
plugin:
  version: "0.4"
project:
  name: acme
  kind: new
agents:
  targets: [claude-code]
`;
const parse = (extra: string): Config => {
  const r = parseConfig(HEAD + extra);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};
const fixture = (name: string): Config => {
  const r = readConfig(join(import.meta.dirname, "..", "fixtures", "config", "valid", name));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};
const differing = (a: Config, b: Config) => {
  const [x, y] = [sectionHashes(a), sectionHashes(b)];
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]).sort();
};

describe("brain section", () => {
  it("MIN_BRAIN_PLUGIN is 0.4", () => expect(MIN_BRAIN_PLUGIN).toBe("0.4"));

  it("`brain: {}` takes every default, and explicit defaults hash the same", () => {
    const empty = parse("brain: {}\n");
    expect(empty.brain).toEqual({ dir: "brain", hotMaxLines: 15, afterBuild: "propose", required: false });
    const explicit = parse("brain:\n  dir: brain\n  hotMaxLines: 15\n  afterBuild: propose\n  required: false\n");
    expect(configHash(explicit)).toBe(configHash(empty));
  });

  it("an absent section has no hash and changes nothing else", () => {
    expect(Object.keys(sectionHashes(parse("")))).not.toContain("brain");
    expect(differing(parse(""), parse("brain: {}\n"))).toEqual(["brain"]);
  });

  it("changing hotMaxLines changes only `brain` and the config hash", () => {
    const [a, b] = [parse("brain: {}\n"), parse("brain:\n  hotMaxLines: 20\n")];
    expect(differing(a, b)).toEqual(["brain"]);
    expect(configHash(a)).not.toBe(configHash(b));
  });

  it("required: true puts `brain` in requiredSections; the default does not", () => {
    expect(requiredSections(fixture("brain-required.yaml"))).toEqual(["brain", "liftoff", "plugin"]);
    expect(requiredSections(fixture("brain-empty.yaml"))).toEqual(["liftoff", "plugin"]);
  });

  it("dir is accepted nested, and a trailing slash or ./ cannot hide the repo root or .liftoff", () => {
    for (const dir of ["docs/brain", ".brain", "brain/"]) expect(parseConfig(HEAD + `brain:\n  dir: ${dir}\n`).ok, dir).toBe(true);
    for (const dir of ["./", "./.liftoff/x", ".LiftOff/brain", ".liftoff\\\\x"]) {
      const r = parseConfig(HEAD + `brain:\n  dir: "${dir}"\n`);
      expect(r.ok, dir).toBe(false);
      if (!r.ok) expect(r.errors.map((e) => e.path), dir).toContain("/brain/dir");
    }
  });
});
