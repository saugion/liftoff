import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startUi, type UiServer } from "../../ui/server.js";
import { FAKES, runDir, startJira, ROOT, type FakeJira } from "./world.js";
import { openPanel } from "./page-driver.js";

// The control panel's work-streams section, as a person uses it: the Jira project is chosen from Jira's own list, and a list
// cannot grow while one of its entries is still signalling an error.
const TOKEN = "panel-PAT-5a6b7c8d-do-not-leak";
let jira: FakeJira, ui: UiServer, root: string;
const saved = { PATH: process.env.PATH, FAKE_KEYCHAIN_FILE: process.env.FAKE_KEYCHAIN_FILE, LIFTOFF_JIRA_TOKEN: process.env.LIFTOFF_JIRA_TOKEN };

beforeAll(async () => {
  const dir = runDir("ui-panel");
  process.env.PATH = `${FAKES}:${process.env.PATH}`;
  process.env.FAKE_KEYCHAIN_FILE = join(dir, "keychain");
  process.env.LIFTOFF_JIRA_TOKEN = TOKEN;
  jira = await startJira(dir, [TOKEN], { fresh: false });
  root = join(dir, "app");
  writeFileSync(join(dir, "x"), "");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), "# app\n");
  writeFileSync(join(root, "liftoff.yaml"), `liftoff: 1
plugin:
  version: "0.5"
project:
  name: app
  kind: existing
agents:
  targets: [claude-code]
tracker:
  kind: jira-dc
  url: ${jira.url}
  project: PROJ
  server:
    version: 0.23.1
    sslVerify: false
    readOnly: false
  issueTypes:
    - name: Story
      template: "## Why\\n"
`);
  ui = await startUi({ root, page: readFileSync(join(ROOT, "ui", "page.html"), "utf8") });
});
afterAll(async () => {
  Object.assign(process.env, saved);
  for (const k of ["FAKE_KEYCHAIN_FILE", "LIFTOFF_JIRA_TOKEN"] as const) if (saved[k] === undefined) delete process.env[k];
  await ui.close();
  await jira.close();
});

describe("work streams in the control panel", () => {
  it("offers the Jira projects (not the team's own) and no free text, and waits for the input that signals an error", async () => {
    const p = await openPanel(join(ROOT, "ui", "page.html"), ui.url);
    await p.press('data-s="5"'); // the overview's way into the work-streams section
    await p.settle();
    expect(p.text).toContain("No work streams");
    // nothing is wrong yet: a stream can be linked
    await p.press("Link a stream");
    expect(p.text).toContain("Choose a project…");
    expect(p.html).toContain("Streams (STR)"); // from Jira's own list
    expect(p.html).not.toContain("Product (PROJ)"); // the team's own project is not a stream
    expect(p.html).not.toMatch(/data-f="project" value=/); // the key is not typed
    // the new stream is empty, so it signals errors: the list cannot grow and the section cannot be left
    expect(p.button("Link a stream")!.disabled).toBe(true);
    expect(p.button(/Continue|Review and apply/)!.disabled).toBe(true);
    expect(p.text).toContain("To continue:");
    // a bad id is still an error; a good id and a chosen project clear them
    await p.type("streams", 0, "id", "Not valid!");
    expect(p.button("Link a stream")!.disabled).toBe(true);
    await p.choose("streams", 0, "project", "STR");
    expect(p.button("Link a stream")!.disabled).toBe(true); // the id is still wrong
    await p.type("streams", 0, "id", "mvp-checkout");
    expect(p.button("Link a stream")!.disabled).toBe(false);
    expect(p.button(/Continue|Review and apply/)!.disabled).toBe(false);
  });
});
