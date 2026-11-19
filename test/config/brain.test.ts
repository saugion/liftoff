import { createHash } from "node:crypto";
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

describe("brain.lessons", () => {
  const withLessons = (body: string) => parse(`brain:\n  lessons:${body}\n`);

  it("`lessons: {}` takes every default, and explicit defaults hash the same", () => {
    const empty = parse("brain:\n  lessons: {}\n");
    expect(empty.brain?.lessons).toEqual({ capture: "notify", promoteAfter: 2, maxRules: 20, reviewAfterDays: 90, metrics: true });
    const explicit = withLessons("\n    capture: notify\n    promoteAfter: 2\n    maxRules: 20\n    reviewAfterDays: 90\n    metrics: true");
    expect(configHash(explicit)).toBe(configHash(empty));
  });

  it("a brain without lessons has no `lessons` key, and keeps the hash it had before lessons existed", () => {
    const plain = parse("brain: {}\n");
    expect(plain.brain).toEqual({ dir: "brain", hotMaxLines: 15, afterBuild: "propose", required: false });
    expect("lessons" in plain.brain!).toBe(false);
    // the section hash of `brain: {}` is the hash recorded when the brain section was introduced (B2): unchanged
    expect(sectionHashes(plain).brain).toBe("sha256:" + createHash("sha256").update('{"afterBuild":"propose","dir":"brain","hotMaxLines":15,"required":false}').digest("hex"));
  });

  it("adding or changing lessons changes only `brain` and the config hash", () => {
    const [a, b, c] = [parse("brain: {}\n"), parse("brain:\n  lessons: {}\n"), withLessons("\n    maxRules: 12")];
    expect(differing(a, b)).toEqual(["brain"]);
    expect(differing(b, c)).toEqual(["brain"]);
    expect(new Set([configHash(a), configHash(b), configHash(c)]).size).toBe(3);
  });

  it("`required` stays the brain's: the brain flag decides requiredSections, lessons has none of its own", () => {
    expect(requiredSections(fixture("brain-lessons-full.yaml"))).toEqual(["brain", "liftoff", "plugin"]);
    expect(requiredSections(fixture("brain-lessons-empty.yaml"))).toEqual(["liftoff", "plugin"]);
  });

  it.each([
    ["promoteAfter 1", "\n    promoteAfter: 1"], ["promoteAfter 11", "\n    promoteAfter: 11"], ["maxRules 4", "\n    maxRules: 4"],
    ["maxRules 41", "\n    maxRules: 41"], ["reviewAfterDays 29", "\n    reviewAfterDays: 29"], ["reviewAfterDays 366", "\n    reviewAfterDays: 366"],
    ["capture always", "\n    capture: always"], ["metrics maybe", "\n    metrics: maybe"], ["required inside lessons", "\n    required: true"],
  ])("rejects %s", (_n, body) => {
    expect(parseConfig(HEAD + `brain:\n  lessons:${body}\n`).ok).toBe(false);
  });
});
