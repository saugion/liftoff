import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildUi } from "../scripts/build-ui.mjs";
import { tempDir } from "./helpers.js";

// The CLI guard (static-guard.test.ts) allows no network module at all. The control panel serves its page with
// node:http on 127.0.0.1 and its page talks only to its own origin. Two modules are the exceptions, each for one
// reason, and nothing else may import what they import: ui/connect.ts reaches the Jira address the user typed
// (https) and runs `security` for the keychain (child_process); ui/persist.ts runs git (child_process) after the
// person approved the file list. Keep this in step with docs/decisions/DECISIONS.md.
const FORBIDDEN = ["net", "dns", "https", "http2", "tls", "dgram", "child_process", "worker_threads", "cluster"];
const ALLOWED: Record<string, string[]> = { "ui/connect.ts": ["https", "child_process"], "ui/persist.ts": ["child_process"] };
const importOf = (mods: string[]) => new RegExp(`(?:from\\s*|require\\(\\s*|import\\(\\s*|import\\s+)["'](?:node:)?(?:${mods.join("|")})["']`);
const IMPORT = importOf(FORBIDDEN);
const CODE = [/\bfetch\s*\(/, /\bWebSocket\b/, /\bimport\s*\(/, /\.listen\([^)]*["'](?:0\.0\.0\.0|::)["']/];

const sources = readdirSync("ui").filter((f) => f.endsWith(".ts")).map((f) => join("ui", f));
const pages = ["ui/page.html", "ui/wizard.html"];

describe("ui guard", () => {
  it("ui/*.ts uses no outbound network, no child process and never binds a public address, except the two named modules", () => {
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      const forbidden = FORBIDDEN.filter((m) => !(ALLOWED[file] ?? []).includes(m));
      expect({ file, imports: importOf(forbidden).test(text) }).toMatchObject({ imports: false });
      for (const re of CODE) expect({ file, re: String(re), hit: re.test(text) }).toMatchObject({ hit: false });
    }
  });

  it("the exceptions are exactly the two modules, and nothing in them is wider than its reason", () => {
    expect(sources.filter((f) => importOf(["https"]).test(readFileSync(f, "utf8")))).toEqual(["ui/connect.ts"]);
    expect(sources.filter((f) => importOf(["child_process"]).test(readFileSync(f, "utf8"))).sort()).toEqual(["ui/connect.ts", "ui/persist.ts"]);
    expect(readFileSync("ui/connect.ts", "utf8")).not.toMatch(/process\.env\.\w*(?:TOKEN)\w*\s*=[^=]|console\.|writeFileSync|appendFile/); // the token is never logged or written to a file
    expect(readFileSync("ui/connect.ts", "utf8")).not.toMatch(/\bshell\s*:\s*true|(?<![.\w])exec\(|\bexecSync\(/); // arguments, never a shell string
    expect(readFileSync("ui/persist.ts", "utf8")).not.toMatch(/\bshell\s*:\s*true|(?<![.\w])exec\(|\bexecSync\(|["']merge["']|["']rebase["']|["']reset["']/); // no shell, and never a merge, rebase or reset
  });

  it("the server binds 127.0.0.1 and nothing else", () => {
    expect(readFileSync("ui/server.ts", "utf8")).toMatch(/\.listen\([^)]*"127\.0\.0\.1"/);
  });

  it.each(pages)("%s reaches only its own origin: no external url, socket or dynamic import", (file) => {
    const page = readFileSync(file, "utf8");
    expect(page).not.toMatch(/url\(|@import/); // no stylesheet fetch; urls in text and placeholders are fine
    expect(page).not.toMatch(/\b(WebSocket|XMLHttpRequest|EventSource|sendBeacon|importScripts)\b|\bimport\s*\(/);
    expect([...page.matchAll(/\bfetch\(([^,)]*)/g)].map((m) => m[1])).toEqual(["path"]); // the single api() helper
    expect(page).not.toMatch(/<(script|link|img|iframe)\b[^>]*\b(src|href)=/i);
  });

  it("the built bundle imports no module beyond the two exceptions", async () => {
    const out = join(tempDir("liftoff-ui-bundle-"), "liftoff-ui.mjs");
    await buildUi(out);
    const text = readFileSync(out, "utf8");
    expect(importOf(FORBIDDEN.filter((m) => !["https", "child_process"].includes(m))).test(text)).toBe(false);
  });

  it("the CLI bundle's sources never import ui/", () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : []));
    for (const f of walk("src")) expect({ f, imports: /from\s+["'][./]*\/ui\//.test(readFileSync(f, "utf8")) }).toMatchObject({ imports: false });
  });
});
