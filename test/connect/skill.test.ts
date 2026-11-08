import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseConfig } from "../../src/config/index.js";
import { secretGuard } from "../../src/config/secrets.js";
import defaults from "../../src/connect/defaults.json" with { type: "json" };
import { JIRA_TOOLS } from "../../src/connect/tools.js";
import schema from "../../schema/liftoff.schema.json" with { type: "json" };

const ROOT = join(import.meta.dirname, "..", "..");
const SKILL = join(ROOT, "plugin", "skills", "liftoff-connect");
const read = (...p: string[]) => readFileSync(join(SKILL, ...p), "utf8");
const text = read("SKILL.md");
const lead = read("references", "lead-onboarding.md");
const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)!;
const front = parse(match[1]!) as Record<string, any>;
const body = match[2]!;
const golden = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "connect", "both", "expected.json"), "utf8"));

const get = (obj: any, path: string): unknown => path.split(".").reduce((o, k) => o?.[k], obj);

describe("the skill is loadable", () => {
  it("name equals its directory and is kebab-case; license; description names the triggers", () => {
    expect(front.name).toBe("liftoff-connect");
    expect(front.license).toBe("Apache-2.0");
    for (const t of ["connect jira", "connect gitlab", "liftoff connect", "liftoff connect lead", "relearn conventions", "set up my tracker"]) expect(front.description, t).toContain(t);
  });
  it("allowed-tools is exactly the CLI rule, and nothing else is pre-approved", () => {
    expect(front["allowed-tools"]).toBe('Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff.mjs" *)');
    expect(body).toContain('node "${CLAUDE_PLUGIN_ROOT}/bin/liftoff.mjs" <command> --root "<abs path>"');
  });
  it("has the fallback for hosts that do not substitute the variable", () => {
    expect(body).toMatch(/still contains `\$\{`/);
    expect(body).toMatch(/directory this SKILL\.md was loaded from/);
    expect(body).toContain("../../bin/liftoff.mjs");
  });
  it("every file it refers to exists; ${CLAUDE_PLUGIN_ROOT} appears only in SKILL.md", () => {
    const refs = [...(body + lead).matchAll(/`((?:assets|references)\/[A-Za-z0-9_./-]+)`/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(3);
    for (const r of new Set(refs)) expect(existsSync(join(SKILL, r)), r).toBe(true);
    expect(lead).not.toContain("CLAUDE_PLUGIN_ROOT");
  });
});

describe("the member flow speaks connect-info's contract (drift check)", () => {
  const KEYS = ["prerequisites", "credential.envCheck", "credential.keychain.check", "credential.keychain.add", "credential.keychain.remove",
    "credential.preflight", "credential.createToken", "mcp", "gitlab.login", "gitlab.status", "agents", "tracker.project", "tracker.issueTypes", "codeHost.conventions"];
  it.each(KEYS)("names %s, and it exists in the real output", (key) => {
    expect(body, key).toContain(key);
    expect(get(golden, key), key).toBeDefined();
  });
  it("every key of an mcp entry the skill relies on exists", () => {
    for (const k of ["file", "serversKey", "server", "entry"]) expect(golden.mcp[0][k], k).toBeDefined();
    for (const k of ["file", "serversKey", "server", "entry"]) expect(body, k).toContain(k);
  });
  it("handles every failure shape connect-info can produce", () => {
    for (const s of ["usage", "internal", "plugin-outdated", "config-missing", "config-invalid", "not-applied", "required-changed", "exit 2"]) expect(body, s).toContain(s);
  });
  it("routing names every state", () => {
    for (const s of ["no connector", "lead work incomplete", "lead work done", "liftoff connect lead"]) expect(body.toLowerCase(), s).toContain(s.toLowerCase());
  });
  it("every jira_* tool named in the skill or the reference is one the server exposes", () => {
    for (const name of new Set([...(body + lead).matchAll(/\bjira_[a-z_]+/g)].map((m) => m[0]))) expect(JIRA_TOOLS as string[], name).toContain(name);
    expect(lead).not.toMatch(/jira_(delete|move|assign|batch)/);
  });
});

describe("no secret-bearing command is hardcoded", () => {
  const spans = (t: string) => [...t.matchAll(/```[\s\S]*?```/g), ...t.matchAll(/`[^`\n]+`/g)].map((m) => m[0]);
  const FORBIDDEN = [/security add-generic-password/, /security find-generic-password[^`]*-[wg]\b/, /--token/, /LIFTOFF_JIRA_TOKEN=/, /uvx mcp-atlassian/,
    /glab auth login/, /glab auth status[^`]*-t\b/, /\bprintenv\b/, /(^|[`\s])env(\s|`|$)/];
  it.each([["SKILL.md", text], ["lead-onboarding.md", lead]])("%s has none inside a code block or a backticked command", (_n, t) => {
    for (const s of spans(t)) for (const re of FORBIDDEN) expect(s, `${re} in ${s}`).not.toMatch(re);
  });
  it("states the rules in prose: never in the chat, revoke", () => {
    expect(text).toMatch(/never in the chat/);
    expect(text).toMatch(/revoke/i);
    expect(text).toMatch(/`credential\.keychain\.add` or\s+`gitlab\.login` yourself/);
  });
});

describe("lead-onboarding.md", () => {
  const blocks = [...lead.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const BASE = (tracker: string, codeHost: string) =>
    `liftoff: 1\nplugin: { version: "0.2" }\nproject: { name: a, kind: new }\nagents: { targets: [claude-code] }\n${tracker}${codeHost}`;
  const indent = (t: string, n: number) => t.replace(/\n$/, "").split("\n").map((l) => " ".repeat(n) + l).join("\n") + "\n";

  it("has the four fragments, each starting with its splice point", () => {
    expect(blocks.map((b) => /^# splice: (\S+)/.exec(b)![1])).toEqual(["tracker", "codeHost", "tracker.issueTypes[]", "codeHost.conventions", "streams.items[]"]);
  });
  it.each([0, 1, 2, 3, 4])("fragment %i spliced into a minimal config passes validateConfig", (i) => {
    const b = blocks[i]!;
    const point = /^# splice: (\S+)/.exec(b)![1]!;
    const config = {
      tracker: BASE(`tracker:\n${indent(b, 2)}`, ""),
      codeHost: BASE("", `codeHost:\n${indent(b, 2)}`),
      "tracker.issueTypes[]": BASE(`tracker:\n  kind: jira-dc\n  url: https://j.local\n  project: PROJ\n  server: { version: "0.23.1" }\n  issueTypes:\n    - ${indent(b, 6).trimStart()}`, ""),
      "streams.items[]": BASE(`tracker:\n  kind: jira-dc\n  url: https://j.local\n  project: PROJ\n  server: { version: "0.23.1" }\nstreams:\n  items:\n    - ${indent(b, 6).trimStart()}`, "").replace('version: "0.2"', 'version: "0.3"'),
      "codeHost.conventions": BASE("", `codeHost:\n  kind: gitlab\n  host: g.local\n  conventions:\n${indent(b, 4)}`),
    }[point]!;
    const r = parseConfig(config);
    expect(r.ok, JSON.stringify(r) + config).toBe(true);
  });
  it("every backticked config path resolves in the schema (through if/then/anyOf)", () => {
    const resolve = (node: any): any => (node?.$ref ? resolve(node.$ref.split("/").slice(1).reduce((o: any, k: string) => o[k], schema)) : node);
    const children = (node: any, key: string): any[] => {
      const n = resolve(node);
      if (!n) return [];
      const direct = n.properties?.[key] !== undefined ? [resolve(n.properties[key])] : [];
      const nested = [n.then, n.if, ...(n.anyOf ?? []), ...(n.allOf ?? [])].flatMap((s) => (s ? children(s, key) : []));
      const dyn = n.propertyNames && n.type === "object" && !n.properties ? [{}] : [];
      return [...direct, ...nested, ...dyn].filter((c) => c !== true);
    };
    const step = (nodes: any[], seg: string): any[] => {
      const arr = seg.endsWith("[]");
      const key = arr ? seg.slice(0, -2) : seg;
      return nodes.flatMap((n) => children(n, key)).flatMap((c) => (arr ? [resolve(c).items].filter(Boolean) : [c]));
    };
    const paths = new Set([...(lead + text).matchAll(/`((?:tracker|codeHost)(?:\.[A-Za-z]+(?:\[\])?)+)`/g)].map((m) => m[1]!));
    expect(paths.size).toBeGreaterThan(10);
    for (const p of paths) {
      let nodes: any[] = [schema];
      for (const seg of p.split(".")) nodes = step(nodes, seg);
      expect(nodes.length, p).toBeGreaterThan(0);
    }
  });
  it("states the rules", () => {
    for (const s of ["[LiftOff test]", "one ticket at a time", "At most 3", "The 3-attempt cap applies here too", "closed, not deleted", "no merge request is created", "Only one Jira project", "On resume"]) {
      expect(lead.toLowerCase(), s).toContain(s.toLowerCase());
    }
  });
});

describe("assets", () => {
  it("the three default templates exist and hold no secret", () => {
    for (const n of ["task", "story", "bug"]) {
      const t = read("assets", "defaults", `${n}.md`);
      expect(t.length).toBeGreaterThan(10);
      expect(secretGuard({ t })).toEqual([]);
    }
  });
  it("assets/defaults.json equals src/connect/defaults.json", () => {
    expect(JSON.parse(read("assets", "defaults.json"))).toEqual(defaults);
  });
});
