import { describe, expect, it } from "vitest";
import { splitCriteria } from "../../src/plan/criteria.js";

const texts = (s: string) => splitCriteria(s).map((c) => c.text);

describe("splitCriteria", () => {
  it("nothing is nothing; text with no structure is one criterion", () => {
    expect(splitCriteria("")).toEqual([]);
    expect(splitCriteria("  \n\n ")).toEqual([]);
    expect(splitCriteria("The user can reset the password\nby email.")).toEqual([{ id: "AC1", text: "The user can reset the password by email." }]);
  });
  it("one per top-level bullet, numbered in order, whatever the list marker", () => {
    expect(splitCriteria("- a\n- b\n- c")).toEqual([{ id: "AC1", text: "a" }, { id: "AC2", text: "b" }, { id: "AC3", text: "c" }]);
    expect(texts("* a\n* b")).toEqual(["a", "b"]);
    expect(texts("1. a\n2. b")).toEqual(["a", "b"]);
    expect(texts("# a\n# b")).toEqual(["a", "b"]);
    expect(texts("1) a\n2) b")).toEqual(["a", "b"]);
  });
  it("checkboxes and Jira check marks are stripped", () => {
    expect(texts("- [ ] a\n- [x] b")).toEqual(["a", "b"]);
    expect(texts("* (/) a\n* (x) b")).toEqual(["a", "b"]);
  });
  it("nested bullets and continuation lines belong to the item above", () => {
    expect(texts("- a\n  - detail\n  more detail\n- b")).toEqual(["a detail more detail", "b"]);
    expect(texts("* a\n** nested\n* b")).toEqual(["a nested", "b"]);
  });
  it("Given/When/Then: one criterion per scenario, with or without a Scenario label", () => {
    const gwt = "Scenario 1: expired\nGiven a link older than 24 hours\nWhen the user opens it\nThen an error is shown\n\nScenario 2: valid\nGiven a fresh link\nWhen the user opens it\nThen the form shows";
    const r = splitCriteria(gwt);
    expect(r).toHaveLength(2);
    expect(r[0]!.text).toContain("older than 24 hours");
    expect(r[1]!.text).toContain("fresh link");
    expect(texts("Given a\nWhen b\nThen c\nGiven d\nWhen e\nThen f")).toHaveLength(2);
    expect(texts("Given a\nAnd b\nWhen c\nThen d\nAnd e")).toHaveLength(1);
  });
  it("bold scenario labels as Jira wiki gives them", () => {
    expect(texts("*Scenario 1: a*\nGiven x\nThen y\n*Scenario 2: b*\nGiven z\nThen w")).toHaveLength(2);
  });
  it("rendered HTML", () => {
    expect(texts("<ul><li>a</li><li>b <b>bold</b></li></ul>")).toEqual(["a", "b bold"]);
  });
  it("a bullet list that mentions the word then is still a list", () => {
    expect(texts("- First do a, then b\n- Show c")).toEqual(["First do a, then b", "Show c"]);
  });
});
