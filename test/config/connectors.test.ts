import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareVersions as cliCompare } from "../../src/cli/version.js";
import { configHash, connectors, compareVersions, parseConfig, readConfig, sectionHashes, validateConfig } from "../../src/config/index.js";
import type { Config } from "../../src/config/index.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "config");
const valid = (name: string): Config => {
  const r = readConfig(join(FIXTURES, "valid", name));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};
const base = { liftoff: 1, plugin: { version: "0.2" }, project: { name: "a", kind: "new" }, agents: { targets: ["copilot"] } };
const tracker = { kind: "jira-dc", url: "https://jira.company.local", project: "PROJ", server: { version: "0.23.1" } };
const codeHost = { kind: "gitlab", host: "gitlab.company.local" };
const errorsOf = (extra: object) => {
  const r = validateConfig({ ...base, ...extra });
  return r.ok ? [] : r.errors;
};

describe("a missing or unknown kind gives exactly one clean pointer", () => {
  it.each([
    [{ tracker: { project: "PROJ" } }, "/tracker/kind"],
    [{ tracker: { kind: "x" } }, "/tracker/kind"],
    [{ codeHost: { host: "h" } }, "/codeHost/kind"],
    [{ tracker: { kind: "jira-dc", project: "PROJ", server: { version: "0.23.1" } } }, "/tracker/url"],
    [{ tracker: { ...tracker, foo: 1 } }, "/tracker/foo"],
  ])("%j", (extra, pointer) => {
    expect(errorsOf(extra).map((e) => e.path)).toEqual([pointer]);
  });
});

describe("normalization", () => {
  it("fills defaults and keeps absent scalars absent", () => {
    const c = connectors(parseOk({ tracker, codeHost }));
    expect(c.tracker).toEqual({ ...tracker, server: { version: "0.23.1", sslVerify: true, readOnly: false }, issueTypes: [] });
    expect(c.codeHost).toEqual({ ...codeHost, conventions: { labels: [], reviewers: [] } });
  });
  it("fills the inside of an issue type", () => {
    const t = connectors(parseOk({ tracker: { ...tracker, issueTypes: [{ name: "Story" }] } })).tracker!;
    expect(t.issueTypes).toEqual([{ name: "Story", readingMap: { fields: [] }, createFields: {}, transitions: {} }]);
  });
  it("host case and a trailing slash hash alike; omitted and explicit defaults hash alike", () => {
    const a = parseOk({ tracker: { ...tracker, url: "https://jira.company.local" } });
    const b = parseOk({ tracker: { ...tracker, url: "https://JIRA.Company.local/", server: { version: "0.23.1", sslVerify: true, readOnly: false } } });
    expect(sectionHashes(a).tracker).toBe(sectionHashes(b).tracker);
    expect(configHash(a)).toBe(configHash(b));
    expect(connectors(parseOk({ codeHost: { ...codeHost, host: "GitLab.Local:8443" } })).codeHost!.host).toBe("gitlab.local:8443");
  });
  it("keeps a context path and a port, drops only trailing slashes", () => {
    const url = connectors(parseOk({ tracker: { ...tracker, url: "https://Jira.X.local:8443/jira//" } })).tracker!.url;
    expect(url).toBe("https://jira.x.local:8443/jira");
  });
  it("`{}` stays `{}` and connectors() ignores it", () => {
    const c = parseOk({ tracker: {}, codeHost: {} });
    expect(c.tracker).toEqual({});
    expect(connectors(c)).toEqual({});
    expect(connectors(parseOk({ tracker })).codeHost).toBeUndefined();
  });
});

describe("compatibility", () => {
  it("compareVersions is exported from src/config and from src/cli/version", () => {
    expect(compareVersions).toBe(cliCompare);
    expect(compareVersions("0.2", "0.1.9")).toBeGreaterThan(0);
  });
  it("every new fixture gives the same result with CRLF line endings", () => {
    for (const kind of ["valid", "invalid"]) {
      for (const f of readdirSync(join(FIXTURES, kind)).filter((n) => n.startsWith("connect-"))) {
        const text = readFileSync(join(FIXTURES, kind, f), "utf8");
        const lf = parseConfig(text), crlf = parseConfig(text.replace(/\n/g, "\r\n"));
        expect(crlf, f).toEqual(lf);
      }
    }
  });
});

// Every value that can reach a shell command must reject every metacharacter.
describe("shell safety", () => {
  const BAD = [..."`'\"$;&|<>\\(){}*?!# \t\n"];
  const fields: [string, (v: string) => object, string][] = [
    ["tracker.url", (v) => ({ tracker: { ...tracker, url: `https://jira.local/${v}` } }), "/tracker/url"],
    ["tracker.url host", (v) => ({ tracker: { ...tracker, url: `https://ji${v}ra.local` } }), "/tracker/url"],
    ["codeHost.host", (v) => ({ codeHost: { ...codeHost, host: `git${v}lab.local` } }), "/codeHost/host"],
    ["tracker.project", (v) => ({ tracker: { ...tracker, project: `PR${v}J` } }), "/tracker/project"],
    ["server.version", (v) => ({ tracker: { ...tracker, server: { version: `0.23.1${v}` } } }), "/tracker/server/version"],
    ["targetBranch", (v) => ({ codeHost: { ...codeHost, conventions: { targetBranch: `ma${v}in` } } }), "/codeHost/conventions/targetBranch"],
    ["reviewer", (v) => ({ codeHost: { ...codeHost, conventions: { reviewers: [`al${v}ice`] } } }), "/codeHost/conventions/reviewers/0"],
  ];
  for (const [name, make, pointer] of fields) {
    it(`${name} rejects every metacharacter`, () => {
      for (const ch of BAD) expect(errorsOf(make(ch)).map((e) => e.path), `${name}: ${JSON.stringify(ch)}`).toContain(pointer);
    });
  }
  it("a '~' is allowed in a url path", () => {
    expect(errorsOf({ tracker: { ...tracker, url: "https://jira.local/~x" } })).toEqual([]);
  });
});

function parseOk(extra: object): Config {
  const r = validateConfig({ ...base, ...extra });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
}
