import { describe, expect, it } from "vitest";
import { checkContext, CONTEXT_DEFAULTS, MAX_SKILL_DESCRIPTION, MAX_SKILL_LINES } from "../../src/handbook/context.js";
import { call, put } from "../brain/helpers.js";
import { CONFIG, repo } from "../plan/helpers.js";
import { tempDir } from "../helpers.js";

const FILES = ["CLAUDE.md", "AGENTS.md", "src/api/AGENTS.md", "CONSTRAINTS.md"];
const run = (files: Record<string, string>, settings = {}) => {
  const dir = tempDir();
  for (const [rel, t] of Object.entries(files)) put(dir, rel, t);
  return checkContext({ realRoot: dir, settings: { ...CONTEXT_DEFAULTS, ...settings }, instructionFiles: FILES });
};
const codes = (f: { code: string }[]) => f.map((x) => x.code);
const n = (k: number, line = "- a rule") => Array.from({ length: k }, () => line).join("\n") + "\n";

describe("context hygiene", () => {
  it("a lean repo has nothing to say", () => {
    expect(run({ "AGENTS.md": n(50), "CLAUDE.md": "See AGENTS.md.\n", "CONSTRAINTS.md": n(30) })).toEqual([]);
  });
  it("context-size: more than the limit, per file, in lines", () => {
    const f = run({ "AGENTS.md": n(201), "CONSTRAINTS.md": n(200) });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: "context-size", level: "warning", file: "AGENTS.md" });
    expect(f[0]!.message).toContain("201 lines");
    expect(f[0]!.message).toContain("lines, not tokens");
    expect(f[0]!.message).toContain("context-on-demand");
    expect(codes(run({ "AGENTS.md": n(80) }, { maxInstructionLines: 60 }))).toEqual(["context-size"]);
  });
  it("import-no-saving: an @import that loads in full pushes a file past the limit", () => {
    const f = run({ "AGENTS.md": n(120) + "@docs/rules.md\n", "docs/rules.md": n(150) });
    expect(codes(f)).toEqual(["import-no-saving"]);
    expect(f[0]!.line).toBe(121);
    expect(codes(run({ "AGENTS.md": n(20) + "@docs/rules.md\n", "docs/rules.md": n(150) }))).toEqual([]);
    expect(codes(run({ "AGENTS.md": n(190) + "@docs/small.md\n", "docs/small.md": n(10) }))).toEqual([]);
    expect(codes(run({ "AGENTS.md": n(190) + "@../outside.md\n@/abs.md\n" }))).toEqual([]);
  });
  it("emphasis: words in capitals and shouted lines", () => {
    expect(codes(run({ "AGENTS.md": "IMPORTANT: a\nNEVER b\nALWAYS c\nMUST d\nCRITICAL e\nNEVER f\n" }))).toEqual(["emphasis"]);
    const shout = run({ "AGENTS.md": "# Rules\nDO NOT TOUCH THE PRODUCTION DATABASE UNDER ANY CIRCUMSTANCE\n" });
    expect(shout[0]).toMatchObject({ code: "emphasis", line: 2 });
    expect(codes(run({ "AGENTS.md": "# TITLE IN CAPITALS FOR A SECTION\nNever commit secrets.\n" }))).toEqual([]);
  });
  it("skill-size and skill-model: the repo's own skills and a plugin folder", () => {
    const skill = (fm: string, body: string) => `---\nname: x\n${fm}---\n${body}`;
    const f = run({
      ".claude/skills/big/SKILL.md": skill("description: ok\n", n(MAX_SKILL_LINES + 1)),
      ".claude/skills/long/SKILL.md": skill(`description: ${"d".repeat(MAX_SKILL_DESCRIPTION + 1)}\n`, "x\n"),
      "plugin/skills/model/SKILL.md": skill("description: ok\nmodel: haiku\n", "x\n"),
      "plugin/skills/fine/SKILL.md": skill("description: ok\n", n(MAX_SKILL_LINES)),
    });
    expect(f.map((x) => `${x.code}:${x.file}`).sort()).toEqual(["skill-model:plugin/skills/model/SKILL.md", "skill-size:.claude/skills/big/SKILL.md", "skill-size:.claude/skills/long/SKILL.md"]);
    expect(f.find((x) => x.code === "skill-model")!.message).toContain("session-hygiene");
  });
  it("hook-count and mcp-count", () => {
    const hooks = (k: number) => JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: Array.from({ length: k }, () => ({ type: "command", command: "x" })) }], Stop: [{ hooks: [{ type: "command", command: "y" }] }] } });
    expect(codes(run({ ".claude/settings.json": hooks(40) }))).toEqual(["hook-count"]);
    expect(codes(run({ ".claude/settings.json": hooks(39) }))).toEqual([]);
    const servers = (k: number) => Object.fromEntries(Array.from({ length: k }, (_, i) => [`s${i}`, { command: "x" }]));
    const f = run({ ".mcp.json": JSON.stringify({ mcpServers: servers(6) }), ".vscode/mcp.json": JSON.stringify({ servers: servers(5) }) });
    expect(f.map((x) => `${x.code}:${x.file}`)).toEqual(["mcp-count:.mcp.json"]);
    expect(f[0]!.message).toContain("lean-output");
    expect(codes(run({ ".mcp.json": "{ broken", ".claude/settings.json": "nope" }))).toEqual([]);
  });
  it("skip drops a code; nothing here is ever an error", () => {
    expect(run({ "AGENTS.md": n(300) }, { skip: ["context-size"] })).toEqual([]);
    for (const x of run({ "AGENTS.md": n(300), "CONSTRAINTS.md": "NEVER\n".repeat(10) })) expect(x.level).toBe("warning");
  });
  it("this repository holds itself to the limits it recommends: every shipped skill is within them", () => {
    const f = checkContext({ realRoot: process.cwd(), settings: CONTEXT_DEFAULTS, instructionFiles: [] });
    expect(f.filter((x) => x.code.startsWith("skill-")), JSON.stringify(f)).toEqual([]);
  });
});

describe("brain-check runs them with the handbook", () => {
  const cfg = (ctx: string) => CONFIG.replace('version: "0.2"', 'version: "0.5"') + `brain:\n  handbook: { ${ctx} }\n`;
  const setup = (ctx: string) => {
    const dir = repo(cfg(ctx), { "AGENTS.md": n(250) });
    call(dir, "brain-init", "--write");
    call(dir, "handbook-init", "--write");
    return dir;
  };
  it("by default; a limit raises the bar; false and skip turn them off", () => {
    expect(codes(call(setup(""), "brain-check").body.warnings)).toContain("context-size");
    expect(codes(call(setup("context: { maxInstructionLines: 300 }"), "brain-check").body.warnings)).not.toContain("context-size");
    expect(codes(call(setup("context: false"), "brain-check").body.warnings)).not.toContain("context-size");
    expect(codes(call(setup("context: { skip: [context-size] }"), "brain-check").body.warnings)).not.toContain("context-size");
  });
  it("without a handbook the health check is untouched", () => {
    const dir = repo(CONFIG.replace('version: "0.2"', 'version: "0.5"') + "brain: {}\n", { "AGENTS.md": n(250) });
    call(dir, "brain-init", "--write");
    expect(codes(call(dir, "brain-check").body.warnings)).not.toContain("context-size");
  });
});
