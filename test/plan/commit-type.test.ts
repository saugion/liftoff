import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { validateConfig, commitTypeOf } from "../../src/config/index.js";
import { buildInfo } from "../../src/plan/build.js";
import { CONFIG } from "./helpers.js";

const tracker = { server: { readOnly: false }, transitions: {} } as never;
const ticket = (issueType: string, key = "PROJ-123") => ({ key, summary: "Reset the password", issueType }) as never;
const host = (titlePattern: string) => ({ conventions: { titlePattern, branchPattern: "{type}/{key}-{slug}", targetBranch: "main", labels: [], reviewers: [] } }) as never;
const type = (t: object) => ({ name: "X", transitions: {}, ...t }) as never;

describe("the merge request title says what kind of change it is", () => {
  const pattern = "{commitType}({key}): {summary}";
  it.each([
    ["Bug", { branchType: "bugfix" }, "fix(PROJ-123): Reset the password"],
    ["Story", { branchType: "feature" }, "feat(PROJ-123): Reset the password"],
    ["Task", { branchType: "chore" }, "chore(PROJ-123): Reset the password"],
    ["Whatever", { branchType: "something-else" }, "chore(PROJ-123): Reset the password"],
    ["Docs", { branchType: "chore", commitType: "docs" }, "docs(PROJ-123): Reset the password"],
    ["Perf", { commitType: "perf" }, "perf(PROJ-123): Reset the password"],
  ])("%s becomes %s", (name, t, title) => {
    expect(buildInfo(ticket(name), tracker, type(t), host(pattern)).title).toBe(title);
  });
  it("a ticket whose type the config does not know reads as a chore", () => {
    expect(buildInfo(ticket("Mystery"), tracker, undefined, host(pattern)).title).toBe("chore(PROJ-123): Reset the password");
  });
  it("{type} still means the Jira type, and a pattern without the new word is unchanged", () => {
    expect(buildInfo(ticket("Bug"), tracker, type({ branchType: "bugfix" }), host("[{type}] {key}")).title).toBe("[Bug] PROJ-123");
    expect(buildInfo(ticket("Bug"), tracker, type({ branchType: "bugfix" }), undefined).title).toBe("PROJ-123: Reset the password");
  });
  it("the default follows the branch type", () => {
    expect(["feature", "bugfix", "chore", undefined].map((branchType) => commitTypeOf({ branchType }))).toEqual(["feat", "fix", "chore", "chore"]);
  });
});

describe("the config accepts it", () => {
  const withIt = (patch: (c: any) => void) => {
    const c = parse(CONFIG.replace('"{key}: {summary}"', '"{commitType}({key}): {summary}"'));
    patch(c);
    return validateConfig(c);
  };
  it("a title pattern with {commitType}, and a commitType per type", () => {
    expect(withIt((c) => (c.tracker.issueTypes[1].commitType = "fix"))).toMatchObject({ ok: true });
  });
  it.each(["Fix", "fix!", "fix2", ""])("a commitType of %j is refused", (v) => {
    expect(withIt((c) => (c.tracker.issueTypes[1].commitType = v)).ok).toBe(false);
  });
  it("an unknown placeholder is still refused, and the message lists the new one", () => {
    const r = validateConfig(parse(CONFIG.replace('"{key}: {summary}"', '"{nope}"')));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("{commitType}");
  });
});
