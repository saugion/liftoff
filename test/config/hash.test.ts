import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../../src/config/hash.js";
import { configHash, parseConfig, readConfig, requiredSections, sectionHashes } from "../../src/config/index.js";
import type { Config } from "../../src/config/index.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "config", "valid");
const fixture = (name: string): Config => {
  const r = readConfig(join(FIXTURES, name));
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.errors)}`);
  return r.value;
};
const parse = (text: string): Config => {
  const r = parseConfig(text);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};

const HEAD = `liftoff: 1
plugin:
  version: "1.4"
project:
  name: acme
  kind: new
agents:
  targets: [claude-code]
`;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

describe("canonicalize", () => {
  it("sorts keys recursively, keeps array order, no whitespace", () => {
    expect(canonicalize({ b: 1, a: { d: [2, 1], c: "x" } })).toBe('{"a":{"c":"x","d":[2,1]},"b":1}');
  });
  it("is independent of insertion order and ignores undefined", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1, c: undefined }));
  });
  it("encodes scalars as JSON", () => {
    expect([canonicalize(1), canonicalize("a\"b"), canonicalize(true), canonicalize(null)]).toEqual(["1", '"a\\"b"', "true", "null"]);
  });
});

describe("sectionHashes", () => {
  const minimal = fixture("minimal.yaml");

  it("has one sha256 hex hash per present section and no key for an absent one", () => {
    const hashes = sectionHashes(minimal);
    expect(Object.keys(hashes).sort()).toEqual(["agents", "liftoff", "plugin", "project"]);
    for (const h of Object.values(hashes)) expect(h).toMatch(DIGEST);
  });

  it("hashes the liftoff scalar like any section (known vector: sha256 of the text '1')", () => {
    expect(sectionHashes(minimal).liftoff).toBe("sha256:6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b");
  });

  it("a section hash is the digest of its canonical JSON, required flag included", () => {
    const expected = "sha256:" + createHash("sha256").update('{"kind":"new","name":"acme-billing","required":false}').digest("hex");
    expect(sectionHashes(minimal).project).toBe(expected);
  });

  it("an empty but present section has a key (absent and present-but-empty differ)", () => {
    const withStack = parse(HEAD + "stack: {}\n");
    expect(Object.keys(sectionHashes(withStack))).toContain("stack");
    expect(configHash(withStack)).not.toBe(configHash(parse(HEAD)));
  });
});

describe("configHash is stable across formatting", () => {
  const reference = configHash(parse(HEAD));

  it("same value, different comments, whitespace, key order, quoting, flow/block style", () => {
    const variants = [
      `# a comment\n${HEAD}`,
      HEAD.replace(/\n/g, "\r\n"),
      "﻿" + HEAD,
      HEAD.replace("targets: [claude-code]", "targets:\n    - claude-code"),
      HEAD.replace("name: acme", 'name: "acme"').replace("kind: new", "kind: 'new'"),
      `agents:\n  targets: [claude-code] # trailing\nproject:\n  kind: new\n  name: acme\nplugin:\n  version: "1.4"\nliftoff: 1\n`,
      HEAD + "\n\n\n",
    ];
    for (const v of variants) expect(configHash(parse(v)), JSON.stringify(v)).toBe(reference);
  });

  it("an explicit default hashes like an omitted one, in every section", () => {
    const explicit = parse(
      HEAD.replace("version: \"1.4\"", 'version: "1.4"\n  required: true').replace("kind: new", "kind: new\n  required: false").replace(
        "targets: [claude-code]",
        "targets: [claude-code]\n  required: false",
      ),
    );
    expect(configHash(explicit)).toBe(reference);
    expect(sectionHashes(explicit)).toEqual(sectionHashes(parse(HEAD)));

    const a = parse(HEAD + "stack: {}\nmodules: {}\nconstraints: {}\n");
    const b = parse(
      HEAD +
        "stack: { languages: [], frameworks: [], required: false }\nmodules: { items: [], required: false }\nconstraints: { file: CONSTRAINTS.md, required: false }\n",
    );
    expect(configHash(a)).toBe(configHash(b));
  });

  it("the same file read through LF and CRLF fixtures gives the same hash", () => {
    const text = readFileSync(join(FIXTURES, "full.yaml"), "utf8");
    expect(configHash(parse(text.replace(/\n/g, "\r\n")))).toBe(configHash(parse(text)));
  });
});

describe("a change touches only what it should", () => {
  const base = parse(HEAD + "stack:\n  languages: [typescript]\n");
  const changed = (from: string, to: string, extra = "") => parse((HEAD + "stack:\n  languages: [typescript]\n" + extra).replace(from, to));
  const differing = (a: Config, b: Config) => {
    const [x, y] = [sectionHashes(a), sectionHashes(b)];
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]).sort();
  };

  it("one value changes only its section and the config hash", () => {
    const next = changed("name: acme", "name: other");
    expect(differing(base, next)).toEqual(["project"]);
    expect(configHash(next)).not.toBe(configHash(base));
  });

  it("flipping required changes only that section", () => {
    const next = changed("languages: [typescript]", "languages: [typescript]\n  required: true");
    expect(differing(base, next)).toEqual(["stack"]);
    expect(configHash(next)).not.toBe(configHash(base));
  });

  it("adding a section adds a key; the others are unchanged", () => {
    const next = changed("", "", "constraints: { required: true }\n");
    expect(differing(base, next)).toEqual(["constraints"]);
  });

  it("the order of a list is part of the value", () => {
    const a = parse(HEAD.replace("[claude-code]", "[claude-code, copilot]"));
    const b = parse(HEAD.replace("[claude-code]", "[copilot, claude-code]"));
    expect(configHash(a)).not.toBe(configHash(b));
  });

  it("the config hash depends on every section hash", () => {
    const hashes = sectionHashes(base);
    const tweaked = { ...hashes, project: hashes.project!.replace(/.$/, (c) => (c === "0" ? "1" : "0")) };
    expect(canonicalize(tweaked)).not.toBe(canonicalize(hashes));
  });
});

describe("requiredSections", () => {
  it("always includes liftoff and plugin, sorted", () => {
    expect(requiredSections(fixture("minimal.yaml"))).toEqual(["liftoff", "plugin"]);
  });

  it("adds sections flagged required: true; required: false does not count", () => {
    expect(requiredSections(fixture("required-flags.yaml"))).toEqual(["agents", "constraints", "liftoff", "plugin", "stack"]);
  });

  it("an unflagged full config has only the two fixed ones", () => {
    expect(requiredSections(fixture("full.yaml"))).toEqual(["liftoff", "plugin"]);
  });

  it("is a subset of the sections that have a hash", () => {
    for (const name of ["minimal.yaml", "full.yaml", "required-flags.yaml"]) {
      const config = fixture(name);
      for (const s of requiredSections(config)) expect(Object.keys(sectionHashes(config))).toContain(s);
    }
  });
});
