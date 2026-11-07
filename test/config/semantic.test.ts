import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig, readConfig, validateConfig } from "../../src/config/read.js";
import { secretGuard } from "../../src/config/secrets.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "config");
const invalid = (name: string) => {
  const r = readConfig(join(FIXTURES, "invalid", name));
  if (r.ok) throw new Error(`${name} should be invalid`);
  return r.errors;
};

describe("compat check: config format newer than supported", () => {
  it("liftoff: 2 gives exactly one error that says to update the plugin, with no unknown-key noise", () => {
    const errors = invalid("format-too-new.yaml");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: "/liftoff" });
    expect(errors[0]!.message).toBe("config format 2 needs a newer LiftOff, update the plugin");
  });

  it.each([2, 3, 99])("format %i is 'too new'", (n) => {
    const r = validateConfig({ liftoff: n, whatever: true });
    expect(!r.ok && r.errors).toHaveLength(1);
  });

  it.each([0, -1, 1.5, "2", null])("format %j is an ordinary schema error, not 'too new'", (n) => {
    const r = validateConfig({ liftoff: n, plugin: { version: "1.4" }, project: { name: "a", kind: "new" }, agents: { targets: ["copilot"] } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.some((e) => e.message.includes("update the plugin"))).toBe(false);
  });

  it("also applies to parseConfig on text", () => {
    const r = parseConfig("liftoff: 2\n");
    expect(!r.ok && r.errors[0]!.message).toMatch(/update the plugin/);
  });
});

describe("duplicate module ids", () => {
  it("points at the later duplicate and names the first", () => {
    const errors = invalid("duplicate-module-id.yaml");
    expect(errors).toEqual([
      { path: "/modules/items/2/id", message: "duplicate module id 'api' (first used at /modules/items/0/id)" },
    ]);
  });

  it("reports each repeat", () => {
    const base = { liftoff: 1, plugin: { version: "1.4" }, project: { name: "a", kind: "new" }, agents: { targets: ["copilot"] } };
    const r = validateConfig({ ...base, modules: { items: ["a", "b", "a", "a"].map((id, i) => ({ id, path: `p${i}` })) } });
    expect(!r.ok && r.errors.map((e) => e.path)).toEqual(["/modules/items/2/id", "/modules/items/3/id"]);
  });

  it("is not checked while the schema already reports problems (no cascade)", () => {
    const r = validateConfig({ liftoff: 1, modules: { items: [{ id: "a", path: "x" }, { id: "a", path: "y" }] } });
    expect(!r.ok && r.errors.some((e) => e.message.includes("duplicate"))).toBe(false);
  });
});

describe("secret guard", () => {
  it("flags credential-like keys at any depth, normalizing case, '_' and '-'", () => {
    const keys = ["token", "Token", "PASSWORD", "passwd", "secret", "api_key", "api-key", "apiKey", "private_key", "auth", "pat"];
    for (const k of keys) {
      const errors = secretGuard({ a: { b: { [k]: 1 } } });
      expect(errors.map((e) => e.path), k).toEqual([`/a/b/${k}`]);
    }
  });

  it("false positives pass: tokenizer, authorEmail, path, patch, secretary", () => {
    expect(secretGuard({ tokenizer: 1, authorEmail: "a@b.c", path: "x", patch: 1, secretary: 1, authority: 1 })).toEqual([]);
  });

  it("flags URLs that carry a password and known token prefixes in values, anywhere", () => {
    const bad = [
      "https://user:pass@host.example/repo",
      "see ssh://deploy:hunter2@git.example.com/x",
      "ghp_abcdefghij1234567890",
      "use github_pat_11ABCDEFG0abcdefghij now",
      "glpat-abcdefghij1234567890",
      "lin_api_abcdefghij1234567890",
      "xoxb-1234567890-abcdef",
    ];
    for (const v of bad) expect(secretGuard({ list: [{ v }] }).map((e) => e.path), v).toEqual(["/list/0/v"]);
  });

  it("values that only look similar pass", () => {
    const good = ["xoxo-app", "ghp_", "ghp_short", "ssh://git@github.com/acme/repo.git", "https://example.com/a@b", "a url: https://host/path"];
    for (const v of good) expect(secretGuard({ v }), v).toEqual([]);
  });

  it("walks scalars and lists at the root without throwing", () => {
    expect(secretGuard(42)).toEqual([]);
    expect(secretGuard(null)).toEqual([]);
    expect(secretGuard(["ghp_abcdefghij1234567890"]).map((e) => e.path)).toEqual(["/0"]);
  });

  it("every message says it is an accident guard, not a guarantee", () => {
    for (const e of secretGuard({ token: "x", v: "ghp_abcdefghij1234567890" })) expect(e.message).toMatch(/not a guarantee/);
  });

  it("escapes ~ and / in key names inside the pointer", () => {
    expect(secretGuard({ "a/b": { "tok~en": 1, token: 1 } }).map((e) => e.path)).toEqual(["/a~1b/token"]);
  });

  it("a secret key is reported once, with the secret message, not as a bare unknown key", () => {
    const errors = invalid("secret-key-top-level.yaml");
    expect(errors.filter((e) => e.path === "/token")).toHaveLength(1);
    expect(errors.find((e) => e.path === "/token")!.message).toMatch(/credential/);
  });

  it("a non-secret unknown key keeps the plain schema message", () => {
    const base = { liftoff: 1, plugin: { version: "1.4" }, project: { name: "a", kind: "new" }, agents: { targets: ["copilot"] } };
    const r = validateConfig({ ...base, tokenizer: 1, authorEmail: "a@b.c" });
    expect(!r.ok && r.errors.map((e) => e.path).sort()).toEqual(["/authorEmail", "/tokenizer"]);
    expect(!r.ok && r.errors.every((e) => !/credential/.test(e.message))).toBe(true);
  });

  it("a valid config with look-alike names and values is accepted", () => {
    const r = readConfig(join(FIXTURES, "valid", "no-false-positives.yaml"));
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("the fixtures with secrets are rejected for the secret, not for something else", () => {
    for (const name of ["secret-value-url.yaml", "secret-value-prefix.yaml", "secret-value-slack.yaml", "secret-key-nested.yaml"]) {
      const errors = invalid(name);
      expect(errors, name).toHaveLength(1);
      expect(errors[0]!.message, name).toMatch(/credential/);
    }
    expect(readFileSync(join(FIXTURES, "invalid", "secret-value-prefix.yaml"), "utf8")).toContain("# expect:");
  });
});
