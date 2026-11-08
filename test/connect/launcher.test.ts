import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config/index.js";
import { buildInfo } from "../../src/connect/info.js";
import { shQuote } from "../../src/connect/shell.js";
import { tempDir } from "../helpers.js";

const cfg = parseConfig(
  'liftoff: 1\nplugin: { version: "0.2" }\nproject: { name: a, kind: new }\nagents: { targets: [claude-code] }\n' +
    "tracker: { kind: jira-dc, url: 'https://jira.company.local', project: PROJ, server: { version: '0.23.1' } }\n",
);
if (!cfg.ok) throw new Error(JSON.stringify(cfg.errors));
const info = buildInfo(cfg.value, "0");
const LAUNCHER = (info.mcp[0]!.entry as any).args[1] as string;
const PREFLIGHT = info.credential!.preflight;

// A sandbox: a fake uvx that records what it receives, an optional fake security, and a PATH with nothing else but the base tools.
function sandbox(opts: { uvx?: boolean; keychain?: string | null } = {}) {
  const dir = tempDir("liftoff-launcher-");
  const bin = join(dir, "bin"), out = join(dir, "out");
  mkdirSync(bin), mkdirSync(out);
  const script = (name: string, body: string) => (writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`), chmodSync(join(bin, name), 0o755));
  if (opts.uvx !== false) script("uvx", `printf '%s\\n' "$@" > "${out}/argv"; printf '%s' "$JIRA_PERSONAL_TOKEN" > "${out}/token"; env > "${out}/env"; ps -o args= -p $$ > "${out}/ps"`);
  script("security", opts.keychain == null ? `echo called >> "${out}/security-called"; exit 44` : `echo called >> "${out}/security-called"; printf '%s\\n' ${shQuote(opts.keychain)}`);
  const read = (f: string) => { try { return readFileSync(join(out, f), "utf8"); } catch { return undefined; } };
  const exec = (cmd: string, env: Record<string, string> = {}) =>
    spawnSync("sh", ["-c", cmd], { encoding: "utf8", env: { PATH: `${opts.uvx === false ? "" : bin + ":"}${opts.uvx === false ? bin + ":" : ""}/usr/bin:/bin`, HOME: dir, ...env } });
  return { read, exec };
}
// uvx missing: PATH holds a `security` stub but no uvx.
const TOKENS = ["plain", "with space", "q'uote", 'd"q', "$HOME", "`id`", "back\\slash", "semi;colon", "star*", "a&b|c"];

describe("the launcher, run by a real sh", () => {
  it("an exported variable wins and the keychain is not asked", () => {
    const s = sandbox({ keychain: "from-keychain" });
    const r = s.exec(LAUNCHER, { LIFTOFF_JIRA_TOKEN: "from-env" });
    expect(r.status).toBe(0);
    expect(s.read("token")).toBe("from-env");
    expect(s.read("security-called")).toBeUndefined();
  });
  it("without the variable, the keychain's value is used", () => {
    const s = sandbox({ keychain: "from-keychain" });
    expect(s.exec(LAUNCHER).status).toBe(0);
    expect(s.read("token")).toBe("from-keychain");
  });
  it("no token anywhere: exit 1, the message on stderr, uvx never called", () => {
    const s = sandbox({ keychain: null });
    const r = s.exec(LAUNCHER);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no Jira token found \(or the keychain is locked\)/);
    expect(s.read("argv")).toBeUndefined();
  });
  it("uvx missing: exit 1 with the install hint", () => {
    const s = sandbox({ uvx: false, keychain: "x" });
    const r = s.exec(LAUNCHER, { LIFTOFF_JIRA_TOKEN: "t" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/uvx not found \(brew install uv\)/);
  });
  it("the token is not in argv or in the ps line, T is not in the environment, and argv ends with --env-file /dev/null", () => {
    const s = sandbox();
    s.exec(LAUNCHER, { LIFTOFF_JIRA_TOKEN: "SECRET-VALUE-123" });
    const argv = s.read("argv")!.trim().split("\n");
    expect(argv).toEqual(["mcp-atlassian@0.23.1", "--env-file", "/dev/null"]);
    expect(s.read("ps")).not.toContain("SECRET-VALUE-123");
    expect(s.read("env")!.split("\n").some((l) => l.startsWith("T="))).toBe(false);
  });
  it.each(TOKENS)("a hostile token arrives intact: %s", (token) => {
    const s = sandbox();
    expect(s.exec(LAUNCHER, { LIFTOFF_JIRA_TOKEN: token }).status).toBe(0);
    expect(s.read("token")).toBe(token);
  });
});

describe("the preflight", () => {
  it("with a token: prints nothing, exit 0, runs uvx --version, never prints the token", () => {
    const s = sandbox();
    const r = s.exec(PREFLIGHT, { LIFTOFF_JIRA_TOKEN: "SECRET-VALUE-123" });
    expect(r).toMatchObject({ status: 0, stdout: "", stderr: "" });
    expect(s.read("argv")!.trim().split("\n")).toEqual(["mcp-atlassian@0.23.1", "--version"]);
  });
  it("reports the same failures as the launcher", () => {
    expect(sandbox({ keychain: null }).exec(PREFLIGHT)).toMatchObject({ status: 1 });
    expect(sandbox({ keychain: null }).exec(PREFLIGHT).stderr).toMatch(/no Jira token found/);
    expect(sandbox({ uvx: false }).exec(PREFLIGHT, { LIFTOFF_JIRA_TOKEN: "t" }).stderr).toMatch(/uvx not found/);
  });
});

describe("shQuote under real shells", () => {
  const HOSTILE = ["a'b", "$(echo pwn)", "`echo pwn`", "line1\nline2", "a;b", "*", "", "\\'", "it's \"x\" $HOME"];
  for (const shell of ["sh", "dash", "zsh"]) {
    const available = spawnSync(shell, ["-c", "true"]).status === 0;
    it.skipIf(!available).each(HOSTILE)(`${shell} prints %j literally`, (v) => {
      const r = spawnSync(shell, ["-c", `printf %s ${shQuote(v)}`], { encoding: "utf8" });
      expect(r.stdout).toBe(v);
    });
  }
});
