import { describe, expect, it } from "vitest";
import { BEGIN, END, daysBetween, parseBlock, renderBlock, setBlock } from "../../src/brain/lessons-block.js";

const R1 = { key: "api-test-command", rule: "Run the API tests with `make test-api`, not `npm test` at the root.", since: "2026-11-19" };
const R2 = { key: "branch-names", rule: "Name branches feature/<KEY>-<slug>.", since: "2026-11-20" };
const bullet = (r: { key: string; rule: string; since: string }) => `- ${r.rule} <!-- lesson: ${r.key}; since: ${r.since} -->`;
const AGENTS = "# app\n\n## Rules that always apply\n\n- Never commit secrets.\n- Run `sh check.sh` before every commit.\n\n## Modules\n\nsome table\n";

describe("parseBlock", () => {
  it("no markers: not found, no errors", () => expect(parseBlock(AGENTS)).toMatchObject({ found: false, rules: [], errors: [] }));
  it("reads each bullet: key, rule, since", () => {
    const text = `${renderBlock([R1, R2], "agents")}\n`;
    const b = parseBlock(text);
    expect(b.errors).toEqual([]);
    expect(b.rules).toEqual([R1, R2]);
  });
  it.each([
    ["a begin without an end", `${BEGIN}\n${bullet(R1)}\n`],
    ["an end before the begin", `${END}\n${BEGIN}\n`],
    ["two blocks", `${BEGIN}\n${END}\n${BEGIN}\n${END}\n`],
    ["a line that is not a bullet", `${BEGIN}\n- a rule with no comment\n${END}\n`],
    ["a prose line", `${BEGIN}\nsome prose\n${END}\n`],
    ["a rule over 160 characters", `${BEGIN}\n${bullet({ ...R1, rule: "x".repeat(161) })}\n${END}\n`],
    ["the same key twice", `${BEGIN}\n${bullet(R1)}\n${bullet(R1)}\n${END}\n`],
  ])("reports %s", (_n, text) => {
    expect(parseBlock(text).errors.length).toBeGreaterThan(0);
  });
  it("an error carries the 1-based line", () => {
    expect(parseBlock(`x\n${BEGIN}\nnot a bullet\n${END}\n`).errors).toEqual([{ line: 3, message: expect.stringContaining("not '- <rule>") }]);
  });
});

describe("setBlock: where a new block goes", () => {
  it("AGENTS.md: right after the 'Rules that always apply' list, before the next heading; nothing else changes", () => {
    const out = setBlock(AGENTS, [R1], "agents")!;
    expect(out).toBe(`# app\n\n## Rules that always apply\n\n- Never commit secrets.\n- Run \`sh check.sh\` before every commit.\n\n${renderBlock([R1], "agents")}\n\n## Modules\n\nsome table\n`);
    expect(parseBlock(out).rules).toEqual([R1]);
  });
  it("AGENTS.md without that section: at the end", () => {
    const out = setBlock("# app\n\nplain text\n", [R1], "agents")!;
    expect(out).toBe(`# app\n\nplain text\n\n${renderBlock([R1], "agents")}\n`);
  });
  it("constraints: after 'Banned shortcuts', with its own heading", () => {
    const text = "# Constraints\n\n## Banned shortcuts\n\n- no @ts-ignore\n\n## Dimensions\n\n| a | b |\n";
    const out = setBlock(text, [R1], "constraints")!;
    expect(out).toContain("## Banned shortcuts\n\n- no @ts-ignore\n\n## Team lessons (quality bar additions)\n\n<!-- liftoff lessons: begin");
    expect(out.endsWith("## Dimensions\n\n| a | b |\n")).toBe(true);
  });
  it("an existing block is rewritten between its markers only; the text around it is byte-identical", () => {
    const before = `# app\n\nintro\n\n${renderBlock([R1], "agents")}\n\n## After\n\ntail\n`;
    const out = setBlock(before, [R1, R2], "agents")!;
    expect(out).toBe(before.replace(`${bullet(R1)}\n`, `${bullet(R1)}\n${bullet(R2)}\n`));
    const emptied = setBlock(out, [], "agents")!;
    expect(parseBlock(emptied).rules).toEqual([]);
    expect(emptied.startsWith("# app\n\nintro\n")).toBe(true);
    expect(emptied.endsWith("## After\n\ntail\n")).toBe(true);
  });
  it("CRLF files keep CRLF", () => {
    const out = setBlock(AGENTS.replace(/\n/g, "\r\n"), [R1], "agents")!;
    expect(out.includes("\r\n")).toBe(true);
    expect(out.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });
  it("a block that does not parse is never repaired or doubled: setBlock gives up", () => {
    const broken = `# app\n\n${BEGIN}\nstray line\n${END}\n`;
    expect(parseBlock(broken).errors.length).toBeGreaterThan(0);
    expect(setBlock(broken, [R1], "agents")).toBeUndefined();
  });
});

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween("2026-11-19", "2026-11-20")).toBe(1);
    expect(daysBetween("2026-08-21", "2026-11-19")).toBe(90);
  });
});
