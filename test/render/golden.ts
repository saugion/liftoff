import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { type Config, readConfig } from "../../src/config/index.js";
import { type RenderedFile, renderAgentFiles } from "../../src/render/index.js";

export const GOLDEN_VERSION = "0.1.0";
const ROOT = join(import.meta.dirname, "..", "fixtures", "render");

export const cases = (): string[] => readdirSync(ROOT).filter((n) => statSync(join(ROOT, n)).isDirectory()).sort();

export function loadConfig(name: string): Config {
  const r = readConfig(join(ROOT, name, "liftoff.yaml"));
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.errors)}`);
  return r.value;
}

// expected/ holds one "<path>.expected" per rendered file (the suffix keeps agents from loading fixtures as instructions).
export function expectedFiles(name: string): Record<string, string> {
  const dir = join(ROOT, name, "expected");
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).replace(/\.expected$/, "").split("\\").join("/")] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

export function render(config: Config, generatorVersion = GOLDEN_VERSION): RenderedFile[] {
  const r = renderAgentFiles(config, { generatorVersion });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
}

export const asMap = (files: RenderedFile[]): Record<string, string> => Object.fromEntries(files.map((f) => [f.path, f.content]));
