import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_REVISIONS, buildCatalog, fingerprint as jsFingerprint, shippedText, splitPage } from "../../scripts/build-catalog.mjs";
import { CATALOG, catalogPage, latest, revisionOf } from "../../src/handbook/catalog.js";
import { MAX_PAGE_LINES, fingerprint, parseHandbookPage } from "../../src/handbook/page.js";
import { handbookPaths } from "../../src/handbook/paths.js";
import { buildHandbookIndex } from "../../src/handbook/index.js";
import { parseRetired, retiredLine } from "../../src/handbook/retired.js";
import { statusOf } from "../../src/handbook/status.js";
import { tempDir } from "../helpers.js";
import { mkdirSync, writeFileSync } from "node:fs";

const ROOT = join(import.meta.dirname, "..", "..");
const VERSION = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;

describe("the shipped catalog", () => {
  it("is exactly what the build generates from src/handbook/base (a stale catalog is a stale release)", () => {
    expect(buildCatalog({ cwd: ROOT, version: VERSION, write: false }).changed).toBe(false);
  });
  it("ships 11 practices and 2 convention stubs, one file each, every id a kebab-case name", () => {
    const ids = readdirSync(join(ROOT, "src/handbook/base")).map((n) => n.slice(0, -3)).sort();
    expect(CATALOG.map((p) => p.id).sort()).toEqual(ids);
    expect(CATALOG.filter((p) => p.type === "practice")).toHaveLength(11);
    expect(CATALOG.filter((p) => p.type === "convention").map((p) => p.id).sort()).toEqual(["how-we-review", "how-we-test"]);
    for (const p of CATALOG) expect(p.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });
  it.each(CATALOG.flatMap((p) => p.revisions.map((r) => [`${p.id} r${r.rev}`, p, r] as const)))("%s: parses, is under the size limit, and carries the fingerprint of its own text", (_n, p, r) => {
    const page = parseHandbookPage(r.text);
    expect(page, JSON.stringify(page)).toMatchObject({ ok: true });
    if (!page.ok) return;
    expect(page.lines).toBeLessThanOrEqual(MAX_PAGE_LINES);
    expect(page.front.origin).toMatch(/^liftoff@\d+\.\d+$/);
    expect(page.front.base).toBe(r.base);
    expect(fingerprint(page.front, page.body)).toBe(r.base);
    expect(page.front.type).toBe(p.type);
    expect((page.front.status === "stub")).toBe(p.status === "stub");
  });
  it("the build script's fingerprint is the CLI's", () => {
    for (const p of CATALOG) {
      const { front, body } = splitPage(readFileSync(join(ROOT, "src/handbook/base", `${p.id}.md`), "utf8"));
      expect(jsFingerprint(front, body)).toBe(fingerprint(front as never, body));
      expect(jsFingerprint(front, body)).toBe(latest(p).base);
    }
  });
  it("every revision is within the retention limit and numbered in order", () => {
    for (const p of CATALOG) {
      expect(p.revisions.length).toBeLessThanOrEqual(MAX_REVISIONS);
      expect(p.revisions.map((r) => r.rev)).toEqual([...p.revisions].map((r) => r.rev).sort((a, b) => a - b));
    }
  });
  it("practices have the four sections; stubs have `_TBD_` questions and say they are not filled in", () => {
    for (const p of CATALOG) {
      const page = parseHandbookPage(latest(p).text);
      if (!page.ok) throw new Error(p.id);
      if (p.status === "stub") {
        expect(latest(p).text).toContain("_TBD_");
        expect(latest(p).text).toContain("status: stub");
      } else if (p.type === "practice") expect(page.sections).toEqual(expect.arrayContaining(["Why", "When", "How here", "Example"]));
    }
  });
  it("no page asks the agent to lower the bar or to ignore its instructions", async () => {
    const { weakensBar, instructionLike } = await import("../../src/brain/guards.js");
    for (const p of CATALOG) for (const line of latest(p).text.split("\n")) {
      expect(weakensBar(line), `${p.id}: ${line}`).toBe(false);
      expect(/ignore (all|any|previous) instructions/i.test(line), `${p.id}: ${line}`).toBe(false);
      void instructionLike;
    }
  });
  it("the pages the lessons-and-steps will name exist: ticket-po-review's page, verify-first and clean-review", () => {
    for (const id of ["clarify-before-plan", "verify-first", "clean-review"]) expect(catalogPage(id), id).toBeDefined();
  });
});

describe("the generator", () => {
  const setup = (files: Record<string, string>) => {
    const dir = tempDir();
    mkdirSync(join(dir, "src/handbook/base"), { recursive: true });
    for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, "src/handbook/base", n), t);
    return dir;
  };
  const page = (body: string, extra = "") => `---\ntitle: T\ntype: practice\nupdated: 2026-11-20\nsummary: S\n${extra}---\n## Why\n${body}\n## When\nw\n## How here\nh\n## Example\ne\n`;

  it("a text that changed in the version in development replaces its revision; in a later version it is a new one", () => {
    const dir = setup({ "a.md": page("one") });
    buildCatalog({ cwd: dir, version: "0.5.0", write: true });
    writeFileSync(join(dir, "src/handbook/base/a.md"), page("two"));
    let c = buildCatalog({ cwd: dir, version: "0.5.0", write: true }).catalog;
    expect(c.pages[0].revisions.map((r: any) => [r.rev, r.since])).toEqual([[1, "0.5.0"]]);
    writeFileSync(join(dir, "src/handbook/base/a.md"), page("three"));
    c = buildCatalog({ cwd: dir, version: "0.6.0", write: true }).catalog;
    expect(c.pages[0].revisions.map((r: any) => [r.rev, r.since])).toEqual([[1, "0.5.0"], [2, "0.6.0"]]);
    expect(c.pages[0].revisions[0].text).toContain("two"); // an old revision is never edited
    expect(c.pages[0].revisions[0].text).toContain("origin: liftoff@0.5");
    expect(buildCatalog({ cwd: dir, version: "0.6.0", write: false }).changed).toBe(false);
  });
  it("keeps only the last revisions, refuses a page that disappears, and refuses origin/base in a source", () => {
    const dir = setup({ "a.md": page("v0") });
    for (let i = 1; i <= MAX_REVISIONS + 2; i++) {
      writeFileSync(join(dir, "src/handbook/base/a.md"), page(`v${i}`));
      buildCatalog({ cwd: dir, version: `0.${5 + i}.0`, write: true });
    }
    expect(buildCatalog({ cwd: dir, version: "0.99.0", write: false }).catalog.pages[0].revisions).toHaveLength(MAX_REVISIONS);
    writeFileSync(join(dir, "src/handbook/base/b.md"), page("x", "origin: team\n"));
    expect(() => shippedText(readFileSync(join(dir, "src/handbook/base/b.md"), "utf8"), "0.5.0")).toThrow(/does not carry/);
    const gone = setup({ "a.md": page("one") });
    buildCatalog({ cwd: gone, version: "0.5.0", write: true });
    writeFileSync(join(gone, "src/handbook/base/a.md"), page("one"));
    require("node:fs").unlinkSync(join(gone, "src/handbook/base/a.md"));
    writeFileSync(join(gone, "src/handbook/base/z.md"), page("z"));
    expect(() => buildCatalog({ cwd: gone, version: "0.5.0", write: true })).toThrow(/never deleted/);
  });
});

describe("status of a copy (the table)", () => {
  const p = catalogPage("verify-first")!;
  const rev = latest(p);
  const team = (edit: (t: string) => string) => edit(rev.text);
  it("each status", () => {
    expect(statusOf(p, rev.text, false).status).toBe("current");
    expect(statusOf(p, undefined, false).status).toBe("new-practice");
    expect(statusOf(p, undefined, true).status).toBe("retired");
    expect(statusOf(p, team((t) => t + "\nmore\n"), false).status).toBe("modified");
    expect(statusOf(p, team((t) => t.replace(/origin: .*\nbase: .*\n/, "origin: team\n")), false).status).toBe("team");
    expect(statusOf(p, "nope", false).status).toBe("invalid");
    // An older shipped text, untouched, with a newer one available:
    const older = { ...p, revisions: [{ ...rev, base: "aaaaaaaaaaaa", text: rev.text }, ...p.revisions] };
    const oldCopy = rev.text.replace(rev.base, "aaaaaaaaaaaa");
    expect(statusOf({ ...p, revisions: [{ ...rev, base: "aaaaaaaaaaaa" }, rev] }, oldCopy.replace(/(?<=\n---\n)/, ""), false).status).toBe("both-changed");
    void older;
    expect(revisionOf(p, rev.base)).toBe(rev);
  });
  it("update-available: the copy is exactly an older shipped text", () => {
    // Build a two-revision page by hand: the team has the first, the second is newer.
    const first = parseHandbookPage(rev.text);
    if (!first.ok) throw new Error("parse");
    const teamCopy = rev.text; // matches rev.base
    const newer = { ...rev, rev: rev.rev + 1, base: "bbbbbbbbbbbb", text: rev.text.replace("Verify first", "Verify first!") };
    const two = { ...p, revisions: [rev, newer] };
    expect(statusOf(two, teamCopy, false).status).toBe("update-available");
    expect(statusOf(two, teamCopy + "\nteam\n", false)).toMatchObject({ status: "both-changed", baseKnown: true });
  });
});

describe("retired.txt, the index and the paths", () => {
  it("parses lines, comments and bad lines; writes one line", () => {
    const r = parseRetired("# comment\nsmall-slices 2026-11-20 too rigid for us\n\nbad line\nverify-first 2026-11-21\n");
    expect(r.retired).toEqual([{ id: "small-slices", date: "2026-11-20", reason: "too rigid for us" }, { id: "verify-first", date: "2026-11-21", reason: "" }]);
    expect(r.bad).toEqual([{ line: 4, text: "bad line" }]);
    expect(retiredLine("a-b", "2026-11-20", "  two\n words ")).toBe("a-b 2026-11-20 two words");
    expect(() => retiredLine("Bad", "2026-11-20", "x")).toThrow();
  });
  it("the index lists pages by type, marks stubs, skips pages that do not parse, and is order-independent", () => {
    const pages = CATALOG.map((c) => ({ id: c.id, text: latest(c).text }));
    const a = buildHandbookIndex(pages).content;
    expect(buildHandbookIndex([...pages].reverse()).content).toBe(a);
    expect(a).toContain("## Practices");
    expect(a).toContain("## Conventions");
    expect(a).toMatch(/\[How we test\]\(how-we-test\.md\) \(to fill in, not yet guidance\)/);
    const skipped = buildHandbookIndex([...pages, { id: "bad", text: "x" }]);
    expect(skipped.skipped).toEqual([{ id: "bad", errors: expect.any(Array) }]);
    expect(buildHandbookIndex([]).content).toContain("_No pages yet._");
  });
  it("the paths sit inside the brain folder", () => {
    expect(handbookPaths("docs/brain/")).toMatchObject({ dir: "docs/brain/handbook", index: "docs/brain/handbook/index.md", retired: "docs/brain/handbook/retired.txt" });
  });
});
