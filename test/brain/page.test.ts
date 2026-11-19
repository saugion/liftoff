import { describe, expect, it } from "vitest";
import { normalize, parsePage } from "../../src/brain/page.js";

const FRONT = `---
title: Password reset
type: learning
updated: 2026-11-19
summary: Reset tokens expire after 30 minutes.
sources: [raw/tickets/PROJ-1-1a2b3c4d.md]
---
`;
const page = (body: string, front = FRONT) => {
  const r = parsePage(front + body);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r;
};
const errors = (text: string) => {
  const r = parsePage(text);
  if (r.ok) throw new Error("expected a parse failure");
  return r.errors;
};

describe("front matter", () => {
  it("reads every field; module is optional", () => {
    expect(page("# T\n").front).toEqual({
      title: "Password reset", type: "learning", updated: "2026-11-19", summary: "Reset tokens expire after 30 minutes.", sources: ["raw/tickets/PROJ-1-1a2b3c4d.md"],
    });
    expect(page("# T\n", FRONT.replace("\n---\n", "\nmodule: api\n---\n")).front.module).toBe("api");
  });
  it("accepts CRLF and a BOM", () => {
    expect(parsePage("﻿" + (FRONT + "body\n").replace(/\n/g, "\r\n")).ok).toBe(true);
  });
  it.each([
    ["missing", "# just a page\n", /no front matter/],
    ["not closed", "---\ntitle: x\n", /not closed/],
    ["broken YAML", "---\ntitle: [oops\n---\n", /YAML/],
    ["not a mapping", "---\n- a\n- b\n---\n", /mapping/],
    ["empty", "---\n---\n", /mapping/],
  ])("%s -> not ok", (_n, text, re) => {
    expect(errors(text).join(" ")).toMatch(re);
  });
  it("an unknown key is named", () => {
    expect(errors(FRONT.replace("---\n", "---\nauthor: me\n").replace("---\nauthor: me\n---", "---")).join()).toContain("unknown key 'author'");
  });
  it.each([
    ["title missing", FRONT.replace("title: Password reset\n", ""), "title"],
    ["title too long", FRONT.replace("Password reset", "x".repeat(121)), "title"],
    ["type outside the enum", FRONT.replace("learning", "story"), "type"],
    ["updated not a date", FRONT.replace("2026-11-19", "2026-02-30"), "updated"],
    ["updated in another format", FRONT.replace("2026-11-19", "19/11/2026"), "updated"],
    ["summary too long", FRONT.replace("Reset tokens expire after 30 minutes.", "x".repeat(161)), "summary"],
    ["sources empty", FRONT.replace("[raw/tickets/PROJ-1-1a2b3c4d.md]", "[]"), "sources"],
  ])("%s", (_n, text, key) => {
    expect(errors(text + "body\n").join()).toContain(key);
  });
});

describe("links", () => {
  it("collects relative links with their line, strips anchors, ignores external and anchor-only", () => {
    const r = page(
      ["# T", "[a](../modules/api.md#top) and [b](https://x.test/y) [c](mailto:a@b.c) [d](#here) [e](//cdn/x)", "![img](pics/a.png)", "[t](<spaced.md> \"title\")"].join("\n"),
    );
    expect(r.links).toEqual([
      { target: "../modules/api.md", line: 9 },
      { target: "pics/a.png", line: 10 },
      { target: "spaced.md", line: 11 },
    ]);
  });
  it("ignores links inside code spans and fenced blocks", () => {
    const r = page("`[a](one.md)` and [b](two.md)\n```\n[c](three.md)\n```\n~~~md\n[d](four.md)\n~~~\n[e](five.md)\n");
    expect(r.links.map((l) => l.target)).toEqual(["two.md", "five.md"]);
  });
  it("a longer fence is closed only by an equal or longer one", () => {
    const r = page("````\n```\n[x](in.md)\n```\n````\n[y](out.md)\n");
    expect(r.links.map((l) => l.target)).toEqual(["out.md"]);
  });
});

describe("quotes", () => {
  const cite = "-- [PROJ-1](../../raw/tickets/PROJ-1-1a2b3c4d.md)";
  it("a quote with its citation", () => {
    const r = page(`> The reset link expires after 30 minutes.\n> ${cite}\n`);
    expect(r.quotes).toEqual([{ text: "The reset link expires after 30 minutes.", citation: { label: "PROJ-1", path: "../../raw/tickets/PROJ-1-1a2b3c4d.md" }, line: 8 }]);
    expect(r.links.map((l) => l.target)).toContain("../../raw/tickets/PROJ-1-1a2b3c4d.md");
  });
  it("a multi-line quote is joined with single spaces", () => {
    const r = page(`> one line\n>   and another\n>\n> and a third\n> ${cite}\n`);
    expect(r.quotes[0]!.text).toBe("one line and another and a third");
  });
  it("a quote without a citation has none", () => {
    const r = page("> just words here\n");
    expect(r.quotes).toEqual([{ text: "just words here", line: 8 }]);
  });
  it("a `-- [x](y)` line outside a blockquote is not a citation and not a quote", () => {
    expect(page(`some text\n${cite}\n`).quotes).toEqual([]);
  });
  it("two quotes separated by a blank line are two quotes", () => {
    const r = page(`> first quote here\n> ${cite}\n\n> second quote here\n> ${cite}\n`);
    expect(r.quotes.map((q) => q.text)).toEqual(["first quote here", "second quote here"]);
  });
  it("a blockquote inside a code fence is not a quote", () => {
    expect(page("```\n> not a quote\n```\n").quotes).toEqual([]);
  });
  it("the quoted text is normalized: CRLF, NBSP, NFC", () => {
    const r = page(`> café au  lait\n> ${cite}\n`);
    expect(r.quotes[0]!.text).toBe("café au lait");
  });
});

describe("normalize", () => {
  it("NFC, CRLF to LF, whitespace runs to one space, trimmed, nothing else", () => {
    expect(normalize("  A\r\nB\t  C  ")).toBe("A B C");
    expect(normalize("Ünï")).toBe("Ünï"); // case and accents are kept
    expect(normalize("é")).toBe("é");
  });
});
