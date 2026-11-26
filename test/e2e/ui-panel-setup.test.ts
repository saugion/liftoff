import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startUi, type UiServer } from "../../ui/server.js";
import { checkConfig } from "../../src/cli/check.js";
import { FAKES, runDir, startJira, ROOT, type FakeJira } from "./world.js";
import { openPanel } from "./page-driver.js";

// The control panel as the first setup: it must do what the guide does, on a folder that already holds projects.
const TOKEN = "panel-PAT-9f8e7d6c-do-not-leak";
const PAGE = join(ROOT, "ui", "page.html");
let jira: FakeJira, dir: string;
const saved = { PATH: process.env.PATH, FAKE_KEYCHAIN_FILE: process.env.FAKE_KEYCHAIN_FILE, LIFTOFF_JIRA_TOKEN: process.env.LIFTOFF_JIRA_TOKEN };
const open: UiServer[] = [];

beforeAll(async () => {
  dir = runDir("ui-panel-setup");
  process.env.PATH = `${FAKES}:${process.env.PATH}`;
  process.env.FAKE_KEYCHAIN_FILE = join(dir, "keychain");
  delete process.env.LIFTOFF_JIRA_TOKEN; // the person has no token on this computer yet
  jira = await startJira(dir, [TOKEN], { fresh: false });
});
afterAll(async () => {
  Object.assign(process.env, saved);
  for (const k of ["FAKE_KEYCHAIN_FILE", "LIFTOFF_JIRA_TOKEN"] as const) if (saved[k] === undefined) delete process.env[k];
  for (const u of open) await u.close();
  await jira.close();
});

const put = (root: string, rel: string, text: string) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const text = (root: string, rel: string) => readFileSync(join(root, rel), "utf8");
async function panel(root: string) {
  const ui = await startUi({ root, page: readFileSync(PAGE, "utf8"), assetsDir: join(ROOT, "plugin", "skills", "liftoff-init", "assets") });
  open.push(ui);
  return { ui, p: await openPanel(PAGE, `${ui.url}&view=panel`) };
}
// the test Jira has its own certificate: the person switches the check off, in the advanced settings
async function trustTestJira(p: Awaited<ReturnType<typeof openPanel>>) {
  await p.press("Show advanced settings");
  await p.press('data-k="ssl"');
}
// A folder of repositories that is not one itself, like a team's workspace.
function workspace(name: string) {
  const root = join(dir, name);
  for (const m of ["with-docs", "no-docs", "empty-docs"]) {
    put(root, `${m}/package.json`, JSON.stringify({ name: m, scripts: { test: "x" } }));
    put(root, `${m}/.git/HEAD`, "ref: refs/heads/main\n");
    put(root, `${m}/.git/config`, `[remote "origin"]\n\turl = https://gitlab.example.com/team/${m}.git\n`);
  }
  put(root, "with-docs/AGENTS.md", "# ours\n");
  put(root, "with-docs/CLAUDE.md", "@AGENTS.md");
  put(root, "empty-docs/AGENTS.md", "");
  return root;
}

describe("a first setup in the control panel", () => {
  it("detects the projects, takes a pasted GitLab address and a token, says what it will create, and leaves the project applied", async () => {
    const root = workspace("fresh");
    const { p } = await panel(root);

    await p.press('data-s="2"');
    for (const m of ["with-docs", "no-docs", "empty-docs"]) expect(p.html).toContain(`value="${m}"`); // detected, not typed
    expect(p.text).toContain("Applying creates them");
    expect(p.html).toContain("no-docs/AGENTS.md");
    expect(p.html).toContain("empty-docs/AGENTS.md");
    expect(p.html).not.toContain("with-docs/AGENTS.md");

    await p.press('data-s="3"');
    await p.fill("turl", jira.url);
    await trustTestJira(p);
    await p.fill("token", TOKEN);
    await p.press("Connect to Jira");
    expect(p.text).toContain("token is saved in your Mac");
    expect(readFileSync(process.env.FAKE_KEYCHAIN_FILE!, "utf8")).toContain(TOKEN);
    expect(p.html).toContain("Product (PROJ)"); // picked from Jira's list
    await p.pick("tkey", "PROJ");
    expect(p.button(/Continue/)!.disabled).toBe(true); // a first setup needs a ticket type, as in the guide
    await p.press("Look up the types in Jira");
    await p.press('data-v="Story"');
    expect(p.state<string>("F.its[0].tpl")).toContain("## ");
    expect(p.button(/Continue/)!.disabled).toBe(false);

    await p.press('data-s="4"');
    expect(p.html).toContain('value="gitlab.example.com"'); // from the repositories below
    await p.fill("host", "https://gitlab.example.com/team/");
    expect(p.button(/Continue/)!.disabled).toBe(false);

    await p.press('data-s="8"');
    expect(p.html).toContain("no-docs/AGENTS.md");
    await p.press("Write files");
    expect(p.text).toContain("Applied.");
    expect(p.text).toContain("holds several repositories and is not one itself"); // offers the configuration repository

    const yaml = text(root, "liftoff.yaml");
    expect(yaml).toContain("host: gitlab.example.com\n");
    expect(yaml).toContain("setup: done");
    expect(yaml).not.toContain(TOKEN);
    expect(text(root, "no-docs/AGENTS.md")).toContain("no-docs");
    expect(text(root, "empty-docs/AGENTS.md")).toContain("empty-docs");
    expect(text(root, "with-docs/AGENTS.md")).toBe("# ours\n");
    expect(text(root, "with-docs/CLAUDE.md")).toBe("@AGENTS.md"); // theirs, and no conflict
    expect(text(root, "AGENTS.md")).toContain("`no-docs`");
    expect(text(root, "CONSTRAINTS.md").length).toBeGreaterThan(100); // the template, not a stub
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(true);
    expect(text(root, ".mcp.json")).toContain("liftoff-jira");
    expect(checkConfig(root).status).toBe("ok");
  });

  it("saves to a branch on a yes, in a project under git", async () => {
    const root = join(dir, "tracked");
    const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
    put(root, "package.json", "{}");
    git("init", "-q", "-b", "main");
    git("config", "user.email", "tl@example.com");
    git("config", "user.name", "Tl");
    git("add", "-A");
    git("commit", "-qm", "init");
    const { p } = await panel(root);
    await p.press('data-s="3"');
    await p.fill("turl", jira.url);
    await trustTestJira(p);
    await p.fill("tkey", "PROJ"); // typed: Jira was not asked
    await p.press("Add a type of my own");
    await p.type("its", 0, "name", "Task");
    await p.press('data-s="8"');
    await p.press("Write files");
    await p.press("Save and share");
    expect(p.text).toContain("Saved on the branch liftoff/setup-tl");
    expect(git("show", "--name-only", "--format=", "liftoff/setup-tl")).toContain("liftoff.yaml");
  });
});

describe("a config with a Jira and no ticket type", () => {
  it("cannot be applied until a type is added, as in the guide", async () => {
    const root = join(dir, "no-types");
    put(root, "AGENTS.md", "# app\n");
    put(root, "liftoff.yaml", 'liftoff: 1\nplugin:\n  version: "0.6"\nproject:\n  name: app\n  kind: existing\nagents:\n  targets: [claude-code]\ntracker:\n  kind: jira-dc\n  url: https://jira.example.com\n  project: PROJ\n  server:\n    version: 0.23.1\n  issueTypes: []\n');
    const { p } = await panel(root);
    await p.press('data-s="8"');
    expect(p.button("Apply the saved config")!.disabled).toBe(true);
    await p.press('data-s="3"');
    expect(p.text).toContain("Add at least one ticket type");
    await p.press("Add a type of my own");
    await p.type("its", 0, "name", "Task");
    await p.press('data-s="8"');
    await p.press(/^Apply 1 change$/);
    expect(text(root, "liftoff.yaml")).toContain("name: Task");
    expect(checkConfig(root).status).toBe("ok");
  });
});

describe("a config that was saved but never applied", () => {
  it("can be applied from the panel with nothing changed, creating what is missing", async () => {
    const root = join(dir, "stuck");
    put(root, "AGENTS.md", "# app\n");
    put(root, "api/package.json", "{}");
    put(root, "liftoff.yaml", 'liftoff: 1\nplugin:\n  version: "0.6"\nproject:\n  name: app\n  kind: existing\nagents:\n  targets: [claude-code]\nmodules:\n  items:\n    - id: api\n      path: api\n');
    expect(checkConfig(root).status).toBe("blocked");
    const { p } = await panel(root);
    await p.press('data-s="8"');
    expect(p.html).toContain("api/AGENTS.md");
    await p.press("Apply the saved config");
    expect(text(root, "api/AGENTS.md")).toContain("api");
    expect(text(root, "AGENTS.md")).toBe("# app\n");
    expect(checkConfig(root).status).toBe("ok");
  });
});
