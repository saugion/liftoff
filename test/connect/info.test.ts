import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import { INSTALLED_VERSION } from "../../src/cli/version.js";
import { MIN_JIRA_SERVER_VERSION, compareVersions, parseConfig } from "../../src/config/index.js";
import defaults from "../../src/connect/defaults.json" with { type: "json" };
import { buildInfo } from "../../src/connect/info.js";
import { launcher } from "../../src/connect/launcher.js";
import { JIRA_TOOLS, TOOLSETS, toolsetOf } from "../../src/connect/tools.js";
import { tempDir } from "../helpers.js";

const DIR = join(import.meta.dirname, "..", "fixtures", "connect");
const cases = readdirSync(DIR).sort();
const info = (name: string) => {
  const r = parseConfig(readFileSync(join(DIR, name, "liftoff.yaml"), "utf8"));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return buildInfo(r.value, "0.0.0-test");
};

describe("connect-info golden", () => {
  if (process.env.UPDATE_GOLDEN) for (const c of cases) writeFileSync(join(DIR, c, "expected.json"), JSON.stringify(info(c), null, 2) + "\n");
  it.each(cases)("%s", (c) => {
    expect(info(c)).toEqual(JSON.parse(readFileSync(join(DIR, c, "expected.json"), "utf8")));
    expect(JSON.stringify(info(c))).toBe(JSON.stringify(info(c))); // byte-stable
  });

  it("shapes: nulls without a connector, one MCP entry per agent sorted, prerequisites only for what is configured", () => {
    expect(info("neither")).toMatchObject({ tracker: null, codeHost: null, mcp: [], credential: null, gitlab: null, prerequisites: [] });
    expect(info("jira-only").prerequisites.map((p) => p.id)).toEqual(["uv"]);
    expect(info("gitlab-only")).toMatchObject({ mcp: [], credential: null });
    expect(info("gitlab-only").prerequisites.map((p) => p.id)).toEqual(["glab"]);
    expect(info("both").mcp.map((m) => m.agent)).toEqual(["claude-code", "copilot"]);
    expect(info("claude-only").mcp.map((m) => m.file)).toEqual([".mcp.json"]);
    expect(info("copilot-only").mcp.map((m) => [m.file, m.serversKey, (m.entry as any).type])).toEqual([[".vscode/mcp.json", "servers", "stdio"]]);
  });

  it("the keychain service is built from the lowercased host and port, without the path", () => {
    expect(info("port-path").credential!.keychain.service).toBe("liftoff-jira@jira.company.local:8443");
    expect(info("port-path").gitlab!.login).toContain("'gitlab.company.local:8443'");
  });
});

describe("no secret, no expansion", () => {
  const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
  it.each(["jira-only", "both", "port-path"])("%s: no ${ and no $LIFTOFF in an entry, and env holds no token variable", (c) => {
    for (const m of info(c).mcp) {
      for (const s of strings(m.entry)) {
        expect(s).not.toContain("${");
        expect(s).not.toContain("$LIFTOFF");
      }
      expect(Object.keys(m.entry.env).some((k) => /TOKEN|PASSWORD|SECRET/i.test(k))).toBe(false);
    }
  });
  it("the launcher equals an exact golden string and ends with --env-file /dev/null", () => {
    const l = (info("jira-only").mcp[0]!.entry as any).args[1] as string;
    expect(l).toBe(
      [
        `command -v uvx >/dev/null || { echo "liftoff: uvx not found (brew install uv)" >&2; exit 1; }`,
        `T="$(printenv LIFTOFF_JIRA_TOKEN)"`,
        `[ -n "$T" ] || T="$(security find-generic-password -a "$(id -un)" -s 'liftoff-jira@jira.company.local' -w 2>/dev/null)"`,
        `[ -n "$T" ] || { echo "liftoff: no Jira token found (or the keychain is locked); run the LiftOff Connect skill" >&2; exit 1; }`,
        `JIRA_PERSONAL_TOKEN="$T" exec uvx mcp-atlassian@0.23.1 --env-file /dev/null`,
      ].join("; "),
    );
  });
});

describe("allowlist and version", () => {
  it("ENABLED_TOOLS is JIRA_TOOLS, TOOLSETS the toolsets of those tools", () => {
    const env = info("jira-only").mcp[0]!.entry.env;
    expect(env.ENABLED_TOOLS).toBe(JIRA_TOOLS.join(","));
    expect(env.TOOLSETS.split(",")).toEqual([...new Set(JIRA_TOOLS.map(toolsetOf))]);
    expect(TOOLSETS.length).toBeGreaterThan(0);
  });
  it("JIRA_TOOLS: snake case jira_ names, nothing destructive", () => {
    expect(JIRA_TOOLS).toHaveLength(12);
    for (const t of JIRA_TOOLS) expect(t).toMatch(/^jira_[a-z]+(_[a-z]+)*$/);
    expect(JIRA_TOOLS.filter((t) => /delete|move|assign|batch|link|worklog|attach/.test(t))).toEqual([]);
  });
  it("the default pin is at least the minimum, and is what the launcher uses by default", () => {
    expect(compareVersions(defaults.jiraServerVersion, MIN_JIRA_SERVER_VERSION)).toBeGreaterThanOrEqual(0);
  });
});

describe("the command", () => {
  const go = (dir: string, extra: string[] = []) => {
    const r = run(["connect-info", "--root", dir, ...extra], "/");
    return { exitCode: r.exitCode, body: JSON.parse(r.stdout) as Record<string, any> };
  };
  const repo = (text: string) => {
    const dir = tempDir();
    writeFileSync(join(dir, "liftoff.yaml"), text);
    return dir;
  };
  const text = (c: string) => readFileSync(join(DIR, c, "liftoff.yaml"), "utf8");

  it("ok: the document is buildInfo with the root and the installed version", () => {
    const dir = repo(text("both"));
    const { exitCode, body } = go(dir);
    expect(exitCode).toBe(0);
    expect(body).toMatchObject({ ok: true, root: dir, installedVersion: INSTALLED_VERSION });
    expect(body.mcp).toHaveLength(2);
  });
  it("missing config, invalid config, outdated plugin: fatal shape, exit 1, coded", () => {
    expect(go(tempDir())).toMatchObject({ exitCode: 1, body: { ok: false, errors: [{ code: "config-missing" }] } });
    expect(go(repo("liftoff: 1\n")).body.errors[0].code).toBe("config-invalid");
    expect(go(repo(text("both").replace('"0.2"', '"9.0"')))).toMatchObject({ exitCode: 1, body: { errors: [{ code: "plugin-outdated" }] } });
  });
  it("writes nothing", () => {
    const dir = repo(text("both"));
    go(dir);
    expect(readdirSync(dir)).toEqual(["liftoff.yaml"]);
  });
  it("--overwrite and unknown flags are usage errors (exit 2)", () => {
    expect(go(repo(text("both")), ["--overwrite", "x"]).exitCode).toBe(2);
    expect(go(repo(text("both")), ["--nope"]).exitCode).toBe(2);
  });
});

describe("hostile values forced into the config object (bypassing the schema)", () => {
  it("every dynamic part is single-quoted, so the command runs as one inert argument", () => {
    const r = parseConfig(readFileSync(join(DIR, "both", "liftoff.yaml"), "utf8"));
    if (!r.ok) throw new Error();
    const evil = "x'; touch /tmp/pwned; echo '";
    const cfg: any = structuredClone(r.value);
    cfg.tracker.url = `https://${evil}`;
    cfg.codeHost.host = evil;
    const out = buildInfo(cfg, "0");
    expect(out.gitlab!.login).toBe(`glab auth login --hostname 'x'\\''; touch /tmp/pwned; echo '\\'''`);
    expect(out.credential!.keychain.add).toContain(`'liftoff-jira@x'\\''; touch`);
    expect(launcher(cfg.tracker)).toContain(`-s 'liftoff-jira@x'\\''; touch`);
  });
});
