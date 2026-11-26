import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startUi, type UiServer } from "../../ui/server.js";
import { runDir, write, ROOT } from "./world.js";
import { openPanel } from "./page-driver.js";

// A setting that needs a newer plugin raises the version the config asks for. It never lowers it.
const dir = runDir("ui-pin");
const servers: UiServer[] = [];
afterAll(async () => {
  for (const s of servers) await s.close();
});

async function changeReview(name: string, pin: string) {
  const root = join(dir, name);
  write(root, "liftoff.yaml", `liftoff: 1\nplugin:\n  version: "${pin}"\nproject:\n  name: app\n  kind: existing\nagents:\n  targets: [claude-code]\n`);
  const ui = await startUi({ root, page: readFileSync(join(ROOT, "ui", "page.html"), "utf8"), assetsDir: join(ROOT, "plugin", "skills", "liftoff-init", "assets") });
  servers.push(ui);
  const p = await openPanel(join(ROOT, "ui", "page.html"), ui.url);
  await p.press('data-s="7"');
  await p.press('data-v="nudge"');
  await p.press('data-s="8"');
  await p.press(/^Apply/);
  expect(p.text).toContain("Applied.");
  return readFileSync(join(root, "liftoff.yaml"), "utf8");
}

describe("the plugin version a config asks for", () => {
  it("stays where it is when it is already high enough", async () => {
    const yaml = await changeReview("higher", "0.6");
    expect(yaml).toContain('version: "0.6"');
    expect(yaml).toContain("ticket-po-review: nudge");
  });

  it("is raised when the setting needs it", async () => {
    expect(await changeReview("lower", "0.4")).toContain('version: "0.5"');
  });
});
