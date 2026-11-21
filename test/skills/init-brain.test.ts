import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handlers } from "../../src/cli/main.js";
import { proposals } from "../../src/brain/scaffold.js";
import { brainPaths } from "../../src/brain/paths.js";

const body = readFileSync(join(import.meta.dirname, "..", "..", "plugin", "skills", "liftoff-init", "SKILL.md"), "utf8");
const flat = body.replace(/\s+/g, " ");
const step = (from: string, to: string) => body.slice(body.indexOf(from), body.indexOf(to));

describe("Init and the brain", () => {
  const six = step("## 6b.", "## 7.");
  const sixFlat = six.replace(/\s+/g, " ");

  it("step 6b is gated on `brain` and never asks or writes the section", () => {
    expect(sixFlat).toContain("only when `liftoff.yaml` has a `brain` section");
    expect(sixFlat).toContain("skip this whole step");
    expect(sixFlat).toContain("Init never asks about the brain and never writes the `brain` section");
  });
  it("names brain-init and --write, and every proposals key", () => {
    expect(sixFlat).toContain("`brain-init` without `--write`");
    expect(sixFlat).toContain("`brain-init --write`");
    const keys = Object.keys(proposals(["claude-code", "copilot"], brainPaths("brain")));
    expect(keys.sort()).toEqual(["agentsMd", "claudeSettings", "gitattributes", "vscodeSettings"]);
    for (const k of keys) expect(six, k).toContain(`\`${k}\``);
    expect(proposals(["claude-code"], brainPaths("brain")).agentsMd.split("\n")[0]).toBe("## Project brain");
  });
  it("the proposals are the lead's: Init never edits a shared brain file, it says what to tell the lead", () => {
    for (const s of ["The `proposals` are the lead's, not yours", "Init **never edits them**, so a teammate is never asked a team question", "if it is already there, say nothing", "do not add it and put one line in the summary: \"tell the lead:", "A lead who wants them now runs the Brain skill (Setup, step 3)"]) expect(sixFlat, s).toContain(s);
    for (const s of ["the agents are not told the wiki exists", "nothing stops an edit of a raw source", "VS Code only asks for approval on `raw/` edits and cannot block them", "can conflict"]) expect(sixFlat, s).toContain(s);
    expect(sixFlat).not.toMatch(/apply it only on its own yes/);
  });
  it("step 10 checks the git-ignore state and runs brain-check, only when brain is set", () => {
    const ten = step("## 10.", "## Apply mode").replace(/\s+/g, " ");
    for (const s of ["Only when `brain` is set", "`git check-ignore`", "is **not** ignored", "`.liftoff/brain/hot.md` **is**", "`brain-check`", "never committed", "every \"tell the lead\" line from step 6b"]) expect(ten, s).toContain(s);
  });
  it("apply mode creates the brain structure, still without questions", () => {
    expect(flat).toContain("create the brain structure when `brain` is set (step 6b)");
    expect(flat).toContain("No questions");
  });
  it("every brain command it names exists", () => {
    for (const c of new Set([...body.matchAll(/`(brain-[a-z]+)\b/g)].map((m) => m[1]!))) expect(Object.keys(handlers), c).toContain(c);
  });
  it("Init no longer interviews: it starts the setup guide, and writes none of the project files itself in that mode", () => {
    const section = step("## 2. Guided setup", "## 6. AGENTS.md files");
    for (const x of ["bin/liftoff-ui.mjs", "Open: <address>", "Do not ask the\n   project questions yourself", "do not write `liftoff.yaml`, `AGENTS.md` or `CONSTRAINTS.md` in this mode"].map((t) => t.replace(/\s+/g, " "))) expect(section.replace(/\s+/g, " "), x).toContain(x);
    expect(section).not.toMatch(/AskUserQuestion|multi-select/);
    expect(flat).not.toContain("Interview mode");
  });
});
