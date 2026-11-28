import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { startUi, type UiServer } from "../../ui/server.js";
import { FAKES, git, runDir, startJira, write, ROOT, type FakeJira } from "./world.js";
import { openPage, openPanel } from "./page-driver.js";

// Onboarding the repositories of a workspace: what the setup writes in each, and what it says to run to share it.
// `workspace` in liftoff.yaml needs the release that introduces it: until that is cut, the installed version is mocked.
vi.mock("../../src/cli/version.js", async (actual) => ({ ...(await actual<typeof import("../../src/cli/version.js")>()), INSTALLED_VERSION: "0.8.0" }));

const TOKEN = "onb-PAT-5e6f7a8b-do-not-leak";
let dir: string, jira: FakeJira;
const servers: UiServer[] = [];
const saved = { PATH: process.env.PATH, FAKE_KEYCHAIN_FILE: process.env.FAKE_KEYCHAIN_FILE, LIFTOFF_JIRA_TOKEN: process.env.LIFTOFF_JIRA_TOKEN };

beforeAll(async () => {
  dir = runDir("ui-workspace-onboarding");
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

function repo(root: string, name: string, files: Record<string, string> = {}) {
  const at = join(root, name);
  write(root, `${name}/package.json`, JSON.stringify({ name, scripts: { test: "x" } }));
  for (const [f, text] of Object.entries(files)) write(at, f, text);
  git(dir, "init", "-q", "-b", "main", at);
  git(at, "config", "user.email", "po@example.com");
  git(at, "config", "user.name", "Po");
  git(at, "add", "-A");
  git(at, "commit", "-qm", "init");
}
function workspace(name: string, files: { api?: Record<string, string>; web?: Record<string, string> } = {}) {
  const root = join(dir, name);
  repo(root, "api", files.api);
  repo(root, "web", files.web);
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
type Call = Awaited<ReturnType<typeof server>>["call"];
const poSetup = () => ({ name: "Shop", url: jira.url, project: "PROJ", insecure: true, types: [{ name: "Story", template: "## Context\n\n## Acceptance criteria\n" }] });
// the control panel: apply a patch over what is on disk
const apply = async (call: Call, patch: Record<string, unknown> = {}) => call("POST", "/api/apply", { baseHash: (await call("GET", "/api/state")).hash, patch });

// both parts of the guide: the product owner's, then the technical lead's, which answers for everything written
async function guided(call: Call) {
  expect(await call("POST", "/api/setup/po", poSetup())).toMatchObject({ ok: true });
  return call("POST", "/api/setup/tl", { modules: [], targets: ["claude-code"] });
}

const FILE = ".claude/settings.json";
const text = (root: string, rel: string) => readFileSync(join(root, rel), "utf8");
const json = (root: string, rel: string) => JSON.parse(text(root, rel));
const switchOf = (root: string, rel: string) => {
  const s = json(root, rel);
  return { extraKnownMarketplaces: { liftoff: s.extraKnownMarketplaces.liftoff }, enabledPlugins: { "liftoff@liftoff": s.enabledPlugins["liftoff@liftoff"] } };
};

describe("the settings file of each repository", () => {
  it("holds the root's marketplace entry and plugin switch, and nothing else", async () => {
    const root = workspace("write");
    const { call } = await server(root);
    const done = await guided(call);
    expect(done).toMatchObject({ ok: true, notices: [] });
    for (const r of ["api", "web"]) {
      expect(json(root, `${r}/${FILE}`)).toEqual(switchOf(root, FILE));
      expect(done.written).toContain(`${r}/${FILE}`);
    }
  });

  it("is not written by the product owner's part: the repositories are chosen in the technical lead's", async () => {
    const root = workspace("po-only");
    const { call } = await server(root);
    expect(await call("POST", "/api/setup/po", poSetup())).toMatchObject({ ok: true });
    for (const r of ["api", "web"]) expect(existsSync(join(root, r, ".claude"))).toBe(false);
  });

  it("says nothing of a repository's settings file in the product owner's part", async () => {
    const root = workspace("po-unread", { api: { [FILE]: "// mine\n{}\n" } });
    const { call } = await server(root);
    expect(await call("POST", "/api/setup/po", poSetup())).toMatchObject({ ok: true });
    expect((await call("POST", "/api/save/preview", { stage: "po" })).onboarding).toEqual([]);
    expect((await call("GET", "/api/setup")).onboarding).toEqual([]);
  });

  it("copies what the root says, not what the plugin ships", async () => {
    const root = workspace("copy");
    write(root, FILE, JSON.stringify({ extraKnownMarketplaces: { liftoff: { source: { source: "github", repo: "saugion/liftoff", ref: "v9.9.9" } }, other: { source: {} } }, enabledPlugins: { "liftoff@liftoff": false, "other@other": true }, permissions: { deny: ["Read(./x)"] } }));
    const { call } = await server(root);
    await guided(call);
    expect(json(root, `api/${FILE}`)).toEqual({ extraKnownMarketplaces: { liftoff: { source: { source: "github", repo: "saugion/liftoff", ref: "v9.9.9" } } }, enabledPlugins: { "liftoff@liftoff": false } });
  });

  it("keeps the keys that were there, leaves a different ref alone, and a second apply changes nothing", async () => {
    const mine = { model: "opus", extraKnownMarketplaces: { liftoff: { source: { source: "github", repo: "saugion/liftoff", ref: "v0.3.0" } } }, enabledPlugins: { "mine@mine": true } };
    const root = workspace("keep", { api: { [FILE]: JSON.stringify(mine) } });
    const { call } = await server(root);
    await guided(call);
    expect(json(root, `api/${FILE}`)).toEqual({ ...mine, enabledPlugins: { "mine@mine": true, "liftoff@liftoff": true } });
    const before = ["api", "web"].map((r) => [text(root, `${r}/${FILE}`), statSync(join(root, r, FILE)).ino]);
    const again = await apply(call);
    expect(again).toMatchObject({ ok: true });
    expect(again.written.filter((f: string) => f.startsWith("api/") || f.startsWith("web/"))).toEqual([]);
    expect(["api", "web"].map((r) => [text(root, `${r}/${FILE}`), statSync(join(root, r, FILE)).ino])).toEqual(before);
  });

  it("is not written when Claude Code is not among the assistants", async () => {
    const root = workspace("copilot");
    const { call } = await server(root);
    expect(await apply(call, { project: { name: "Shop", kind: "existing" }, agents: { targets: ["copilot"] } })).toMatchObject({ ok: true });
    for (const r of ["api", "web"]) expect(existsSync(join(root, r, ".claude"))).toBe(false);
  });

  it("is not written in a submodule, nor in a folder that is no repository", async () => {
    const root = join(dir, "mono");
    write(root, "docs/page.md", "x\n");
    git(dir, "init", "-q", "-b", "main", root);
    repo(root, "lib");
    repo(root, "quoted lib");
    write(root, ".gitmodules", '[submodule "lib"]\n\tpath = lib\n\turl = https://example.com/lib.git\n[submodule "q"]\n\tpath = "quoted lib/"\n\turl = https://example.com/q.git\n');
    const { call } = await server(root);
    const done = await guided(call);
    expect(done).toMatchObject({ ok: true });
    for (const r of ["lib", "quoted lib", "docs"]) expect(existsSync(join(root, r, ".claude"))).toBe(false);
  });

  it("is not written in a repository left out, also after a second apply", async () => {
    const root = workspace("exclude");
    const { call } = await server(root);
    expect(await apply(call, { project: { name: "Shop", kind: "existing" }, agents: { targets: ["claude-code"] }, workspace: { exclude: ["web", "not-cloned"] } })).toMatchObject({ ok: true, render: { ok: true } });
    expect(existsSync(join(root, "api", FILE))).toBe(true);
    await apply(call);
    expect(existsSync(join(root, "web", ".claude"))).toBe(false);
  });

  it("with comments is left as it is, and named with what to add", async () => {
    const theirs = '// mine\n{ "model": "opus", }\n';
    const root = workspace("comments", { api: { [FILE]: theirs } });
    const { call } = await server(root);
    const done = await guided(call);
    expect(text(root, `api/${FILE}`)).toBe(theirs);
    expect(done.byHand).toEqual([{ file: `api/${FILE}`, add: switchOf(root, FILE) }]);
    expect(existsSync(join(root, "web", FILE))).toBe(true);
  });

  it("is said in the list of its repository, even with nothing else to share there, until the switch is in it", async () => {
    const root = shared("unread", { web: { [FILE]: '// mine\n{ "model": "opus" }\n' } });
    const { call } = await setUp(root);
    expect(await entry(call, "web")).toEqual({ repo: "web", files: [], review: [], ignored: [], unread: true });
    expect((await entry(call, "api")).unread).toBeUndefined();
    write(root, `web/${FILE}`, '// mine\n{ "enabledPlugins": { "liftoff@liftoff": true } }\n');
    expect(await entry(call, "web")).toBeUndefined();
  });

  it("with a section that is not an object is left as it is, and named", async () => {
    const theirs = JSON.stringify({ enabledPlugins: ["a@b"] });
    const root = workspace("odd", { api: { [FILE]: theirs } });
    const { call } = await server(root);
    const done = await guided(call);
    expect(text(root, `api/${FILE}`)).toBe(theirs);
    expect(done.byHand.map((b: { file: string }) => b.file)).toEqual([`api/${FILE}`]);
  });

  it("is not written through a link that leaves the repository", async () => {
    const root = workspace("link");
    const outside = join(dir, "link-outside");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(root, "api", ".claude"));
    const { call } = await server(root);
    const done = await guided(call);
    expect(done).toMatchObject({ ok: true });
    expect(existsSync(join(outside, "settings.json"))).toBe(false);
    expect(done.notices).toEqual([expect.stringContaining(`api/${FILE}`)]);
    expect(existsSync(join(root, "web", FILE))).toBe(true);
  });

  it("that cannot be written is named, and the other repositories still get theirs", async () => {
    const root = workspace("blocked", { api: { ".claude": "a file where the folder should be\n" } });
    const { call } = await server(root);
    const done = await guided(call);
    expect(done).toMatchObject({ ok: true });
    expect(done.notices.join()).toContain(`api/${FILE}`);
    expect(existsSync(join(root, "web", FILE))).toBe(true);
  });

  it("gets the entry the plugin ships when the root's file cannot be read, and the page is told", async () => {
    const root = workspace("noroot");
    write(root, FILE, "// mine\n{}\n");
    const { call } = await server(root);
    const done = await guided(call);
    expect(json(root, `api/${FILE}`)).toEqual(JSON.parse(readFileSync(join(ROOT, "plugin", "skills", "liftoff-init", "assets", "marketplace-entry.json"), "utf8")));
    expect(done.notices).toEqual([expect.stringContaining("LiftOff ships")]);
  });

  it("writing it runs no git: nothing is staged, committed or branched in a repository", async () => {
    const root = workspace("nogit");
    const snapshot = () => ["api", "web"].map((r) => [git(join(root, r), "diff", "--cached", "--name-only"), git(join(root, r), "log", "--all", "--oneline"), git(join(root, r), "branch", "--format=%(refname)")]);
    const before = snapshot();
    const { call } = await server(root);
    await guided(call);
    expect(snapshot()).toEqual(before);
  });
});

// two repositories with a remote, on main, in step with it
function shared(name: string, files: { api?: Record<string, string>; web?: Record<string, string> } = {}) {
  const root = workspace(name, files);
  for (const r of ["api", "web"]) {
    const bare = join(dir, `${name}-${r}.git`);
    git(dir, "init", "-q", "--bare", "-b", "main", bare);
    git(join(root, r), "remote", "add", "origin", bare);
    git(join(root, r), "push", "-q", "-u", "origin", "main");
    git(join(root, r), "remote", "set-head", "origin", "main");
  }
  return root;
}
const modules = () => ({ modules: [{ id: "api", path: "api" }], targets: ["claude-code"] });
async function setUp(root: string) {
  const s = await server(root);
  expect(await s.call("POST", "/api/setup/po", poSetup())).toMatchObject({ ok: true });
  expect(await s.call("POST", "/api/setup/tl", modules())).toMatchObject({ ok: true });
  return s;
}
const list = async (call: Call) => (await call("GET", "/api/state")).onboarding as any[];
const entry = async (call: Call, repo: string) => (await list(call)).find((e) => e.repo === repo);
const commit = (at: string, ...files: string[]) => (git(at, "add", "--", ...files), git(at, "commit", "-qm", "share", "--", ...files));

describe("what there is to share", () => {
  it("names exactly the uncommitted LiftOff files of each repository, on every page's request", async () => {
    const root = shared("list");
    write(root, "api/notes.txt", "mine\n");
    write(root, "web/package.json", "{}\n"); // changed by the person, never written by LiftOff
    const { call } = await setUp(root);
    const expected = [
      { repo: "api", files: [".claude/settings.json", "AGENTS.md", "CLAUDE.md"], review: [], ignored: [], branch: "main", base: "main" },
      { repo: "web", files: [".claude/settings.json"], review: [], ignored: [], branch: "main", base: "main" },
    ];
    expect(await list(call)).toEqual(expected);
    expect((await call("GET", "/api/setup")).onboarding).toEqual(expected);
    expect((await call("POST", "/api/save/preview", { stage: "tl" })).onboarding).toEqual(expected);
  });

  it("forgets what was committed, also when the person edits the file afterwards", async () => {
    const root = shared("committed");
    const { call } = await setUp(root);
    commit(join(root, "web"), ".claude/settings.json");
    expect(await entry(call, "web")).toBeUndefined();
    appendFileSync(join(root, "web", FILE), "\n");
    expect(await entry(call, "web")).toBeUndefined();
    expect(await entry(call, "api")).toBeDefined();
  });

  it("asks to look first at a file that held the person's own changes when LiftOff wrote in it", async () => {
    const root = shared("review", { api: { [FILE]: '{ "model": "a" }\n' }, web: { [FILE]: '{ "model": "a" }\n' } });
    write(root, `api/${FILE}`, '{ "model": "mine" }\n');
    const { call } = await setUp(root);
    expect(await entry(call, "api")).toMatchObject({ review: [FILE] });
    expect(await entry(call, "web")).toMatchObject({ files: [FILE], review: [] });
    await apply(call); // nothing to write: what is known stays
    expect(await entry(call, "api")).toMatchObject({ review: [FILE] });
    commit(join(root, "api"), FILE, "AGENTS.md", "CLAUDE.md");
    expect(await entry(call, "api")).toBeUndefined();
  });

  it("asks to look first at a file the person changed after LiftOff wrote it", async () => {
    const root = shared("edited");
    const { call } = await setUp(root);
    appendFileSync(join(root, "api", "AGENTS.md"), "\nOur rule.\n");
    expect(await entry(call, "api")).toMatchObject({ review: ["AGENTS.md"] });
    expect(await entry(call, "web")).toMatchObject({ review: [] });
  });

  it("names an ignored file apart, with the lines that let it in", async () => {
    const root = shared("ignored-share", { api: { ".gitignore": ".claude/\n" }, web: { ".gitignore": "*.json\n!package.json\n" } });
    write(root, "api/.claude/settings.local.json", "{}\n");
    const { call } = await setUp(root);
    for (const r of ["api", "web"]) {
      const e = await entry(call, r);
      expect(e.files).not.toContain(FILE);
      expect(e.ignored).toEqual([{ file: FILE, lines: expect.arrayContaining([`!/${FILE}`]) }]);
      appendFileSync(join(root, r, ".gitignore"), e.ignored[0].lines.join("\n") + "\n");
      expect(git(join(root, r), "status", "--porcelain", "-uall")).toContain(FILE);
      expect(git(join(root, r), "status", "--porcelain", "-uall")).not.toContain("settings.local.json"); // nothing else comes in
      expect((await entry(call, r)).files).toContain(FILE);
    }
  });

  it("warns on another branch than the default one, on none, and on commits not shared yet", async () => {
    const root = shared("branches");
    const { call } = await setUp(root);
    git(join(root, "api"), "switch", "-qc", "feat/other");
    git(join(root, "web"), "checkout", "-q", "--detach");
    expect(await entry(call, "api")).toMatchObject({ branch: "feat/other", base: "main", warning: expect.stringContaining("feat/other") });
    expect((await entry(call, "web")).warning).toContain("not on a branch");
    git(join(root, "api"), "switch", "-q", "main");
    git(join(root, "api"), "commit", "-qm", "local only", "--allow-empty");
    expect((await entry(call, "api")).warning).toContain("1 commit");
  });

  it("measures against the team's target branch when the repository has it", async () => {
    const root = shared("target");
    const { call } = await setUp(root);
    git(join(root, "api"), "branch", "develop");
    expect(await apply(call, { codeHost: { kind: "gitlab", host: "gitlab.example.com", conventions: { targetBranch: "develop" } } })).toMatchObject({ ok: true });
    expect(await entry(call, "api")).toMatchObject({ base: "develop", warning: expect.stringContaining("develop") });
    expect(await entry(call, "web")).toMatchObject({ base: "main" });
    expect((await entry(call, "web")).warning).toBeUndefined();
  });

  it("lists nothing for a repository left out, and nothing in a project without repositories", async () => {
    const root = shared("left-out");
    const { call } = await setUp(root);
    await apply(call, { workspace: { exclude: ["web"] } });
    expect((await list(call)).map((e) => e.repo)).toEqual(["api"]);
    const mono = join(dir, "mono-list");
    write(mono, "api/package.json", "{}\n");
    git(dir, "init", "-q", "-b", "main", mono);
    expect(await list((await setUp(mono)).call)).toEqual([]);
  });

  it("only reads: no repository's index, branches or commits move", async () => {
    const root = shared("reads");
    const state = () => ["api", "web"].map((r) => [readFileSync(join(root, r, ".git", "index")).toString("base64"), git(join(root, r), "for-each-ref"), git(join(root, r), "symbolic-ref", "HEAD")]);
    const before = state();
    const { call } = await setUp(root);
    await list(call);
    await call("POST", "/api/save/preview", { stage: "tl" });
    await apply(call);
    expect(state()).toEqual(before);
  });

  it("lists what an earlier LiftOff wrote, to be looked at first", async () => {
    const root = shared("earlier");
    write(root, "web/AGENTS.md", "# written by an earlier release\n");
    write(root, ".liftoff/ui-written.json", JSON.stringify({ files: ["web/AGENTS.md", "web/../api/x", "web/gone.md"], pending: false }));
    expect(await list((await server(root)).call)).toEqual([{ repo: "web", files: ["AGENTS.md"], review: ["AGENTS.md"], ignored: [], branch: "main", base: "main" }]);
  });
});

const conventions = { codeHost: { kind: "gitlab", host: "gitlab.example.com", conventions: { branchPattern: "feat/{key}-{slug}", titlePattern: "{commitType}({key}): {summary}" } } };
const share = async (call: Call, key: unknown) => call("POST", "/api/workspace/share", { key });
const of = (r: { onboarding: any[] }, repo: string) => r.onboarding.find((e) => e.repo === repo);
// what the engineer does with them: paste each line, unchanged, in a shell at the workspace root
// what a person does with the block on the page: all the lines at once, in one shell that goes on after a failure
const paste = (root: string, commands: string[]) => void execFileSync("sh", ["-c", commands.join("\n")], { cwd: root, stdio: "pipe" });
// the same, where something is expected to fail
const pasteAll = (root: string, commands: string[]) => spawnSync("sh", ["-c", commands.join("\n")], { cwd: root, stdio: "pipe" });

describe("the commands that share it", () => {
  it("are built with the team's patterns and the typed key", async () => {
    const root = shared("patterns");
    const { call } = await setUp(root);
    await apply(call, conventions);
    expect(of(await share(call, "PROJ-123"), "web").commands).toEqual([
      "git -C 'web' switch -c 'feat/PROJ-123-liftoff-setup' &&",
      "git -C 'web' add -- '.claude/settings.json' &&",
      "git -C 'web' commit -m 'chore(PROJ-123): LiftOff setup' -- '.claude/settings.json' &&",
      "git -C 'web' push -u origin 'feat/PROJ-123-liftoff-setup'",
    ]);
  });

  it("follow Build's own defaults when the team set no pattern", async () => {
    const { call } = await setUp(shared("defaults"));
    expect(of(await share(call, "PROJ-7"), "web").commands).toEqual(expect.arrayContaining([
      "git -C 'web' switch -c 'PROJ-7-liftoff-setup' &&", "git -C 'web' commit -m 'PROJ-7: LiftOff setup' -- '.claude/settings.json' &&",
    ]));
  });

  it("run as printed: one commit per repository with those files only, pushed, the rest untouched, and the list empties", async () => {
    const root = shared("run");
    write(root, "api/staged.txt", "mine, staged\n");
    git(join(root, "api"), "add", "staged.txt");
    write(root, "api/package.json", '{"name":"mine"}\n');
    write(root, "web/notes.txt", "mine\n");
    const { call } = await setUp(root);
    await apply(call, conventions);
    const refs = () => ["api", "web"].map((r) => git(join(root, r), "for-each-ref") + git(join(root, r), "symbolic-ref", "HEAD"));
    const before = refs();
    const answer = await share(call, "PROJ-123");
    expect(refs()).toEqual(before); // LiftOff runs none of them
    paste(root, answer.onboarding.flatMap((e: any) => e.commands));
    for (const [r, files] of [["api", [".claude/settings.json", "AGENTS.md", "CLAUDE.md"]], ["web", [".claude/settings.json"]]] as const) {
      const at = join(root, r);
      expect(git(at, "rev-list", "--count", "main..HEAD").trim()).toBe("1");
      expect(git(at, "show", "--name-only", "--format=%s", "HEAD").trim().split("\n").filter(Boolean)).toEqual(["chore(PROJ-123): LiftOff setup", ...files]);
      expect(git(at, "rev-parse", "origin/feat/PROJ-123-liftoff-setup")).toBe(git(at, "rev-parse", "HEAD"));
    }
    const names = (r: string, ...args: string[]) => git(join(root, r), ...args).split("\n").map((l) => l.trim()).filter(Boolean);
    expect(names("api", "diff", "--cached", "--name-only")).toEqual(["staged.txt"]); // still staged
    expect(names("api", "diff", "--name-only")).toEqual(["package.json"]); // still changed, not staged
    expect(names("api", "status", "--porcelain", "-uall")).toHaveLength(2);
    expect(names("web", "status", "--porcelain", "-uall")).toEqual(["?? notes.txt"]);
    expect(await list(call)).toEqual([]);
  });

  it.each(["", "PROJ", "proj-1", "OTHER-1", "PROJ-1; rm -rf .", "PROJ-1\n", 12, null])("are not shown for %j: the files still are", async (key) => {
    const root = shared(`badkey-${Math.random().toString(36).slice(2)}`);
    const { call } = await setUp(root);
    const answer = await share(call, key);
    expect(answer).toMatchObject({ ok: true, keyError: expect.stringContaining("PROJ") });
    expect(of(answer, "web")).toMatchObject({ files: [".claude/settings.json"] });
    expect(of(answer, "web").commands).toBeUndefined();
    expect(of({ onboarding: await list(call) }, "web").commands).toBeUndefined();
  });

  it("accept the key of a work stream", async () => {
    const { call } = await setUp(shared("stream"));
    expect(await apply(call, { streams: { items: [{ id: "ops", project: "OPS", mode: "kanban" }] } })).toMatchObject({ ok: true });
    const answer = await share(call, "OPS-4");
    expect(answer.keyError).toBeUndefined();
    expect(of(answer, "web").commands[0]).toContain("OPS-4");
  });

  it("take a numbered branch when the name is taken, here or on the server", async () => {
    const root = shared("taken");
    const { call } = await setUp(root);
    git(join(root, "web"), "branch", "PROJ-1-liftoff-setup");
    git(join(root, "web"), "push", "-q", "origin", "main:PROJ-1-liftoff-setup-2");
    const answer = await share(call, "PROJ-1");
    expect(of(answer, "web").commands[0]).toBe("git -C 'web' switch -c 'PROJ-1-liftoff-setup-3' &&");
    expect(of(answer, "api").commands[0]).toBe("git -C 'api' switch -c 'PROJ-1-liftoff-setup' &&");
  });

  it("stop at the first failure in their repository, and go on in the others", async () => {
    const root = shared("hook-refuses");
    const { call } = await setUp(root);
    write(root, "api/.git/hooks/pre-commit", "#!/bin/sh\nexit 1\n");
    chmodSync(join(root, "api", ".git", "hooks", "pre-commit"), 0o755);
    pasteAll(root, (await share(call, "PROJ-1")).onboarding.flatMap((e: any) => e.commands));
    expect(git(join(root, "api"), "ls-remote", "--heads", "origin")).not.toContain("liftoff"); // nothing was pushed
    expect(git(join(root, "api"), "rev-list", "--count", "HEAD").trim()).toBe("1");
    expect(git(join(root, "web"), "ls-remote", "--heads", "origin")).toContain("PROJ-1-liftoff-setup");
  });

  it("commit nothing on the default branch when the new branch cannot be made", async () => {
    const root = shared("switch-fails");
    const { call } = await setUp(root);
    const printed = of(await share(call, "PROJ-1"), "api").commands;
    git(join(root, "api"), "branch", "PROJ-1-liftoff-setup"); // taken after the page showed the commands
    pasteAll(root, printed);
    expect(git(join(root, "api"), "rev-list", "--count", "main").trim()).toBe("1");
    expect(git(join(root, "api"), "diff", "--cached", "--name-only")).toBe("");
  });

  it.each([
    ["a merge", "MERGE_HEAD"],
    ["a cherry-pick", "CHERRY_PICK_HEAD"],
    ["a revert", "REVERT_HEAD"],
    ["a rebase", "rebase-merge"],
    ["a rebase", "rebase-apply"],
  ])("are not shown while %s is not finished (%s)", async (what, mark) => {
    const root = shared(`unfinished-${mark}`);
    const { call } = await setUp(root);
    const at = join(root, "api");
    if (mark.startsWith("rebase")) mkdirSync(join(at, ".git", mark));
    else write(at, `.git/${mark}`, git(at, "rev-parse", "HEAD"));
    const e = of(await share(call, "PROJ-1"), "api");
    expect(e.commands).toBeUndefined();
    expect(e.warning).toContain(what);
    expect(of({ onboarding: await list(call) }, "api").warning).toContain(what); // said without a key too
    expect(of(await share(call, "PROJ-1"), "web").commands).toHaveLength(4);
  });

  it("see an unfinished merge in a linked worktree", async () => {
    const root = shared("unfinished-worktree");
    const main = join(dir, "unfinished-worktree-main");
    repo(dir, "unfinished-worktree-main");
    git(main, "worktree", "add", "-q", "-b", "side", join(root, "wt"), "main");
    const { call } = await setUp(root);
    write(main, ".git/worktrees/wt/MERGE_HEAD", git(main, "rev-parse", "HEAD"));
    expect((await entry(call, "wt")).warning).toContain("a merge");
  });

  it.each([
    ["here", (at: string) => git(at, "branch", "feat")],
    ["on the server", (at: string) => git(at, "push", "-q", "origin", "main:feat")],
  ])("are not shown when a branch %s stands where the new one needs a folder", async (where, make) => {
    const root = shared(`blocked-${where.replaceAll(" ", "-")}`);
    const { call } = await setUp(root);
    await apply(call, conventions);
    make(join(root, "api"));
    const answer = await share(call, "PROJ-1");
    expect(of(answer, "api").commands).toBeUndefined();
    expect(of(answer, "api").why).toContain("called feat");
    expect(of(answer, "web").commands).toHaveLength(4);
  });

  it("take a numbered branch when other branches sit under the name", async () => {
    const root = shared("under");
    const { call } = await setUp(root);
    git(join(root, "web"), "branch", "PROJ-1-liftoff-setup/old");
    expect(of(await share(call, "PROJ-1"), "web").commands[0]).toBe("git -C 'web' switch -c 'PROJ-1-liftoff-setup-2' &&");
  });

  it("leave out the files to look at first, which stay as the person left them", async () => {
    const root = shared("held-back", { api: { [FILE]: '{ "model": "a" }\n' }, web: { [FILE]: '{ "model": "a" }\n' } });
    write(root, `api/${FILE}`, '{ "env": { "KEY": "mine" } }\n');
    write(root, `web/${FILE}`, '{ "env": { "KEY": "mine" } }\n');
    const { call } = await setUp(root);
    const answer = await share(call, "PROJ-1");
    const api = of(answer, "api");
    expect(api).toMatchObject({ review: [FILE] });
    expect(api.commands.join("\n")).not.toContain("settings.json");
    expect(of(answer, "web")).toMatchObject({ review: [FILE] });
    expect(of(answer, "web").commands).toBeUndefined(); // nothing else to commit there
    expect(of(answer, "web").why).toBeUndefined();
    paste(root, api.commands);
    expect(git(join(root, "api"), "show", "--name-only", "--format=", "HEAD")).not.toContain("settings.json");
    expect(git(join(root, "api"), "status", "--porcelain")).toContain(FILE);
  });

  it("stop before the push where there is no server to push to, and say how to add one", async () => {
    const root = shared("no-origin");
    git(join(root, "api"), "remote", "remove", "origin");
    const { call } = await setUp(root);
    const api = of(await share(call, "PROJ-1"), "api");
    expect(api.commands).toHaveLength(3);
    expect(api.commands.join("\n")).not.toContain("push");
    expect(api.commands.at(-1)).not.toContain("&&");
    expect(api.why).toContain("git remote add origin");
    paste(root, api.commands);
    expect(git(join(root, "api"), "rev-list", "--count", "main..HEAD").trim()).toBe("1");
  });

  it("speak of no commits to carry on a branch that has none, as after a commit that was refused", async () => {
    const root = shared("empty-branch");
    const { call } = await setUp(root);
    git(join(root, "api"), "switch", "-qc", "feat/empty");
    expect((await entry(call, "api")).warning).toBe("This repository is on feat/empty, not on main. Switch to main first.");
    git(join(root, "api"), "commit", "-qm", "work", "--allow-empty");
    expect((await entry(call, "api")).warning).toContain("would carry the commits of feat/empty");
  });

  it("leave no warning on the branch that holds only the setup, while a file is still to be looked at", async () => {
    const root = shared("setup-branch", { web: { [FILE]: '{ "model": "a" }\n' } });
    write(root, `web/${FILE}`, '{ "model": "mine" }\n');
    const { call } = await server(root);
    await call("POST", "/api/setup/po", poSetup());
    await call("POST", "/api/setup/tl", { modules: [{ id: "web", path: "web" }], targets: ["claude-code"] });
    paste(root, of(await share(call, "PROJ-1"), "web").commands);
    const after = of(await share(call, "PROJ-1"), "web");
    expect(after).toMatchObject({ files: [FILE], review: [FILE], setup: true, branch: "PROJ-1-liftoff-setup" });
    expect(after.warning).toBeUndefined();
    expect(after.commands).toBeUndefined();
    // work of another kind on that branch brings the warning back
    write(root, "web/mine.txt", "mine\n");
    commit(join(root, "web"), "mine.txt");
    const mixed = of(await share(call, "PROJ-1"), "web");
    expect(mixed.setup).toBeUndefined();
    expect(mixed.warning).toContain("PROJ-1-liftoff-setup");
  });

  it("are not shown while a repository has a warning, and the others keep theirs", async () => {
    const root = shared("warned");
    const { call } = await setUp(root);
    git(join(root, "api"), "switch", "-qc", "feat/other");
    const answer = await share(call, "PROJ-1");
    expect(of(answer, "api").commands).toBeUndefined();
    expect(of(answer, "web").commands).toHaveLength(4);
  });

  it("leave ignored files out", async () => {
    const root = shared("ignored-commands", { api: { ".gitignore": ".claude/\n" }, web: { ".gitignore": ".claude/\n" } });
    const { call } = await setUp(root);
    const answer = await share(call, "PROJ-1");
    expect(of(answer, "api").commands.join("\n")).not.toContain("settings.json");
    expect(of(answer, "web").commands).toBeUndefined(); // nothing but the ignored file
  });

  it("run safely whatever the folders and files are called", async () => {
    const root = join(dir, "hostile");
    const name = "it's $(touch pwned); `touch pwned` repo";
    repo(root, name);
    const bare = join(dir, "hostile.git");
    git(dir, "init", "-q", "--bare", "-b", "main", bare);
    git(join(root, name), "remote", "add", "origin", bare);
    git(join(root, name), "push", "-q", "-u", "origin", "main");
    const { call } = await server(root);
    await call("POST", "/api/setup/po", poSetup());
    const module = "my \"mod\" $(touch pwned)";
    expect(await call("POST", "/api/setup/tl", { modules: [{ id: "m", path: `${name}/${module}` }], targets: ["claude-code"] })).toMatchObject({ ok: true });
    const e = of(await share(call, "PROJ-1"), name);
    expect(e.files).toContain(`${module}/AGENTS.md`);
    paste(root, e.commands);
    expect(execFileSync("find", [root, "-name", "pwned"], { encoding: "utf8" })).toBe("");
    expect(git(join(root, name), "show", "--name-only", "--format=", "-z", "HEAD")).toContain(`${module}/AGENTS.md`);
    expect(await list(call)).toEqual([]);
  });

  it("are not shown for a name git would read as a pattern", async () => {
    const root = shared("pattern-name");
    const { call } = await server(root);
    await call("POST", "/api/setup/po", poSetup());
    await call("POST", "/api/setup/tl", { modules: [{ id: "m", path: "api/pkg[1]" }], targets: ["claude-code"] });
    const answer = await share(call, "PROJ-1");
    expect(of(answer, "api").commands).toBeUndefined();
    expect(of(answer, "api").why).toContain("by hand");
    expect(of(answer, "web").commands).toHaveLength(4);
  });
});

// what a person reads: the page's text, with the escapes of the html undone
const read = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&#39;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&").replace(/\s+/g, " ");
const BRANCH_NOTICE = "switching back removes the new ones";
const IMPORT_NOTICE = "asks to approve an import";

describe("what the two pages say about the repositories", () => {
  // the technical lead's part of the guide, page by page, up to the save step; `choose` acts on the page of the code
  async function guide(root: string, choose: (p: Awaited<ReturnType<typeof openPage>>) => void = () => {}) {
    const s = await server(root);
    expect(await s.call("POST", "/api/setup/po", poSetup())).toMatchObject({ ok: true });
    const p = await openPage(join(ROOT, "ui", "wizard.html"), s.ui.url);
    await p.click("next"); // welcome
    choose(p);
    for (let n = 0; n < 12 && !p.button("create"); n++) await p.click("next");
    await p.click("create");
    await p.settle();
    return { ...s, p };
  }

  it("the guide's save step lists them, asks for a key and shows the commands with the two notices", async () => {
    const root = shared("page-guide");
    const { p } = await guide(root);
    for (const expected of ["Share the setup in each repository", "api", "web", ".claude/settings.json", BRANCH_NOTICE, IMPORT_NOTICE]) expect(read(p.html)).toContain(expected);
    expect(read(p.html)).not.toContain("git -C");
    expect(read(p.html)).not.toContain("are in other repositories"); // said once, not twice
    await p.click("showCommands");
    expect(read(p.html)).toContain("Type a ticket key of PROJ");
    p.type({ dataset: { bind: "shareKey" }, value: " PROJ-5 " });
    await p.click("showCommands");
    expect(read(p.html)).toContain("git -C 'web' switch -c 'PROJ-5-liftoff-setup'");
    expect(read(p.html)).toContain("git -C 'api' push -u origin 'PROJ-5-liftoff-setup'");
    expect(read(p.html)).not.toContain("Type a ticket key of");
  });

  it("the guide's check page promises no file in a repository left out", async () => {
    const root = shared("page-check-left-out");
    const s = await server(root);
    expect(await s.call("POST", "/api/setup/po", poSetup())).toMatchObject({ ok: true });
    const p = await openPage(join(ROOT, "ui", "wizard.html"), s.ui.url);
    await p.click("next"); // welcome
    p.change({ dataset: { repo: "web" }, checked: false });
    for (let n = 0; n < 12 && !p.button("create"); n++) await p.click("next");
    expect(p.text).toContain("api/AGENTS.md");
    expect(p.text).not.toContain("web/AGENTS.md");
  });

  // api has an unreadable settings file and no server; web has a file to look at
  const minors = (name: string) => {
    const root = shared(name, { api: { [FILE]: '// mine\n{}\n' }, web: { [FILE]: '{ "model": "a" }\n' } });
    write(root, `web/${FILE}`, '{ "model": "mine" }\n');
    write(root, "api/AGENTS.md", "");
    git(join(root, "api"), "remote", "remove", "origin");
    return root;
  };
  const MINORS = ["did not switch its plugin on here", "git remote add origin", "commit and push them yourself on PROJ-1-liftoff-setup"];
  const both = { modules: [{ id: "api", path: "api" }, { id: "web", path: "web" }], targets: ["claude-code"] };
  const wraps = (html: string) => {
    expect(html).toContain("white-space:pre-wrap");
    expect(html).not.toContain("white-space:pre;");
  };

  it("the control panel says what to do about an unreadable file, a missing server and a setup branch; long lines wrap", async () => {
    const root = minors("panel-minors");
    const s = await server(root);
    await s.call("POST", "/api/setup/po", poSetup());
    await s.call("POST", "/api/setup/tl", both);
    paste(root, of(await share(s.call, "PROJ-1"), "web").commands);
    const p = await openPanel(join(ROOT, "ui", "page.html"), s.ui.url);
    await p.edit({ sk: "" }, "PROJ-1");
    await p.press("Show the commands");
    for (const said of MINORS) expect(read(p.html)).toContain(said);
    wraps(p.html);
  });

  it("the guide says the same", async () => {
    const root = minors("guide-minors");
    const s = await server(root);
    await s.call("POST", "/api/setup/po", poSetup());
    const p = await openPage(join(ROOT, "ui", "wizard.html"), s.ui.url);
    for (let n = 0; n < 12 && !p.button("create"); n++) await p.click("next");
    await p.click("create");
    await p.settle();
    p.type({ dataset: { bind: "shareKey" }, value: "PROJ-1" });
    await p.click("showCommands");
    paste(root, of(await share(s.call, "PROJ-1"), "web").commands);
    await p.click("showCommands");
    for (const said of MINORS) expect(read(p.html)).toContain(said);
    wraps(p.html);
  });

  it("the control panel lists them on the overview and the review", async () => {
    const root = shared("page-panel", { api: { ".gitignore": ".claude/\n" }, web: { [FILE]: '{ "model": "a" }\n' } });
    write(root, `web/${FILE}`, '{ "model": "mine" }\n');
    const s = await setUp(root);
    // a module in web too, so that it has files besides the one to look at first
    expect(await apply(s.call, { modules: { items: [{ id: "api", path: "api" }, { id: "web", path: "web" }] } })).toMatchObject({ ok: true });
    git(join(root, "api"), "switch", "-qc", "feat/other");
    const p = await openPanel(join(ROOT, "ui", "page.html"), s.ui.url);
    for (const expected of ["Share the setup in each repository", "Ignored by .gitignore", `!/${FILE}`, "api/.gitignore", "feat/other", "Not in the commands", BRANCH_NOTICE, IMPORT_NOTICE]) expect(read(p.html)).toContain(expected);
    await p.edit({ sk: "" }, "PROJ-9");
    await p.press("Show the commands");
    expect(read(p.html)).toContain("git -C 'web' switch -c 'PROJ-9-liftoff-setup'");
    expect(read(p.html)).not.toContain("git -C 'api'");
    await p.press('data-s="8"');
    expect(read(p.html)).toContain("git -C 'web' switch -c 'PROJ-9-liftoff-setup'");
    expect(read(p.html)).not.toContain("are in other repositories");
  });

  it("a committed repository leaves the list, and the commands follow", async () => {
    const root = shared("page-done");
    const s = await setUp(root);
    const p = await openPanel(join(ROOT, "ui", "page.html"), s.ui.url);
    await p.edit({ sk: "" }, "PROJ-9");
    await p.press("Show the commands");
    paste(root, (await share(s.call, "PROJ-9")).onboarding.flatMap((e: any) => e.commands));
    await p.press("Show the commands");
    expect(read(p.html)).not.toContain("Share the setup in each repository");
  });

  it("still name the module files of a repository left out, apart from the list", async () => {
    const root = shared("page-left-out");
    const s = await setUp(root);
    expect(await apply(s.call, { workspace: { exclude: ["api"] } })).toMatchObject({ ok: true });
    const preview = await s.call("POST", "/api/save/preview", { stage: "tl" });
    expect(preview.onboarding.map((e: { repo: string }) => e.repo)).toEqual(["web"]);
    const p = await openPanel(join(ROOT, "ui", "page.html"), s.ui.url);
    await p.press('data-s="8"');
    expect(read(p.html)).toContain("are in other repositories");
    expect(read(p.html)).toContain("api/AGENTS.md");
    expect(read(p.html)).not.toContain("web/.claude/settings.json"); // the list names it, without the folder
  });

  it("says nothing of it in a project without repositories", async () => {
    const mono = join(dir, "page-mono");
    write(mono, "api/package.json", "{}\n");
    git(dir, "init", "-q", "-b", "main", mono);
    const s = await setUp(mono);
    const p = await openPanel(join(ROOT, "ui", "page.html"), s.ui.url);
    expect(read(p.html)).not.toContain("Share the setup in each repository");
  });

  it("both pages say why a settings file was not written", async () => {
    const outside = join(dir, "page-outside");
    mkdirSync(outside, { recursive: true });
    const root = workspace("page-notice");
    symlinkSync(outside, join(root, "api", ".claude"));
    const { p } = await guide(root);
    expect(read(p.html)).toContain("leads outside the repository");
    const panel = shared("page-notice-panel");
    symlinkSync(outside, join(panel, "api", ".claude"));
    const s = await server(panel);
    await guided(s.call);
    rmSync(join(panel, "web", ".claude"), { recursive: true });
    const q = await openPanel(join(ROOT, "ui", "page.html"), s.ui.url);
    await q.press('data-s="8"');
    await q.press("Apply the saved config").catch(async () => {
      await q.edit({ k: "name" }, "Shop two");
      await q.press('data-s="8"');
      await q.press(/^Apply/);
    });
    expect(read(q.html)).toContain("leads outside the repository");
  });
});

describe("leaving a repository out", () => {
  const yaml = (root: string) => text(root, "liftoff.yaml");
  const base = (pin: string, extra = "") => `liftoff: 1\nplugin:\n  version: "${pin}"\nproject:\n  name: Shop\n  kind: existing\n  setup: done\nagents:\n  targets: [claude-code]\n${extra}`;
  async function panel(root: string) {
    const s = await server(root);
    return { ...s, p: await openPanel(join(ROOT, "ui", "page.html"), s.ui.url) };
  }
  const toggle = async (p: Awaited<ReturnType<typeof openPanel>>, repo: string) => {
    await p.press('data-s="2"');
    await p.press(`data-a="excl" data-v="${repo}"`);
    await p.press('data-s="8"');
  };

  it("is chosen in the panel before the first apply, written with the version it needs, and can be undone", async () => {
    const root = shared("panel-choice");
    write(root, "liftoff.yaml", base("0.4"));
    const { p, call } = await panel(root);
    await toggle(p, "web");
    expect(read(p.html)).toContain("Repositories left out");
    await p.press(/^Apply/);
    expect(read(p.html)).toContain("Applied.");
    expect(yaml(root)).toMatch(/workspace:\n\s+exclude:\s*\n?\s*(- web|\[ ?web ?\])/);
    expect(yaml(root)).toContain('version: "0.8"');
    expect(existsSync(join(root, "api", FILE))).toBe(true);
    expect(existsSync(join(root, "web", ".claude"))).toBe(false);
    expect((await list(call)).map((e) => e.repo)).toEqual(["api"]);
    await toggle(p, "web");
    await p.press(/^Apply/);
    expect(existsSync(join(root, "web", FILE))).toBe(true);
    expect(yaml(root)).not.toContain("workspace");
    expect(yaml(root)).toContain('version: "0.8"'); // never lowered
  });

  it("keeps a name with no folder here, and shows it so it can be taken back", async () => {
    const root = shared("not-cloned");
    write(root, "liftoff.yaml", base("0.8", "workspace:\n  exclude: [not-cloned, web]\n"));
    const { p } = await panel(root);
    await p.press('data-s="2"');
    expect(read(p.html)).toContain("not-cloned");
    await p.press('data-a="excl" data-v="web"');
    await p.press('data-s="8"');
    await p.press(/^Apply/);
    expect(parseYaml(yaml(root)).workspace).toEqual({ exclude: ["not-cloned"] });
  });

  it("holds for a colleague who applies the same liftoff.yaml", async () => {
    const mine = base("0.8", "workspace:\n  exclude: [web]\n");
    const root = shared("colleague");
    write(root, "liftoff.yaml", mine);
    const { call } = await server(root);
    expect(await apply(call)).toMatchObject({ ok: true, render: { ok: true } });
    await apply(call);
    expect(existsSync(join(root, "web", ".claude"))).toBe(false);
    expect(parseYaml(yaml(root))).toEqual(parseYaml(mine));
  });

  it("gets no instruction file either, though a module lives in it", async () => {
    const root = shared("module-left-out");
    const { call } = await server(root);
    expect(await call("POST", "/api/setup/po", poSetup())).toMatchObject({ ok: true });
    const modules = [{ id: "api", path: "api" }, { id: "web", path: "./web/" }, { id: "deep", path: "web/deep" }];
    const done = await call("POST", "/api/setup/tl", { modules, targets: ["claude-code"], exclude: ["web"] });
    expect(done).toMatchObject({ ok: true, render: { ok: true } });
    for (const f of ["AGENTS.md", "CLAUDE.md"]) expect(existsSync(join(root, "api", f))).toBe(true);
    expect(git(join(root, "web"), "status", "--porcelain", "-uall")).toBe("");
    expect(existsSync(join(root, "web", "deep"))).toBe(false);
    expect(text(root, "AGENTS.md")).toContain("| web |"); // still one of the project's modules
    expect(await call("GET", "/api/state")).toMatchObject({ creates: [], needsApply: false });
    expect(await apply(call)).toMatchObject({ ok: true, render: { ok: true } });
    expect(git(join(root, "web"), "status", "--porcelain", "-uall")).toBe("");
    // included again, it gets them
    expect(await apply(call, { workspace: null })).toMatchObject({ ok: true });
    for (const f of ["web/AGENTS.md", "web/CLAUDE.md", "web/deep/AGENTS.md", `web/${FILE}`]) expect(existsSync(join(root, f))).toBe(true);
  });

  it("is not written when nothing is left out, and a name with a path is refused where it stands", async () => {
    const root = shared("none-out");
    const { call } = await setUp(root);
    expect(yaml(root)).not.toContain("workspace");
    const bad = await apply(call, { workspace: { exclude: ["web", "../x"] } });
    expect(bad).toMatchObject({ ok: false, errors: [expect.objectContaining({ path: "/workspace/exclude/1" })] });
    expect(yaml(root)).not.toContain("workspace");
  });

  it("is not offered in a project without repositories", async () => {
    const mono = join(dir, "choice-mono");
    write(mono, "api/package.json", "{}\n");
    write(mono, "liftoff.yaml", base("0.4"));
    git(dir, "init", "-q", "-b", "main", mono);
    const { p } = await panel(mono);
    await p.press('data-s="2"');
    expect(read(p.html)).not.toContain("Repositories LiftOff writes in");
  });

  it("is chosen on the guide's page about the code, before anything is written in a repository", async () => {
    const root = shared("guide-choice");
    const { call } = await server(root);
    await call("POST", "/api/setup/po", poSetup());
    const { ui } = await server(root);
    const p = await openPage(join(ROOT, "ui", "wizard.html"), ui.url);
    await p.click("next");
    expect(read(p.html)).toContain("Repositories LiftOff writes in");
    p.change({ dataset: { repo: "web" }, checked: false });
    for (let n = 0; n < 12 && !p.button("create"); n++) await p.click("next");
    expect(read(p.html)).toContain("Left alone: web");
    await p.click("create");
    await p.settle();
    expect(parseYaml(yaml(root)).workspace).toEqual({ exclude: ["web"] });
    expect(parseYaml(yaml(root)).plugin.version).toBe("0.8");
    expect(existsSync(join(root, "api", FILE))).toBe(true);
    expect(existsSync(join(root, "web", ".claude"))).toBe(false);
  });

  it("run again, the guide shows the choice made and takes the section away when nothing is left out", async () => {
    const root = shared("guide-again");
    const { call } = await server(root);
    await call("POST", "/api/setup/po", poSetup());
    const tl = (exclude?: unknown) => call("POST", "/api/setup/tl", { modules: [], targets: ["claude-code"], ...(exclude !== undefined && { exclude }) });
    expect(await tl(["web"])).toMatchObject({ ok: true });
    expect(await tl()).toMatchObject({ ok: true }); // a page that says nothing changes nothing
    expect(parseYaml(yaml(root)).workspace).toEqual({ exclude: ["web"] });
    expect(await tl([])).toMatchObject({ ok: true });
    expect(yaml(root)).not.toContain("workspace");
    expect(existsSync(join(root, "web", FILE))).toBe(true);
    expect(await tl(["a/b"])).toMatchObject({ ok: false, code: "config-invalid" });
  });
});
