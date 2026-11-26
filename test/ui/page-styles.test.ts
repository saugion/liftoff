import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A style meant for one block of a page must not reach the others. Found in a real browser: the dark, tall style of the
// panel's live preview applied to every <pre>, and made a warning with a block of text in it unreadable.
describe.each(["ui/page.html", "ui/wizard.html"])("%s", (file) => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(readFileSync(file, "utf8"))![1]!;

  it("styles no <pre> by its tag alone", () => {
    expect(css).not.toMatch(/(?:^|[{},])\s*pre\s*(?:[,{]|:)/m);
  });
});
