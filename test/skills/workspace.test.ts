import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const skill = readFileSync(join(__dirname, "..", "..", "plugin", "skills", "liftoff-init", "SKILL.md"), "utf8").replace(/\s+/g, " ");

describe("Init and a repository left out", () => {
  it("creates no module file inside it", () => {
    expect(skill).toContain("A module inside a repository listed in `workspace.exclude` gets no file");
  });
});
