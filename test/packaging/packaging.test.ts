import { copyFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { buildBundle, marketplaceEntry } from "../../scripts/build.mjs";
import { INSTALLED_VERSION } from "../../src/cli/version.js";
import { tempDir } from "../helpers.js";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const readJson = (...p: string[]) => JSON.parse(read(...p)) as Record<string, any>;
const PLUGIN = join(ROOT, "plugin");
const SKILL = join(PLUGIN, "skills", "liftoff-init");
const ARTIFACT = join(SKILL, "scripts", "liftoff.mjs");

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

describe("one version number", () => {
  const pkg = readJson("package.json");
  const plugin = readJson("plugin", ".claude-plugin", "plugin.json");
  const fragment = readJson("plugin", "skills", "liftoff-init", "assets", "marketplace-entry.json");

  it("package.json = plugin.json = the CLI's installedVersion = the fragment's ref (without the v)", () => {
    expect(plugin.version).toBe(pkg.version);
    expect(INSTALLED_VERSION).toBe(pkg.version);
    expect(fragment.extraKnownMarketplaces.liftoff.source.ref).toBe(`v${pkg.version}`);
  });

  it("the marketplace entry has no version of its own (plugin.json wins anyway: one place, no drift)", () => {
    const entry = readJson(".claude-plugin", "marketplace.json").plugins[0];
    expect(entry.version).toBeUndefined();
  });

  it("the version is plain x.y.z (liftoff.yaml pins x.y)", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("the committed artifact", () => {
  it("equals a fresh build, byte for byte (the release must never ship a stale artifact)", async () => {
    const fresh = join(tempDir("liftoff-fresh-"), "liftoff.mjs");
    await buildBundle(fresh); // built from the repo root: the path comments inside the bundle are relative to it
    expect(readFileSync(ARTIFACT, "utf8") === readFileSync(fresh, "utf8")).toBe(true);
  });

  it("is LF only and starts with the shebang", () => {
    const text = readFileSync(ARTIFACT, "utf8");
    expect(text.includes("\r")).toBe(false);
    expect(text.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("runs alone: copied to a directory with no node_modules it reports the plugin version", () => {
    const alone = join(tempDir("liftoff-alone-"), "liftoff.mjs");
    copyFileSync(ARTIFACT, alone);
    const r = spawnSync(process.execPath, [alone, "check-config", "--root", tempDir()], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toMatchObject({ status: "blocked", installedVersion: readJson("plugin", ".claude-plugin", "plugin.json").version });
  });

  it("also runs from where the skill finds it", () => {
    const r = spawnSync(process.execPath, [ARTIFACT, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).usage).toContain("liftoff");
  });
});

describe("manifests", () => {
  const marketplace = readJson(".claude-plugin", "marketplace.json");
  const plugin = readJson("plugin", ".claude-plugin", "plugin.json");

  it("marketplace.json has the required fields", () => {
    expect(marketplace.name).toBe("liftoff");
    expect(marketplace.owner.name).toBeTypeOf("string");
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0]).toMatchObject({ name: "liftoff", source: "./plugin" });
  });

  it('the plugin source "./plugin" resolves to a directory with its manifest', () => {
    const dir = join(ROOT, marketplace.plugins[0].source);
    expect(statSync(dir).isDirectory()).toBe(true);
    expect(existsSync(join(dir, ".claude-plugin", "plugin.json"))).toBe(true);
  });

  it("plugin.json: the name matches the marketplace entry, Apache-2.0, repository set", () => {
    expect(plugin.name).toBe(marketplace.plugins[0].name);
    expect(plugin.license).toBe("Apache-2.0");
    expect(plugin.repository).toBe("https://github.com/saugion/liftoff");
    expect(plugin.description).toBeTypeOf("string");
  });

  it("the settings key liftoff@liftoff is plugin@marketplace", () => {
    const fragment = readJson("plugin", "skills", "liftoff-init", "assets", "marketplace-entry.json");
    expect(Object.keys(fragment.enabledPlugins)).toEqual([`${plugin.name}@${marketplace.name}`]);
    expect(Object.keys(fragment.extraKnownMarketplaces)).toEqual([marketplace.name]);
  });

  it(".gitattributes keeps the plugin LF on every OS", () => {
    expect(read(".gitattributes")).toMatch(/^plugin\/\*\* text eol=lf$/m);
  });
});

describe("the settings fragment", () => {
  it("is exactly what the spec says, with the ref set from the version", () => {
    const fragment = readJson("plugin", "skills", "liftoff-init", "assets", "marketplace-entry.json");
    expect(fragment).toEqual({
      extraKnownMarketplaces: { liftoff: { source: { source: "github", repo: "saugion/liftoff", ref: `v${INSTALLED_VERSION}` } } },
      enabledPlugins: { "liftoff@liftoff": true },
    });
    expect(fragment).toEqual(marketplaceEntry(INSTALLED_VERSION));
  });

  it("is formatted as JSON with 2 spaces and a final newline (what the skill copies)", () => {
    const text = read("plugin", "skills", "liftoff-init", "assets", "marketplace-entry.json");
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2) + "\n");
  });
});

describe("plugin/ is small and clean", () => {
  const files = walk(PLUGIN).map((f) => relative(PLUGIN, f).split("\\").join("/"));

  it("holds no source, tests, node_modules, package.json or lockfile (Claude Code would run an install on a package.json)", () => {
    for (const f of files) expect(f, f).not.toMatch(/(^|\/)(src|test|tests|node_modules)\//);
    expect(files.filter((f) => /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig\.json)$/.test(f))).toEqual([]);
  });

  it("is under 1 MB", () => {
    const bytes = walk(PLUGIN).reduce((sum, f) => sum + statSync(f).size, 0);
    expect(bytes).toBeLessThan(1024 * 1024);
  });

  it("carries the license and the third-party notices of what the bundle contains", () => {
    expect(files).toContain("LICENSE");
    expect(read("plugin", "LICENSE")).toBe(read("LICENSE"));
    const notices = read("plugin", "THIRD_PARTY_NOTICES");
    for (const dep of ["yaml", "ajv", "fast-deep-equal", "fast-uri", "json-schema-traverse"]) expect(notices, dep).toMatch(new RegExp(`^## ${dep}@`, "m"));
  });

  it("is exactly the expected set of files", () => {
    expect(files.sort()).toEqual([
      ".claude-plugin/plugin.json",
      "LICENSE",
      "THIRD_PARTY_NOTICES",
      "skills/liftoff-init/SKILL.md",
      "skills/liftoff-init/assets/agents-md-template.md",
      "skills/liftoff-init/assets/constraints-template.md",
      "skills/liftoff-init/assets/liftoff-yaml-template.yaml",
      "skills/liftoff-init/assets/marketplace-entry.json",
      "skills/liftoff-init/assets/module-agents-md-template.md",
      "skills/liftoff-init/references/stack-commands.md",
      "skills/liftoff-init/scripts/liftoff.mjs",
    ]);
  });

  it("has no hooks and no MCP servers: the plugin runs code only when a user invokes the skill", () => {
    const plugin = readJson("plugin", ".claude-plugin", "plugin.json");
    expect(plugin.hooks).toBeUndefined();
    expect(plugin.mcpServers).toBeUndefined();
    expect(files.filter((f) => /^(hooks|\.mcp\.json|agents|commands)(\/|$)/.test(f))).toEqual([]);
  });
});

describe("the skill is loadable", () => {
  const text = read("plugin", "skills", "liftoff-init", "SKILL.md");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  const front = parse(match![1]!) as Record<string, any>;
  const body = match![2]!;

  it("has YAML frontmatter followed by a body", () => {
    expect(match).not.toBeNull();
    expect(body.length).toBeGreaterThan(1000);
  });

  it("name is kebab-case and equals its directory (a mismatch makes VS Code skip the skill silently)", () => {
    expect(front.name).toBe("liftoff-init");
    expect(front.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(front.name).toBe("liftoff-init");
    expect(readdirSync(join(PLUGIN, "skills"))).toEqual([front.name]);
  });

  it("has a description that says when to use it, and the license", () => {
    expect(front.description).toMatch(/liftoff init|init project/i);
    expect(front.license).toBe("Apache-2.0");
  });

  it("allowed-tools is the exact quoted rule that matches the command form the body tells the agent to run", () => {
    const rule = 'Bash(node "${CLAUDE_SKILL_DIR}/scripts/liftoff.mjs" *)';
    expect(front["allowed-tools"]).toBe(rule);
    // Rules match the literal command text: the body must show the same prefix, quotes included.
    expect(body).toContain('node "${CLAUDE_SKILL_DIR}/scripts/liftoff.mjs" <command> --root "<abs path>"');
  });

  it("has the fallback for hosts that do not substitute ${CLAUDE_SKILL_DIR} (VS Code passes it through)", () => {
    expect(body).toMatch(/still contains `\$\{`/);
    expect(body).toMatch(/directory this SKILL\.md was loaded from/);
  });

  it("every file the skill refers to exists", () => {
    const referenced = [...body.matchAll(/`((?:assets|references|scripts)\/[A-Za-z0-9_.-]+)`/g)].map((m) => m[1]!);
    expect(referenced.length).toBeGreaterThan(4);
    for (const rel of new Set(referenced)) expect(existsSync(join(SKILL, rel)), rel).toBe(true);
  });

  it("names the three CLI commands and the plugin-recommendation settings file", () => {
    for (const c of ["validate", "check-config", "render"]) expect(body).toContain(c);
    expect(body).toContain(".claude/settings.json");
    expect(body).toContain("marketplace-entry.json");
  });
});

describe("the skill speaks the CLI's contract (drift check)", () => {
  const body = read("plugin", "skills", "liftoff-init", "SKILL.md");
  // The unions are read from the CLI source, so adding a code without teaching the skill fails here.
  const union = (file: string, name: string): string[] => {
    const m = new RegExp(`export type ${name} =([^;]+);`).exec(read("src", "cli", file));
    if (!m) throw new Error(`${name} not found in ${file}`);
    return [...m[1]!.matchAll(/"([a-z-]+)"/g)].map((x) => x[1]!);
  };

  it.each([
    ["error codes", union("types.ts", "ErrorCode")],
    ["check-config reasons", union("check.ts", "ReasonCode")],
    ["render actions", union("apply.ts", "Action")],
    ["conflict reasons", union("apply.ts", "ConflictReason")],
  ])("every one of the CLI's %s appears in the skill", (_what, names) => {
    expect(names.length).toBeGreaterThan(3);
    for (const name of names) expect(body, name).toContain(`\`${name}\``);
  });

  it("every code the skill backticks as a code is a real one", () => {
    const real = new Set([...union("types.ts", "ErrorCode"), ...union("check.ts", "ReasonCode"), ...union("apply.ts", "Action"), ...union("apply.ts", "ConflictReason")]);
    // tokens written as `kebab-case` that look like CLI vocabulary but are not in any union
    const candidates = new Set([...body.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)].map((m) => m[1]!));
    const notCodes = new Set(["check-config", "no-marker", "claude-code"]); // command name, agent name; no-marker is real (in the union)
    const stray = [...candidates].filter((c) => !real.has(c) && !notCodes.has(c));
    // Allowed: names of things that are not codes (paths, flags, host tools).
    expect(stray.filter((c) => /^(config|plugin|render|agents|path|write|not|required|optional|unresolved|newer|hand|skipped)-/.test(c))).toEqual([]);
  });
});
