import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPoints, readTicket } from "../../src/plan/ticket.js";
import { cli, repo } from "./helpers.js";

// What Jira Data Center and mcp-atlassian hand back for a description that carries a `_TBD_`. The files here are shapes we expect; the
// pilot checklist says to drop the REAL response of `jira_get_issue` next to them as `tbd-real.json`: this test then holds it as a regression.
const DIR = join(import.meta.dirname, "..", "fixtures", "jira-dc");
const FILES = readdirSync(DIR).filter((f) => f.startsWith("tbd-") && f.endsWith(".json")).sort();

describe("a _TBD_ that went through Jira is still found", () => {
  it("there are fixtures", () => expect(FILES.length).toBeGreaterThanOrEqual(4));
  it.each(FILES)("%s: openPoints and the parse-ticket warning", (file) => {
    const text = readFileSync(join(DIR, file), "utf8");
    const t = readTicket(text);
    if ("error" in t) throw new Error(t.error);
    expect(openPoints(t.description).length > 0 || openPoints(t.rendered ?? "").length > 0, file).toBe(true);
    const dir = repo(undefined, { "t.json": text.replace('"key": "PROJ-9"', '"key": "PROJ-1"') });
    const body = cli(["parse-ticket", "--root", dir, "--file", "t.json"]).body;
    expect(body.ok).toBe(true);
    expect(body.warnings.map((w: any) => w.code), file).toContain("tbd-open-points"); // the description first, the rendered HTML if the markup hid it
    expect(body.openPoints.length, file).toBeGreaterThan(0);
  });
  it("the description path warns, with the section it sits in when the headings survived", () => {
    const text = readFileSync(join(DIR, "tbd-wiki.json"), "utf8").replace('"key": "PROJ-9"', '"key": "PROJ-1"');
    const dir = repo(undefined, { "t.json": text });
    const body = cli(["parse-ticket", "--root", dir, "--file", "t.json"]).body;
    expect(body.warnings.map((w: any) => w.code)).toContain("tbd-open-points");
    expect(body.openPoints).toEqual([{ section: "Context", line: "Out of scope: _TBD_" }]);
  });
});
