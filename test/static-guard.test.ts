import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildTempBundle } from "./helpers.js";

// The primary "no network, no child process" guarantee (Node's permission model does not cover the network).
const FORBIDDEN_MODULES = "net|dns|http|https|http2|tls|dgram|child_process|worker_threads";
const checks: [string, RegExp][] = [
  ["forbidden module import", new RegExp(`(?:from\\s*|require\\(\\s*|import\\(\\s*|import\\s+)["'](?:node:)?(?:${FORBIDDEN_MODULES})["']`)],
  ["fetch()", /\bfetch\s*\(/],
  ["WebSocket", /\bWebSocket\b/],
  ["dynamic import()", /\bimport\s*\(/],
];

export function violations(source: string): string[] {
  return checks.filter(([, re]) => re.test(source)).map(([name]) => name);
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });

describe("guard self-check (it must be able to fail)", () => {
  it.each([
    ['import net from "node:net";', "forbidden module import"],
    ['import { spawn } from "child_process";', "forbidden module import"],
    ['const h = require("https");', "forbidden module import"],
    ['await fetch("http://x")', "fetch()"],
    ["new WebSocket(u)", "WebSocket"],
    ['await import("x")', "dynamic import()"],
  ])("flags %s", (src, name) => {
    expect(violations(src)).toContain(name);
  });

  it("does not flag allowed modules", () => {
    expect(violations('import { readFileSync } from "node:fs"; import { resolve } from "node:path";')).toEqual([]);
  });
});

describe("source and bundle", () => {
  it("src/ has no network, child-process, fetch or dynamic-import use", () => {
    for (const file of walk("src")) expect({ file, found: violations(readFileSync(file, "utf8")) }).toEqual({ file, found: [] });
  });

  it("the built bundle has none either", async () => {
    const { file } = await buildTempBundle();
    expect(violations(readFileSync(file, "utf8"))).toEqual([]);
  });
});
