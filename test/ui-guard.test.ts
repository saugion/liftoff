import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildUi } from "../scripts/build-ui.mjs";
import { tempDir } from "./helpers.js";

// The CLI guard (static-guard.test.ts) allows no network module at all. The control panel may use node:http and
// nothing else: it listens on 127.0.0.1, it never connects out, it starts no process, and its page talks only to
// its own origin. Keep this list in step with docs/decisions/DECISIONS.md.
const FORBIDDEN = "net|dns|https|http2|tls|dgram|child_process|worker_threads|cluster";
const IMPORT = new RegExp(`(?:from\\s*|require\\(\\s*|import\\(\\s*|import\\s+)["'](?:node:)?(?:${FORBIDDEN})["']`);
const CODE = [IMPORT, /\bfetch\s*\(/, /\bWebSocket\b/, /\bimport\s*\(/, /\.listen\([^)]*["'](?:0\.0\.0\.0|::)["']/];

const sources = readdirSync("ui").filter((f) => f.endsWith(".ts")).map((f) => join("ui", f));

describe("ui guard", () => {
  it("ui/*.ts uses no outbound network, no child process and never binds a public address", () => {
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const re of CODE) expect({ file, re: String(re), hit: re.test(text) }).toMatchObject({ hit: false });
    }
  });

  it("the server binds 127.0.0.1 and nothing else", () => {
    expect(readFileSync("ui/server.ts", "utf8")).toMatch(/\.listen\([^)]*"127\.0\.0\.1"/);
  });

  it("the page reaches only its own origin: no external url, socket or dynamic import", () => {
    const page = readFileSync("ui/page.html", "utf8");
    expect(page).not.toMatch(/url\(|@import/); // no stylesheet fetch; urls in text and placeholders are fine
    expect(page).not.toMatch(/\b(WebSocket|XMLHttpRequest|EventSource|sendBeacon|importScripts)\b|\bimport\s*\(/);
    expect([...page.matchAll(/\bfetch\(([^,)]*)/g)].map((m) => m[1])).toEqual(["path"]); // the single api() helper
    expect(page).not.toMatch(/<(script|link|img|iframe)\b[^>]*\b(src|href)=/i);
  });

  it("the built bundle imports no forbidden module", async () => {
    const out = join(tempDir("liftoff-ui-bundle-"), "liftoff-ui.mjs");
    await buildUi(out);
    expect(IMPORT.test(readFileSync(out, "utf8"))).toBe(false);
  });

  it("the CLI bundle's sources never import ui/", () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : []));
    for (const f of walk("src")) expect({ f, imports: /from\s+["'][./]*\/ui\//.test(readFileSync(f, "utf8")) }).toMatchObject({ imports: false });
  });
});
