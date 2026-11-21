import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startUi, type UiServer } from "../../ui/server.js";
import { FAKES, git, runDir, startJira, write, ROOT, type FakeJira } from "./world.js";
import { openPage } from "./page-driver.js";

// The setup page itself, step by step as a person goes through it, against the real server, the fake Jira and a real git remote.
const TOKEN = "page-PAT-1f2e3d4c-do-not-leak";
let dir: string, root: string, remote: string, jira: FakeJira, ui: UiServer;
const saved = { PATH: process.env.PATH, FAKE_KEYCHAIN_FILE: process.env.FAKE_KEYCHAIN_FILE, LIFTOFF_JIRA_TOKEN: process.env.LIFTOFF_JIRA_TOKEN };
const yaml = () => parse(readFileSync(join(root, "liftoff.yaml"), "utf8"));
const page = () => openPage(join(ROOT, "ui", "wizard.html"), ui.url);

beforeAll(async () => {
  dir = runDir("ui-page");
  process.env.PATH = `${FAKES}:${process.env.PATH}`;
  process.env.FAKE_KEYCHAIN_FILE = join(dir, "keychain");
  delete process.env.LIFTOFF_JIRA_TOKEN;
  jira = await startJira(dir, [TOKEN], { fresh: false });
  remote = join(dir, "remote.git");
  git(dir, "init", "-q", "--bare", "-b", "main", remote);
  root = join(dir, "my-app");
  git(dir, "init", "-q", "-b", "main", root);
  git(root, "config", "user.email", "po@example.com");
  git(root, "config", "user.name", "Po");
  git(root, "remote", "add", "origin", remote);
  write(root, "backend/package.json", JSON.stringify({ name: "api", scripts: { build: "tsc" }, devDependencies: { typescript: "5" } }));
  write(root, "frontend/package.json", JSON.stringify({ name: "web", dependencies: { react: "19" } }));
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  git(root, "push", "-q", "-u", "origin", "main");
  ui = await startUi({ root, page: "<p>panel</p>", wizard: readFileSync(join(ROOT, "ui", "wizard.html"), "utf8"), assetsDir: join(ROOT, "plugin", "skills", "liftoff-init", "assets") });
});
afterAll(async () => {
  Object.assign(process.env, saved);
  for (const k of ["FAKE_KEYCHAIN_FILE", "LIFTOFF_JIRA_TOKEN"] as const) if (saved[k] === undefined) delete process.env[k];
  await ui.close();
  await jira.close();
});

describe("the product owner, on the page", () => {
  it("goes from the welcome to a saved branch, and every button is on only when its fields are filled", async () => {
    const p = await page();
    expect(p.text).toContain("Let's set up LiftOff");
    await p.click("next");

    // the project: a name is needed
    p.type({ dataset: { bind: "name" }, value: "" });
    expect(p.button("next")!.disabled).toBe(true);
    p.type({ dataset: { bind: "name" }, value: "My App" });
    expect(p.button("next")!.disabled).toBe(false);
    p.type({ dataset: { bind: "purpose" }, value: "Lets people book rooms." });
    await p.click("next");

    // Jira: an address, then the token; a certificate this computer does not know, on a Jira on this computer, offers the skip
    expect(p.text).toContain("For example https://jira.yourcompany.com"); // the example stays visible
    expect(p.button("connect")!.disabled).toBe(true);
    p.type({ dataset: { bind: "url" }, value: jira.url });
    expect(p.button("connect")!.disabled).toBe(false);
    p.type({ dataset: { bind: "token" }, value: TOKEN });
    await p.click("connect");
    expect(p.text).toContain("skip the check");
    expect(p.text).not.toContain("Which Jira project");
    await p.click("local");

    // the project is chosen from a list, and the next button waits for the choice
    expect(p.text).toContain("Which Jira project does your team use?");
    expect(p.state<{ key: string }[]>("W.projects").map((x) => x.key)).toEqual(["PROJ", "STR"]);
    expect(p.button("pickProject")!.disabled).toBe(true);
    p.type({ dataset: { bind: "project" }, value: "PROJ" });
    expect(p.button("pickProject")!.disabled).toBe(false);
    p.type({ dataset: { bind: "project" }, value: "" });
    expect(p.button("pickProject")!.disabled).toBe(true);
    p.type({ dataset: { bind: "project" }, value: "PROJ" });
    await p.click("pickProject");

    // the ticket types: one of the team's own, created as a Jira Task
    expect(p.text).toContain("Which kinds of ticket does your team use?");
    p.type({ dataset: { bind: "addName" }, value: "e2e" });
    p.type({ dataset: { bind: "addBase" }, value: "Task" });
    await p.click("addType");
    expect(p.state<string>("W.types.filter(t=>t.jira).map(t=>t.name+' is a '+t.jira).join()")).toBe("e2e is a Task");
    await p.click("next");

    // the templates: no section at all switches Continue off
    expect(p.text).toContain("What kind of change is a");
    p.type({ dataset: { tbind: "0.template" }, value: "no sections here" });
    expect(p.button("next")!.disabled).toBe(true);
    p.type({ dataset: { tbind: "0.template" }, value: "## Context\n\n## Acceptance criteria\n" });
    expect(p.button("next")!.disabled).toBe(false);
    await p.click("next");

    // the files, then the save: Back works, Not now does not pretend, Save now brings the screen back
    await p.click("create");
    await p.settle();
    expect(p.text).toContain("Save and share with your team");
    expect(p.button("back")).toBeTruthy();
    await p.click("later");
    expect(p.text).toContain("Your setup is not saved");
    expect(p.text).not.toContain("Saved and shared");
    await p.click("saveNow");
    expect(p.text).toContain("liftoff/setup-po");
    await p.click("save");
    await p.settle();
    expect(p.text).toContain("Saved and shared");

    expect(git(remote, "branch", "--list")).toContain("liftoff/setup-po");
    expect(yaml()).toMatchObject({ project: { name: "My App", setup: "po" }, tracker: { project: "PROJ", server: { sslVerify: false } } });
    expect(yaml().tracker.issueTypes.find((t: { name: string }) => t.name === "e2e")).toMatchObject({ jiraType: "Task" });
    expect(readFileSync(join(dir, "keychain"), "utf8").trim()).toBe(TOKEN);
    for (const f of ["liftoff.yaml", "AGENTS.md", ".mcp.json"]) expect(readFileSync(join(root, f), "utf8")).not.toContain(TOKEN);
  });
});

describe("the technical lead, on the page", () => {
  it("sees the types that exist, adds one, and the root AGENTS.md follows", async () => {
    const p = await page();
    expect(p.text).toContain("The technical side");
    await p.click("next"); // welcome
    expect(p.text).toContain("The parts of the project");
    expect(p.state<string>("W.modules.map(m=>m.id).join()")).toBe("backend,frontend");
    await p.click("next"); // parts
    await p.click("next"); // assistants
    expect(p.text).toContain("Which kinds of ticket does your team have?");
    expect(p.state<boolean>("W.types.filter(t=>t.on).every(t=>t.locked)")).toBe(true); // what exists is shown, not rewritten
    p.type({ dataset: { bind: "addName" }, value: "support prio" });
    p.type({ dataset: { bind: "addBase" }, value: "Task" });
    await p.click("addType");
    await p.click("next");
    expect(p.text).toContain("How should each ticket be written?");
    await p.click("next");
    expect(p.text).toContain("What a title will look like");
    expect(p.text).toContain("feat(PROJ-123)");
    p.type({ dataset: { bind: "host" }, value: "gitlab.example.com" });
    await p.click("next"); // gitlab
    await p.click("next"); // quality
    // the project brain is the technical lead's decision, on a page of its own; "not now" is the default
    expect(p.text).toContain("Should the team keep a shared");
    expect(p.state<string>("W.brain")).toBe("off");
    p.change({ dataset: { brain: "" }, value: "on" });
    await p.settle();
    expect(p.text).toContain("learn from their corrections"); // the lessons choice appears once the brain is on
    await p.click("next");
    expect(p.text).toContain("Project brain:");
    await p.click("create");
    await p.settle();
    await p.click("save");
    await p.settle();
    expect(p.text).toContain("Saved and shared");
    expect(git(remote, "branch", "--list")).toContain("liftoff/setup-tl");
    expect(yaml().tracker.issueTypes.map((t: { name: string }) => t.name)).toEqual(["Epic", "Story", "Task", "Bug", "e2e", "support prio"]);
    const md = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(md).toContain("| backend | `backend` | TypeScript |");
    expect(md).not.toContain("Single application");
    expect(existsSync(join(root, "backend", "AGENTS.md"))).toBe(true);
    // and the brain the lead asked for, with the files around it, all in the save
    expect(yaml().brain).toEqual({});
    expect(existsSync(join(root, "brain", "README.md"))).toBe(true);
    expect(md).toContain("<!-- liftoff:brain -->");
    expect(git(remote, "show", "--name-only", "--format=", "liftoff/setup-tl")).toContain("brain/README.md");
  });
});
