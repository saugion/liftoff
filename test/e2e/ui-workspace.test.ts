import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startUi, type UiServer } from "../../ui/server.js";
import { detect } from "../../ui/detect.js";
import { FAKES, git, runDir, startJira, write, ROOT, type FakeJira } from "./world.js";
import { openPage, openPanel } from "./page-driver.js";

// A folder holding several repositories: LiftOff says what does not work there, and offers a repository for the setup alone.
const TOKEN = "ws-PAT-2c3d4e5f-do-not-leak";
let dir: string, jira: FakeJira;
const servers: UiServer[] = [];
const saved = { PATH: process.env.PATH, FAKE_KEYCHAIN_FILE: process.env.FAKE_KEYCHAIN_FILE, LIFTOFF_JIRA_TOKEN: process.env.LIFTOFF_JIRA_TOKEN };

beforeAll(async () => {
  dir = runDir("ui-workspace");
  process.env.PATH = `${FAKES}:${process.env.PATH}`;
  process.env.FAKE_KEYCHAIN_FILE = join(dir, "keychain");
  process.env.LIFTOFF_JIRA_TOKEN = TOKEN;
  jira = await startJira(dir, [TOKEN], { fresh: false });
});
afterAll(async () => {
  Object.assign(process.env, saved);
  for (const k of ["FAKE_KEYCHAIN_FILE", "LIFTOFF_JIRA_TOKEN"] as const) if (saved[k] === undefined) delete process.env[k];
  for (const s of servers) await s.close();
  await jira.close();
});

function repo(root: string, name: string, origin?: string) {
  const at = join(root, name);
  write(root, `${name}/package.json`, JSON.stringify({ name, scripts: { test: "x" } }));
  git(dir, "init", "-q", "-b", "main", at);
  git(at, "config", "user.email", "po@example.com");
  git(at, "config", "user.name", "Po");
  if (origin) git(at, "remote", "add", "origin", origin);
  git(at, "add", "-A");
  git(at, "commit", "-qm", "init");
}
function workspace(name: string) {
  const root = join(dir, name);
  repo(root, "api", "https://oauth2:glsecret@gitlab.example.com/team/api.git");
  repo(root, "web", "git@gitlab.example.com:team/web.git");
  return root;
}
async function server(root: string) {
  const ui = await startUi({ root, page: readFileSync(join(ROOT, "ui", "page.html"), "utf8"), wizard: readFileSync(join(ROOT, "ui", "wizard.html"), "utf8"), assetsDir: join(ROOT, "plugin", "skills", "liftoff-init", "assets") });
  servers.push(ui);
  const u = new URL(ui.url);
  const call = async (method: string, path: string, body?: unknown) =>
    (await fetch(u.origin + path, { method, headers: { "x-liftoff-token": u.searchParams.get("t")!, ...(body !== undefined && { "content-type": "application/json" }) }, ...(body !== undefined && { body: JSON.stringify(body) }) })).json() as Promise<any>;
  return { ui, call };
}
const identity = (root: string) => {
  git(root, "config", "user.email", "po@example.com");
  git(root, "config", "user.name", "Po");
};
const children = (root: string) => ["api", "web"].map((c) => git(join(root, c), "status", "--porcelain", "-uall") + git(join(root, c), "log", "--oneline"));
const poSetup = () => ({ name: "Shop", url: jira.url, project: "PROJ", insecure: true, types: [{ name: "Story", template: "## Context\n\n## Acceptance criteria\n" }] });

describe("a folder of repositories", () => {
  it("is reported with its repositories, and no secret from their addresses", async () => {
    const { call } = await server(workspace("state"));
    const state = await call("GET", "/api/state");
    expect(state.workspace).toMatchObject({ isRepo: false, skipped: false });
    expect(state.workspace.repos.map((r: { path: string }) => r.path)).toEqual(["api", "web"]);
    expect(JSON.stringify(state.workspace)).not.toContain("glsecret");
    expect((await call("GET", "/api/setup")).workspace).toEqual(state.workspace);
  });

  it("a repository, or a plain folder, is not one", async () => {
    const mono = join(dir, "mono");
    write(mono, "api/package.json", "{}");
    git(dir, "init", "-q", "-b", "main", mono);
    expect((await (await server(mono)).call("GET", "/api/state")).workspace).toBeUndefined();
    const plain = join(dir, "plain");
    write(plain, "api/package.json", "{}");
    const { call } = await server(plain);
    expect((await call("GET", "/api/state")).workspace).toBeUndefined();
    expect(await call("POST", "/api/workspace/init", {})).toMatchObject({ ok: false });
    expect(existsSync(join(plain, ".git"))).toBe(false);
  });

  it("skipping is remembered, in a file git ignores", async () => {
    const root = workspace("skip");
    const { call } = await server(root);
    await call("POST", "/api/workspace/skip", {});
    const again = await server(root);
    expect((await again.call("GET", "/api/state")).workspace.skipped).toBe(true);
    expect(readFileSync(join(root, ".liftoff", ".gitignore"), "utf8")).toBe("*\n");
    expect(existsSync(join(root, ".git"))).toBe(false);
  });

  it("the new repository holds the setup only, keeps what .gitignore had, and leaves the repositories as they were", async () => {
    const root = workspace("create");
    write(root, ".gitignore", "*.log\n");
    const before = children(root);
    const { call } = await server(root);
    const made = await call("POST", "/api/workspace/init", {});
    expect(made).toMatchObject({ ok: true, workspace: { isRepo: true } });
    expect(git(root, "symbolic-ref", "--short", "HEAD").trim()).toBe("main");
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(ignore).toContain("\n/*\n"); // everything, then the exceptions
    expect(ignore.endsWith("*.log\n/api/\n/web/\n")).toBe(true); // what it said keeps the last word; the repositories stay out
    const doc = readFileSync(join(root, "WORKSPACE.md"), "utf8");
    expect(doc).toContain("git clone https://gitlab.example.com/team/api.git api");
    expect(doc).toContain("git clone git@gitlab.example.com:team/web.git web");
    expect(doc).not.toContain("glsecret");
    expect(git(root, "status", "--porcelain", "-uall")).not.toContain("api");
    expect(children(root)).toEqual(before);
    expect(detect(root).git.host).toBe("gitlab.example.com"); // the new repository has no origin: still the repositories' host
    expect(await call("POST", "/api/workspace/init", {})).toMatchObject({ ok: false }); // once
  });

  it("a plain git add takes only what LiftOff writes, never the loose files of the folder", async () => {
    const root = workspace("loose");
    for (const f of ["keys.sh", "users.csv", "notes.md", "wiki/page.md", "wiki/deep/more.md", ".claude/settings.local.json", ".claude/skills/x/SKILL.md", ".github/hooks/h.json", ".vscode/settings.json", ".DS_Store"]) write(root, f, "private\n");
    const { call } = await server(root);
    await call("POST", "/api/workspace/init", {});
    for (const f of ["liftoff.yaml", "AGENTS.md", "CLAUDE.md", "CONSTRAINTS.md", ".mcp.json", ".claude/settings.json", ".github/copilot-instructions.md", ".gitattributes", "brain/wiki/a/b.md", "brain/README.md", "docs/AGENTS.md", "docs/CLAUDE.md"]) write(root, f, "shared\n");
    git(root, "add", "-A");
    expect(git(root, "diff", "--cached", "--name-only").trim().split("\n").sort()).toEqual(
      [".claude/settings.json", ".gitattributes", ".github/copilot-instructions.md", ".gitignore", ".mcp.json", "AGENTS.md", "CLAUDE.md", "CONSTRAINTS.md", "WORKSPACE.md", "brain/README.md", "brain/wiki/a/b.md", "docs/AGENTS.md", "docs/CLAUDE.md", "liftoff.yaml"]);
    // a settings file that was there before may hold the person's own keys: it stays out
    expect(git(root, "status", "--porcelain", "-uall")).not.toContain(".vscode/settings.json");
  });

  it("paths the config chose are shared too", async () => {
    const root = workspace("custom");
    write(root, "liftoff.yaml", "version: 1\nconstraints:\n  file: docs/quality/BAR.md\nbrain:\n  dir: docs/brain\n");
    write(root, "docs/quality/BAR.md", "# bar\n");
    write(root, "docs/quality/private.txt", "x\n");
    write(root, "docs/other/private.txt", "x\n");
    const { call } = await server(root);
    await call("POST", "/api/workspace/init", {});
    write(root, "docs/brain/wiki/a.md", "page\n");
    git(root, "add", "-A");
    expect(git(root, "diff", "--cached", "--name-only").trim().split("\n").sort()).toEqual([".gitignore", "WORKSPACE.md", "docs/brain/wiki/a.md", "docs/quality/BAR.md", "liftoff.yaml"]);
  });

  it("a file LiftOff wrote that .gitignore keeps out is named, not silently left behind", async () => {
    const root = workspace("ignored");
    write(root, ".gitignore", "CONSTRAINTS.md\n");
    const { call } = await server(root);
    await call("POST", "/api/workspace/init", {});
    await call("POST", "/api/setup/po", poSetup());
    const preview = await call("POST", "/api/save/preview", { stage: "po" });
    expect(preview.ignored).toEqual(["CONSTRAINTS.md"]);
    expect(preview.files).not.toContain("CONSTRAINTS.md");
    expect(preview.files).toContain("liftoff.yaml");
  });

  it("the first save is the first commit on main; files in the other repositories are named, not committed", async () => {
    const root = workspace("save");
    const { call } = await server(root);
    await call("POST", "/api/workspace/init", {});
    identity(root);
    expect(await call("POST", "/api/setup/po", poSetup())).toMatchObject({ ok: true });
    expect(await call("POST", "/api/setup/tl", { modules: [{ id: "api", path: "api" }, { id: "web", path: "web" }], targets: ["claude-code"] })).toMatchObject({ ok: true });
    const preview = await call("POST", "/api/save/preview", { stage: "tl" });
    expect(preview).toMatchObject({ git: true, first: true, branch: "main" });
    expect(preview.files).toEqual(expect.arrayContaining([".gitignore", "WORKSPACE.md", "liftoff.yaml", "AGENTS.md"]));
    expect(preview.files.some((f: string) => /^(api|web)\//.test(f))).toBe(false);
    expect(preview.elsewhere.map((e: { repo: string }) => e.repo)).toEqual(["api", "web"]);
    expect(preview.elsewhere[0].files).toContain("AGENTS.md");

    const done = await call("POST", "/api/save", { stage: "tl", files: preview.files });
    expect(done).toMatchObject({ ok: true, first: true, branch: "main", pushed: false });
    expect(done.note).toContain("git remote add origin");
    expect(git(root, "branch", "--format=%(refname:short)").trim()).toBe("main");
    const committed = git(root, "show", "--name-only", "--format=", "HEAD");
    expect(committed).toContain("liftoff.yaml");
    expect(committed).not.toMatch(/^(api|web)\//m);
    // the next save is a branch like anywhere else
    write(root, "liftoff.yaml", readFileSync(join(root, "liftoff.yaml"), "utf8") + "# changed\n");
    expect((await call("POST", "/api/save/preview", { stage: "tl" })).first).toBeFalsy();
  });

  it("without the new repository the files of the other repositories are still named", async () => {
    const root = workspace("nogit");
    const { call } = await server(root);
    await call("POST", "/api/setup/po", poSetup());
    await call("POST", "/api/setup/tl", { modules: [{ id: "api", path: "api" }], targets: ["claude-code"] });
    const preview = await call("POST", "/api/save/preview", { stage: "tl" });
    expect(preview.git).toBe(false);
    expect(preview.elsewhere.map((e: { repo: string }) => e.repo)).toEqual(["api", "web"]);
    expect(preview.elsewhere[1].files).toEqual([".claude/settings.json"]); // no module there: only the plugin switch
  });

  it("a setup made before the repository existed can be saved from it", async () => {
    const root = workspace("late");
    write(root, "liftoff.yaml", "version: 1\n");
    write(root, "AGENTS.md", "# Shop\n");
    write(root, ".mcp.json", "{}\n"); // may hold a person's own keys: never added unless LiftOff wrote it
    const { call } = await server(root);
    await call("POST", "/api/workspace/init", {});
    const preview = await call("POST", "/api/save/preview", { stage: "tl" });
    expect(preview.files).toEqual([".gitignore", "AGENTS.md", "WORKSPACE.md", "liftoff.yaml"]);
  });
});

describe("what the two pages say", () => {
  it("the control panel offers the repository, creates it on a click, and says what does not work", async () => {
    const root = workspace("panel");
    const { ui } = await server(root);
    const p = await openPanel(join(ROOT, "ui", "page.html"), ui.url);
    expect(p.text).toContain("holds 2 repositories");
    expect(p.text).toContain("do not work across repositories yet");
    await p.press("Create the configuration repository");
    expect(p.text).toContain("Configuration repository created");
    expect(p.text).toContain("git remote add origin");
    expect(existsSync(join(root, ".git"))).toBe(true);
  });

  it("skipped in the control panel, it does not come back", async () => {
    const root = workspace("panel-skip");
    const { ui } = await server(root);
    const p = await openPanel(join(ROOT, "ui", "page.html"), ui.url);
    await p.press("Skip");
    expect(p.text).not.toContain("holds 2 repositories");
    const again = await openPanel(join(ROOT, "ui", "page.html"), (await server(root)).ui.url);
    expect(again.text).not.toContain("holds 2 repositories");
    expect(existsSync(join(root, ".git"))).toBe(false);
  });

  it("the guide offers the same on its first screen, and Start stays available", async () => {
    const root = workspace("guide");
    const { ui } = await server(root);
    const p = await openPage(join(ROOT, "ui", "wizard.html"), ui.url);
    expect(p.text).toContain("holds 2 repositories");
    expect(p.button("next")!.disabled).toBe(false);
    await p.click("wsInit");
    expect(p.text).toContain("Configuration repository created");
    expect(existsSync(join(root, "WORKSPACE.md"))).toBe(true);
  });

  it("skipped in the guide, it is offered once more only where saving needs it", async () => {
    const root = workspace("guide-skip");
    const { ui } = await server(root);
    const p = await openPage(join(ROOT, "ui", "wizard.html"), ui.url);
    await p.click("wsSkip");
    expect(p.text).not.toContain("holds 2 repositories");
    await p.click("next");
    p.type({ dataset: { bind: "name" }, value: "Shop" });
    await p.click("next");
    p.type({ dataset: { bind: "url" }, value: jira.url });
    await p.click("connect");
    await p.click("local");
    p.type({ dataset: { bind: "project" }, value: "PROJ" });
    await p.click("pickProject");
    await p.click("next"); // types
    await p.click("next"); // templates
    await p.click("create");
    await p.settle();
    expect(p.text).toContain("This folder holds several repositories");
    await p.click("wsInit");
    expect(p.text).toContain("first commit");
    expect(p.text).toContain("liftoff.yaml");
  });
});
