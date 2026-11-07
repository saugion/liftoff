import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig, readConfig, validateConfig } from "../../src/config/read.js";
import { tempDir } from "../helpers.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "config");
const files = (kind: "valid" | "invalid") => readdirSync(join(FIXTURES, kind)).filter((f) => f.endsWith(".yaml")).sort();
const path = (kind: "valid" | "invalid", name: string) => join(FIXTURES, kind, name);

const expected = (text: string): string => {
  const m = /^# expect:[ \t]*(.*)$/m.exec(text);
  if (!m) throw new Error("invalid fixture without an '# expect:' header");
  return m[1]!.trim();
};

describe("valid fixtures", () => {
  it.each(files("valid"))("%s is accepted", (name) => {
    const r = readConfig(path("valid", name));
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});

describe("invalid fixtures", () => {
  it.each(files("invalid"))("%s is rejected at its expected pointer", (name) => {
    const file = path("invalid", name);
    const want = expected(readFileSync(file, "utf8"));
    const r = readConfig(file);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.path), JSON.stringify(r.errors)).toContain(want);
  });

  it("YAML syntax and duplicate-key errors carry line and col", () => {
    for (const name of ["syntax-error.yaml", "duplicate-key.yaml", "two-documents.yaml"]) {
      const r = readConfig(path("invalid", name));
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.errors[0]!.line, name).toBeGreaterThan(0);
      expect(r.errors[0]!.col, name).toBeGreaterThan(0);
      expect(r.errors[0]!.message, name).not.toMatch(/:\s*$/);
    }
  });

  it("schema errors have no line", () => {
    const r = readConfig(path("invalid", "wrong-type.yaml"));
    expect(!r.ok && r.errors[0]!.line).toBeFalsy();
  });
});

describe("line endings and BOM do not change the result", () => {
  const dir = tempDir();
  const variants: [string, (s: string) => string][] = [
    ["CRLF", (s) => s.replace(/\n/g, "\r\n")],
    ["BOM", (s) => "\uFEFF" + s],
    ["BOM+CRLF", (s) => "\uFEFF" + s.replace(/\n/g, "\r\n")],
  ];
  const strip = (r: ReturnType<typeof readConfig>) => (r.ok ? r : { ok: false, errors: r.errors.map((e) => ({ path: e.path, line: e.line })) });

  for (const [label, transform] of variants) {
    it.each([...files("valid").map((n) => ["valid", n] as const), ...files("invalid").map((n) => ["invalid", n] as const)])(
      `${label}: %s/%s`,
      (kind, name) => {
        const original = readFileSync(path(kind, name), "utf8");
        const copy = join(dir, `${label}-${kind}-${name}`);
        writeFileSync(copy, transform(original));
        expect(strip(readConfig(copy))).toEqual(strip(readConfig(path(kind, name))));
      },
    );
  }
});

describe("readConfig edge cases", () => {
  it("a directory is an error, not a throw", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "liftoff.yaml"));
    const r = readConfig(join(dir, "liftoff.yaml"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]!.message).toMatch(/cannot read/);
  });

  it("a missing file is an error, not a throw", () => {
    expect(readConfig(join(tempDir(), "nope.yaml")).ok).toBe(false);
  });

  it("invalid UTF-8 is an error", () => {
    const file = join(tempDir(), "liftoff.yaml");
    writeFileSync(file, Buffer.from([0x6c, 0xff, 0xfe, 0x0a]));
    const r = readConfig(file);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]!.message).toMatch(/UTF-8/);
  });

  it.each(["", "   \n", "# only a comment\n"])("empty-ish text %j is 'file is empty'", (text) => {
    const r = parseConfig(text);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]!.message).toBe("file is empty");
  });
});

describe("validateConfig: paths and ids", () => {
  const base = { liftoff: 1, plugin: { version: "1.4" }, project: { name: "a", kind: "new" }, agents: { targets: ["copilot"] } };
  const withPath = (p: string) => validateConfig({ ...base, modules: { items: [{ id: "m", path: p }] } });

  it.each(["src/api", "src/api/", "./src", "a/..b", "a/b..", "."])("accepts module path %j at the schema level", (p) => {
    expect(withPath(p).ok).toBe(true);
  });

  it.each(["/abs", "\\abs", "C:/x", "C:\\x", "..", "../x", "a/..", "a/../b", "a\\..\\b", ""])("rejects module path %j", (p) => {
    const r = withPath(p);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.map((e) => e.path)).toContain("/modules/items/0/path");
  });

  it.each(["api", "web-app", "a1", "a-1-b"])("accepts module id %j", (id) => {
    expect(validateConfig({ ...base, modules: { items: [{ id, path: "x" }] } }).ok).toBe(true);
  });

  it.each(["Api", "api_layer", "-api", "api-", "a--b", ""])("rejects module id %j", (id) => {
    const r = validateConfig({ ...base, modules: { items: [{ id, path: "x" }] } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.map((e) => e.path)).toContain("/modules/items/0/id");
  });

  it("escapes ~ and / in property names inside pointers", () => {
    const r = validateConfig({ ...base, "a/b~c": 1 });
    expect(!r.ok && r.errors.map((e) => e.path)).toContain("/a~1b~0c");
  });

  it("reports every problem, not only the first (allErrors)", () => {
    const r = validateConfig({ liftoff: 1, plugin: {}, project: {}, agents: {} });
    expect(!r.ok && r.errors.map((e) => e.path).sort()).toEqual(
      ["/agents/targets", "/plugin/version", "/project/kind", "/project/name"].sort(),
    );
  });
});

describe("normalization (defaults inside present sections only)", () => {
  const minimal = readConfig(path("valid", "minimal.yaml"));
  const full = readConfig(path("valid", "full.yaml"));

  it("minimal: mandatory sections get their defaults, optional sections stay absent", () => {
    expect(minimal.ok && minimal.value).toEqual({
      liftoff: 1,
      plugin: { version: "1.4", required: true },
      project: { name: "acme-billing", kind: "new", required: false },
      agents: { targets: ["claude-code"], required: false },
    });
  });

  it("present-but-empty sections get defaults", () => {
    const r = validateConfig({
      liftoff: 1,
      plugin: { version: "1.4" },
      project: { name: "a", kind: "new" },
      agents: { targets: ["copilot"] },
      stack: {},
      modules: {},
      constraints: {},
    });
    expect(r.ok && r.value).toMatchObject({
      stack: { languages: [], frameworks: [], required: false },
      modules: { items: [], required: false },
      constraints: { file: "CONSTRAINTS.md", required: false },
    });
  });

  it("full: values are kept, tracker and codeHost stay empty mappings", () => {
    expect(full.ok && full.value).toMatchObject({
      constraints: { file: "docs/CONSTRAINTS.md", required: false },
      modules: { items: [{ id: "api", path: "src/api", description: "HTTP layer" }, { id: "web-app", path: "apps/web/" }] },
      tracker: {},
      codeHost: {},
    });
  });
});
