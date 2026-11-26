import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startUi, type UiServer } from "../../ui/server.js";
import { FAKES, runDir, startJira, write, ROOT, type FakeJira } from "./world.js";
import { openPage, openPanel } from "./page-driver.js";

// A person whose Jira token is already in LIFTOFF_JIRA_TOKEN types nothing, and nothing goes into the keychain.
const TOKEN = "env-PAT-5b6c7d8e-do-not-leak";
const OTHER = "typed-PAT-0a1b2c3d-do-not-leak";
let dir: string, jira: FakeJira;
const servers: UiServer[] = [];
const saved = { PATH: process.env.PATH, FAKE_KEYCHAIN_FILE: process.env.FAKE_KEYCHAIN_FILE, LIFTOFF_JIRA_TOKEN: process.env.LIFTOFF_JIRA_TOKEN };
const keychain = () => process.env.FAKE_KEYCHAIN_FILE!;

beforeAll(async () => {
  dir = runDir("ui-env-token");
  process.env.PATH = `${FAKES}:${process.env.PATH}`;
  process.env.FAKE_KEYCHAIN_FILE = join(dir, "keychain");
  process.env.LIFTOFF_JIRA_TOKEN = TOKEN;
  jira = await startJira(dir, [TOKEN, OTHER], { fresh: false });
});
afterAll(async () => {
  Object.assign(process.env, saved);
  for (const k of ["FAKE_KEYCHAIN_FILE", "LIFTOFF_JIRA_TOKEN"] as const) if (saved[k] === undefined) delete process.env[k];
  for (const s of servers) await s.close();
  await jira.close();
});

async function server(name: string) {
  const root = join(dir, name);
  write(root, "api/package.json", JSON.stringify({ name: "api" }));
  const ui = await startUi({ root, page: readFileSync(join(ROOT, "ui", "page.html"), "utf8"), wizard: readFileSync(join(ROOT, "ui", "wizard.html"), "utf8"), assetsDir: join(ROOT, "plugin", "skills", "liftoff-init", "assets") });
  servers.push(ui);
  return ui;
}
const state = async (ui: UiServer) => {
  const u = new URL(ui.url);
  return (await fetch(u.origin + "/api/state", { headers: { "x-liftoff-token": u.searchParams.get("t")! } })).text();
};

describe("the token is already in the environment", () => {
  it("the state says that it is there, never what it is", async () => {
    const body = await state(await server("state"));
    expect(JSON.parse(body).tokenInEnv).toBe(true);
    expect(body).not.toContain(TOKEN);
  });

  it("the control panel asks for nothing and saves nothing", async () => {
    const ui = await server("panel");
    const p = await openPanel(join(ROOT, "ui", "page.html"), ui.url);
    await p.press('data-s="3"');
    expect(p.text).toContain("A token is already set in LIFTOFF_JIRA_TOKEN");
    expect(p.html).not.toContain('type="password"');
    await p.fill("turl", jira.url);
    await p.press("Show advanced settings"); // to accept the test certificate
    await p.press('data-k="ssl"');
    await p.press("Connect to Jira");
    expect(p.text).toContain("Nothing was saved in the keychain");
    expect(p.html).toContain("Product (PROJ)");
    expect(existsSync(keychain())).toBe(false);
    expect(p.html).not.toContain(TOKEN);

    // the choice stays open: a different one can be typed, and the page says which one wins
    await p.press("Type a different token");
    expect(p.html).toContain('type="password"');
    await p.press("Use LIFTOFF_JIRA_TOKEN instead");
    expect(p.html).not.toContain('type="password"');
    await p.press("Type a different token");
    await p.fill("token", OTHER);
    await p.press("Connect to Jira");
    expect(p.text).toContain("is used instead");
    expect(readFileSync(keychain(), "utf8")).toContain(OTHER);
  });

  it("the guide asks for nothing and saves nothing", async () => {
    rmSync(keychain(), { force: true });
    const ui = await server("guide");
    const p = await openPage(join(ROOT, "ui", "wizard.html"), ui.url);
    await p.click("next"); // welcome
    p.type({ dataset: { bind: "name" }, value: "My App" });
    await p.click("next");
    expect(p.text).toContain("A token is already set in LIFTOFF_JIRA_TOKEN");
    expect(p.html).not.toContain('type="password"');
    await p.click("ownToken");
    expect(p.html).toContain('type="password"');
    await p.click("envToken");
    expect(p.html).not.toContain('type="password"');
    p.type({ dataset: { bind: "url" }, value: jira.url });
    await p.click("connect");
    await p.click("local");
    expect(p.text).toContain("Nothing was saved in the keychain");
    expect(p.text).toContain("Which Jira project does your team use?");
    expect(existsSync(keychain())).toBe(false);
    expect(p.html).not.toContain(TOKEN);
  });

  it("a token in the environment that Jira refuses is named, since typing another one here would not replace it", async () => {
    process.env.LIFTOFF_JIRA_TOKEN = "stale-PAT-ffffffff";
    try {
      const ui = await server("stale");
      const u = new URL(ui.url);
      const r = await (await fetch(u.origin + "/api/jira/projects", { method: "POST", headers: { "x-liftoff-token": u.searchParams.get("t")!, "content-type": "application/json" }, body: JSON.stringify({ url: jira.url, insecure: true }) })).json();
      expect(r).toMatchObject({ ok: false, code: "bad-token" });
      expect(r.message).toContain("LIFTOFF_JIRA_TOKEN");
    } finally {
      process.env.LIFTOFF_JIRA_TOKEN = TOKEN;
    }
  });
});
