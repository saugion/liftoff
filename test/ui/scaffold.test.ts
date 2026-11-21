import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refreshRoot } from "../../ui/scaffold.js";
import { tempDir } from "../helpers.js";

const input = { name: "x", purpose: "", constraintsFile: "CONSTRAINTS.md", targets: ["claude-code"], commands: {}, modules: [{ id: "api", path: "api", stack: "Java" }] };
const MARKED = `# AGENTS.md — x

## Modules

<!-- liftoff:modules -->
Single application: no modules.
<!-- /liftoff:modules -->

Before working under a module's path, read that module's \`AGENTS.md\`.

## Commands

<!-- liftoff:commands -->
| Task | Command |
|---|---|
| Build | not configured |
| Test | not configured |
| Lint/format | not configured |
<!-- /liftoff:commands -->

## Rules that always apply

- Our rule.

## Agent files

<!-- liftoff:agents -->
- \`CLAUDE.md\` (Claude Code)
<!-- /liftoff:agents -->
`;

describe("refreshing the root AGENTS.md after the technical lead confirmed the modules", () => {
  it("refreshes the marked blocks and nothing else", () => {
    const dir = tempDir("liftoff-refresh-");
    writeFileSync(join(dir, "AGENTS.md"), MARKED);
    expect(refreshRoot(dir, input)).toBe(true);
    const out = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(out).toContain("| api | `api` | Java |");
    expect(out).toContain("Each module lists its own commands");
    expect(out).not.toContain("Single application");
    expect(out).toContain("- Our rule.");
    expect(out).toContain("Before working under a module's path");
  });
  it("is a no-op when run again, and when the file is the team's own", () => {
    const dir = tempDir("liftoff-refresh-");
    writeFileSync(join(dir, "AGENTS.md"), MARKED);
    refreshRoot(dir, input);
    expect(refreshRoot(dir, input)).toBe(false);
    const own = "# our own\n\nSingle application, hand written: not LiftOff's sentence.\n";
    writeFileSync(join(dir, "AGENTS.md"), own);
    expect(refreshRoot(dir, input)).toBe(false);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe(own);
  });
  it("what is outside the marked blocks is never touched, and a file without markers is left as it is", () => {
    const dir = tempDir("liftoff-refresh-");
    writeFileSync(join(dir, "AGENTS.md"), MARKED.replace("- Our rule.", "- Our rule.\n- Another one, written by hand."));
    refreshRoot(dir, input);
    const out = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(out).toContain("- Another one, written by hand.");
    expect(out).toContain("Before working under a module's path");
    const noMarkers = "# ours\n\nSingle application: no modules.\n";
    writeFileSync(join(dir, "AGENTS.md"), noMarkers);
    expect(refreshRoot(dir, input)).toBe(false);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe(noMarkers);
  });
  it("the list of agent files follows the assistants the lead picked", () => {
    const dir = tempDir("liftoff-refresh-");
    writeFileSync(join(dir, "AGENTS.md"), MARKED);
    refreshRoot(dir, { ...input, targets: ["claude-code", "copilot"] });
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("copilot-instructions.md");
  });
});
