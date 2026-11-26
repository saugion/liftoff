import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startUi, type UiServer } from "../../ui/server.js";
import { FAKES, runDir, startJira, write, ROOT, type FakeJira } from "./world.js";
import { openPage, openPanel } from "./page-driver.js";

// Both pages: a settings file with comments stays as the person wrote it, and the page says what to add by hand.
const TOKEN = "settings-PAT-7a8b9c0d-do-not-leak";
const THEIRS = '// my settings\n{\n  "permissions": { "deny": ["Read(./secrets/**)"] },\n}\n';
let dir: string, jira: FakeJira;
const servers: UiServer[] = [];
const saved = { PATH: process.env.PATH, FAKE_KEYCHAIN_FILE: process.env.FAKE_KEYCHAIN_FILE, LIFTOFF_JIRA_TOKEN: process.env.LIFTOFF_JIRA_TOKEN };

beforeAll(async () => {
  dir = runDir("ui-settings-files");
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

async function project(name: string) {
  const root = join(dir, name);
  write(root, "api/package.json", JSON.stringify({ name: "api" }));
  write(root, ".claude/settings.json", THEIRS);
  const ui = await startUi({ root, page: readFileSync(join(ROOT, "ui", "page.html"), "utf8"), wizard: readFileSync(join(ROOT, "ui", "wizard.html"), "utf8"), assetsDir: join(ROOT, "plugin", "skills", "liftoff-init", "assets") });
  servers.push(ui);
  return { root, ui };
}
const settings = (root: string) => readFileSync(join(root, ".claude", "settings.json"), "utf8");

describe("a settings file with comments", () => {
  it("survives the guide, which says what to add", async () => {
    const { root, ui } = await project("guide");
    const p = await openPage(join(ROOT, "ui", "wizard.html"), ui.url);
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
    expect(settings(root)).toBe(THEIRS);
    expect(p.text).toContain("left as they are");
    expect(p.text).toContain(".claude/settings.json");
    expect(p.text).toContain("liftoff@liftoff");
  });

  it("survives the control panel's apply, which says what to add", async () => {
    const { root, ui } = await project("panel");
    const p = await openPanel(join(ROOT, "ui", "page.html"), ui.url);
    await p.press('data-s="3"');
    await p.fill("turl", jira.url);
    await p.press("Show advanced settings");
    await p.press('data-k="ssl"');
    await p.fill("tkey", "PROJ");
    await p.press("Add a type of my own");
    await p.type("its", 0, "name", "Task");
    await p.press('data-s="8"');
    await p.press("Write files");
    expect(p.text).toContain("Applied.");
    expect(settings(root)).toBe(THEIRS);
    expect(p.text).toContain("left as they are");
    expect(p.text).toContain("liftoff@liftoff");
  });
});
