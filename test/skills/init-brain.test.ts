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
  it("the interview is still at most four questions, word for word", () => {
    const section = step("### 3. Interview", "### 4. Layout");
    const list = section.slice(0, section.indexOf("Do **not** ask about"));
    const items = [...list.matchAll(/^\d\. /gm)];
    expect(items).toHaveLength(4);
    expect(list).toContain("1. Project name and a one-line purpose.");
    expect(list).toContain("2. Modules, the stack per module, and (for a `new` project only) the layout");
    expect(list).toContain("3. Agents to target, multi-select: `claude-code`, `copilot`.");
    expect(list).toContain("4. **Git in the Build skill**");
    expect(list).not.toMatch(/brain/i);
    expect(section).toContain("the project brain (a lead turns it on with the Brain skill; here it only follows the config)");
  });
});
