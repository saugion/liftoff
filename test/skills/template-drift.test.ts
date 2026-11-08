import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config/index.js";

const SKILL = join(import.meta.dirname, "..", "..", "plugin", "skills", "liftoff-init");
const asset = (name: string) => readFileSync(join(SKILL, "assets", name), "utf8");

const fill = (template: string, values: Record<string, string>) => template.replace(/\{\{([A-Z_]+)\}\}/g, (_m, key: string) => values[key] ?? `<<MISSING ${key}>>`);

// What the skill substitutes into liftoff-yaml-template.yaml (the placeholder table in the Init skill, step 5).
const SAMPLE = {
  INSTALLED_VERSION: "0.3.0",
  PLUGIN_MIN_VERSION: "0.3",
  PROJECT_NAME: "acme-billing",
  PROJECT_KIND: "new",
  AGENT_TARGETS: "claude-code, copilot",
  LANGUAGES: "typescript",
  FRAMEWORKS: "nestjs",
  MODULE_ITEMS: "\n    - id: api\n      path: src/api\n      description: HTTP layer\n    - id: web\n      path: apps/web",
  CONSTRAINTS_FILE: "CONSTRAINTS.md",
  BUILD_GIT: "manual",
};

describe("liftoff-yaml-template.yaml cannot drift from the schema", () => {
  const template = asset("liftoff-yaml-template.yaml");

  it("filled with sample values it is a valid config", () => {
    const text = fill(template, SAMPLE);
    expect(text).not.toContain("<<MISSING");
    const r = parseConfig(text);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.ok && r.value).toMatchObject({
      plugin: { version: "0.3" },
      project: { name: "acme-billing", kind: "new" },
      agents: { targets: ["claude-code", "copilot"] },
      stack: { languages: ["typescript"], frameworks: ["nestjs"] },
      modules: { items: [{ id: "api", path: "src/api", description: "HTTP layer" }, { id: "web", path: "apps/web" }] },
      constraints: { required: true, file: "CONSTRAINTS.md" },
      build: { git: "manual", required: true },
    });
  });

  it("a single-app repo: modules.items is [], no module", () => {
    const r = parseConfig(fill(template, { ...SAMPLE, MODULE_ITEMS: "[]" }));
    expect(r.ok && r.value.modules).toEqual({ items: [], required: false });
  });

  it("unknown stack: empty lists are fine", () => {
    const r = parseConfig(fill(template, { ...SAMPLE, LANGUAGES: "", FRAMEWORKS: "" }));
    expect(r.ok && r.value.stack).toMatchObject({ languages: [], frameworks: [] });
  });

  it("the other agent combinations and the existing kind", () => {
    for (const targets of ["claude-code", "copilot", "copilot, claude-code"]) {
      expect(parseConfig(fill(template, { ...SAMPLE, AGENT_TARGETS: targets, PROJECT_KIND: "existing" })).ok, targets).toBe(true);
    }
  });

  it("starts with the schema modeline at the release tag, then says never to put credentials in the file", () => {
    const lines = fill(template, SAMPLE).split("\n");
    expect(lines[0]).toBe("# yaml-language-server: $schema=https://raw.githubusercontent.com/saugion/liftoff/v0.3.0/schema/liftoff.schema.json");
    expect(lines[1]).toMatch(/Never put credentials/);
  });

  it("every placeholder is one the skill is told to fill (the sample covers them all)", () => {
    const used = [...template.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]);
    expect(used.filter((k) => !(k! in SAMPLE))).toEqual([]);
  });
});

describe("the AGENTS.md templates", () => {
  const root = asset("agents-md-template.md");
  const module = asset("module-agents-md-template.md");

  // Features deferred past v1, or tools that not every agent has, must not leak back in.
  const FORBIDDEN = ["Owner:", ".claude/agents", "/implement", ".scratch", "context7", "Do not load nested"];

  it.each(FORBIDDEN)("neither template contains %j", (text) => {
    expect(root).not.toContain(text);
    expect(module).not.toContain(text);
  });

  it("the root template has the section VS Code Copilot depends on, and the read-the-module-first line", () => {
    expect(root).toContain("## Rules that always apply");
    expect(root).toMatch(/Before working under a module's path, read that module's `AGENTS\.md`/);
  });

  it("the root template has no Agents table", () => {
    expect(root).not.toMatch(/^## Agents$/m);
  });

  it("the root template points to the constraints file and says the per-agent files only point to it", () => {
    expect(root).toContain("{{CONSTRAINTS_FILE}}");
    expect(root).toMatch(/only point to this one/);
  });

  it("the module template sends global rules to the root file", () => {
    expect(module).toContain("{{REL_PATH_TO_ROOT}}AGENTS.md");
    expect(module).toMatch(/Rules that always apply/);
  });
});

describe("the constraints template and the references", () => {
  it("the constraints template has the quality bar and the banned shortcuts, and no deferred-agent wording", () => {
    const c = asset("constraints-template.md");
    expect(c).toContain("## Banned shortcuts");
    expect(c).toContain("Lowering a threshold in this file");
    expect(c).not.toMatch(/reviewer agent|\.claude\/|subagent/i);
  });

  it("stack-commands.md is the project-init table without its Claude settings allowlist", () => {
    const s = readFileSync(join(SKILL, "references", "stack-commands.md"), "utf8");
    expect(s).toMatch(/\| `package\.json` \+ pnpm-lock \|/);
    expect(s).not.toMatch(/settings allowlist/);
    const rows = s.split("\n").filter((l) => l.startsWith("| `"));
    for (const row of rows) expect(row.split("|").length, row).toBe(7); // 5 columns: a "|" inside a cell breaks the table
  });

  it("all the skill's assets exist and nothing else crept in", () => {
    expect(readdirSync(join(SKILL, "assets")).sort()).toEqual([
      "agents-md-template.md",
      "constraints-template.md",
      "liftoff-yaml-template.yaml",
      "marketplace-entry.json", // generated by the build
      "module-agents-md-template.md",
    ]);
    expect(readdirSync(join(SKILL, "references"))).toEqual(["stack-commands.md"]);
  });
});

describe("the Init skill covers what the first real-agent run had to guess", () => {
  const body = readFileSync(join(SKILL, "SKILL.md"), "utf8").replace(/\s+/g, " ");
  it.each(["is not one of its four", "columns Module, Path, Stack, Description", "must install it by hand", "each tagged with its module", "when the stack has one that is not set up yet"])("says: %s", (x) => {
    expect(body).toContain(x);
  });
});
