import { describe, expect, it } from "vitest";
import { fingerprint, frontErrors, parseHandbookPage, sectionsOf } from "../../src/handbook/page.js";

const BODY = "## Why\nBecause.\n\n## When\nAlways.\n\n## How here\nRun `make test`.\n\n## Example\nSee PROJ-1.\n";
const page = (front: Record<string, unknown>, body = BODY) =>
  `---\n${Object.entries(front).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n${body}`;
const FRONT = { title: "Verify first", type: "practice", updated: "2026-11-20", summary: "Checks that fail before the code exists.", origin: "team" };

describe("handbook page: the front matter", () => {
  it("a team practice with its four sections is valid", () => {
    const p = parseHandbookPage(page(FRONT));
    expect(p).toMatchObject({ ok: true, front: { origin: "team" }, sections: ["Why", "When", "How here", "Example"] });
  });
  it("a LiftOff page needs a base of 12 hex digits; a team page must not have one", () => {
    expect(parseHandbookPage(page({ ...FRONT, origin: "liftoff@0.5", base: "0123456789ab" })).ok).toBe(true);
    expect(parseHandbookPage(page({ ...FRONT, origin: "liftoff@0.5.1", base: "0123456789ab" })).ok).toBe(true);
    for (const base of [undefined, "xyz", "0123456789a", "0123456789ABC"]) {
      const f: Record<string, unknown> = { ...FRONT, origin: "liftoff@0.5" };
      if (base) f.base = base;
      expect(frontErrors(f).join(), String(base)).toContain("base");
    }
    expect(frontErrors({ ...FRONT, base: "0123456789ab" }).join()).toContain("a team page has no base");
  });
  it.each([
    ["unknown key", { ...FRONT, color: "red" }, "unknown key 'color'"],
    ["bad type", { ...FRONT, type: "rule" }, "type must be one of"],
    ["bad date", { ...FRONT, updated: "2026-02-30" }, "real date"],
    ["long summary", { ...FRONT, summary: "x".repeat(161) }, "summary"],
    ["multi-line title", { ...FRONT, title: "a\nb" }, "title"],
    ["bad origin", { ...FRONT, origin: "liftoff" }, "origin must be"],
    ["bad status", { ...FRONT, status: "draft" }, "status can only be"],
    ["sources on a practice", { ...FRONT, sources: ["raw/x.md"] }, "only a case lists sources"],
    ["empty sources", { ...FRONT, type: "case", sources: [] }, "sources must be"],
  ])("%s is an error", (_n, front, msg) => expect(frontErrors(front).join()).toContain(msg));
  it("a case may list sources and needs no practice sections", () => {
    expect(parseHandbookPage(page({ ...FRONT, type: "case", sources: ["raw/a.md"] }, "Something happened.\n")).ok).toBe(true);
  });
});

describe("handbook page: the body", () => {
  it("a practice without its sections, or in another order, is refused", () => {
    expect(parseHandbookPage(page(FRONT, "## Why\nx\n")).ok).toBe(false);
    expect(parseHandbookPage(page(FRONT, "## When\nx\n## Why\ny\n## How here\nz\n## Example\nw\n")).ok).toBe(false);
  });
  it("a stub and a convention are free of the practice sections", () => {
    expect(parseHandbookPage(page({ ...FRONT, type: "convention", status: "stub" }, "Not filled in yet.\n")).ok).toBe(true);
    expect(parseHandbookPage(page({ ...FRONT, type: "practice", status: "stub" }, "Not filled in yet.\n")).ok).toBe(true);
    expect(parseHandbookPage(page({ ...FRONT, type: "convention" }, "Text.\n")).ok).toBe(true);
  });
  it("headings inside a fenced block are not sections", () => {
    expect(sectionsOf("## A\n```\n## B\n```\n## C\n")).toEqual(["A", "C"]);
  });
  it("front matter must open and close, and be valid YAML", () => {
    expect(parseHandbookPage("# no front matter")).toMatchObject({ ok: false });
    expect(parseHandbookPage("---\ntitle: x\n")).toMatchObject({ ok: false });
    expect(parseHandbookPage("---\n: : :\n---\n")).toMatchObject({ ok: false });
  });
  it("counts the lines of the file and finds the relative links", () => {
    const p = parseHandbookPage(page(FRONT, BODY + "See [x](other.md).\n"));
    expect(p).toMatchObject({ ok: true, links: [{ target: "other.md" }] });
    if (p.ok) expect(p.lines).toBe(page(FRONT, BODY + "See [x](other.md).\n").split("\n").length - 1);
  });
});

describe("fingerprint", () => {
  const f = { title: "T", type: "practice" as const, summary: "S" };
  it("ignores CRLF, whitespace and Unicode form", () => {
    expect(fingerprint(f, "a  b\r\nc\n")).toBe(fingerprint(f, "a b\nc"));
    expect(fingerprint(f, "é")).toBe(fingerprint(f, "é"));
    expect(fingerprint(f, "x")).toMatch(/^[0-9a-f]{12}$/);
  });
  it("changes with the body, the title, the summary, the type and the stub mark", () => {
    const base = fingerprint(f, "x");
    for (const other of [fingerprint(f, "y"), fingerprint({ ...f, title: "U" }, "x"), fingerprint({ ...f, summary: "Z" }, "x"), fingerprint({ ...f, type: "convention" }, "x"), fingerprint({ ...f, status: "stub" }, "x")]) {
      expect(other).not.toBe(base);
    }
  });
});
