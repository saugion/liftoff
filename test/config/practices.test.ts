import { describe, expect, it } from "vitest";
import { MIN_PRACTICES_PLUGIN, configHash, metricsOn, parseConfig, practiceMode, requiredSections, sectionHashes } from "../../src/config/index.js";
import type { Config } from "../../src/config/index.js";
import { resolvedPractices } from "../../src/config/practices.js";

const HEAD = (v = "0.5") => `liftoff: 1\nplugin:\n  version: "${v}"\nproject:\n  name: acme\n  kind: new\nagents:\n  targets: [claude-code]\n`;
const parse = (extra: string, v = "0.5"): Config => {
  const r = parseConfig(HEAD(v) + extra);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};
const errors = (extra: string, v = "0.5") => {
  const r = parseConfig(HEAD(v) + extra);
  return r.ok ? [] : r.errors;
};

describe("practices", () => {
  it("MIN_PRACTICES_PLUGIN is 0.5", () => expect(MIN_PRACTICES_PLUGIN).toBe("0.5"));
  it("a config without the section resolves the defaults: the PO review on, the steps that add work off", () => {
    const c = parse("");
    expect(c.practices).toBeUndefined();
    expect(resolvedPractices(c)).toEqual({ "ticket-po-review": "on", "verify-first": "off", "clean-review": "off" });
  });
  it("unquoted on / off are read as the words, not as booleans", () => {
    const c = parse("practices:\n  ticket-po-review: off\n  verify-first: on\n  clean-review: nudge\n");
    expect(c.practices).toEqual({ "ticket-po-review": "off", "verify-first": "on", "clean-review": "nudge", required: false });
    expect(practiceMode(c, "ticket-po-review")).toBe("off");
    expect(practiceMode(c, "verify-first")).toBe("on");
  });
  it("only the keys that were written are kept, so a default added later never moves a hash", () => {
    const c = parse("practices:\n  verify-first: nudge\n");
    expect(c.practices).toEqual({ "verify-first": "nudge", required: false });
    expect(practiceMode(c, "clean-review")).toBe("off");
  });
  it("an absent section has no hash and changes nothing else; adding it changes only `practices`", () => {
    expect(Object.keys(sectionHashes(parse("")))).not.toContain("practices");
    const [a, b] = [sectionHashes(parse("")), sectionHashes(parse("practices: {}\n"))];
    expect(Object.keys(b).filter((k) => a[k] !== b[k])).toEqual(["practices"]);
    expect(configHash(parse(""))).not.toBe(configHash(parse("practices: {}\n")));
  });
  it("`required` joins requiredSections", () => {
    expect(requiredSections(parse("practices: { verify-first: on, required: true }\n"))).toContain("practices");
    expect(requiredSections(parse("practices: { verify-first: on }\n"))).not.toContain("practices");
  });
  it("an unknown id, a page id and a bad mode are errors", () => {
    for (const bad of ["verify-frist: on", "small-slices: on", "verify-first: maybe", "verify-first: true", "verify-first: 1"]) {
      expect(errors(`practices:\n  ${bad}\n`).length, bad).toBeGreaterThan(0);
    }
  });
  it("needs plugin.version 0.5", () => {
    expect(errors("practices: {}\n", "0.4")).toMatchObject([{ path: "/plugin/version", message: expect.stringContaining("0.5") }]);
    expect(errors("pilot: {}\n", "0.4")).toMatchObject([{ path: "/plugin/version" }]);
  });
});

describe("pilot", () => {
  it("`pilot: {}` turns metrics on; explicit false turns them off", () => {
    expect(parse("pilot: {}\n").pilot).toEqual({ metrics: true, required: false });
    expect(metricsOn(parse("pilot: {}\n"))).toBe(true);
    expect(metricsOn(parse("pilot: { metrics: false }\n"))).toBe(false);
  });
  it("without the section, the older brain.lessons.metrics still decides, else off", () => {
    expect(metricsOn(parse(""))).toBe(false);
    expect(metricsOn(parse("brain:\n  lessons: {}\n"))).toBe(true);
    expect(metricsOn(parse("brain:\n  lessons: { metrics: false }\n"))).toBe(false);
  });
  it("pilot wins over the older switch", () => {
    expect(metricsOn(parse("pilot: { metrics: false }\nbrain:\n  lessons: {}\n"))).toBe(false);
    expect(metricsOn(parse("pilot: { metrics: true }\nbrain:\n  lessons: { metrics: false }\n"))).toBe(true);
  });
});
