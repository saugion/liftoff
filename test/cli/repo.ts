import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/cli/main.js";
import { INSTALLED_VERSION } from "../../src/cli/version.js";
import { readConfig } from "../../src/config/index.js";
import { renderAgentFiles } from "../../src/render/index.js";
import { tempDir } from "../helpers.js";

export interface Options {
  targets?: string;
  modules?: string[];
  agentsMd?: boolean | string[]; // true: root + every module; false: none; list: exactly these paths
  extra?: string;
  pluginVersion?: string; // the pin in liftoff.yaml (default "0.1", below the installed 0.1.0)
}

export function makeRepo(opts: Options = {}): string {
  const { targets = "[claude-code, copilot]", modules = ["src/api", "apps/web"], agentsMd = true, extra = "", pluginVersion = "0.1" } = opts;
  const dir = tempDir();
  const items = modules.map((m, i) => `    - id: m${i}\n      path: ${m}\n`).join("");
  writeFileSync(
    join(dir, "liftoff.yaml"),
    `liftoff: 1\nplugin:\n  version: "${pluginVersion}"\nproject:\n  name: acme\n  kind: new\nagents:\n  targets: ${targets}\n${modules.length > 0 ? `modules:\n  items:\n${items}` : ""}${extra}`,
  );
  const paths = agentsMd === true ? ["AGENTS.md", ...modules.map((m) => `${m}/AGENTS.md`)] : agentsMd === false ? [] : agentsMd;
  for (const p of paths) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), "# rules\n");
  }
  return dir;
}

export const render = (dir: string, ...extra: string[]) => {
  const r = run(["render", "--root", dir, ...extra], "/");
  return { exitCode: r.exitCode, body: JSON.parse(r.stdout) as Record<string, any>, stderr: r.stderr };
};

export const list = (dir: string, prefix = ""): string[] =>
  readdirSync(join(dir, prefix), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? list(dir, join(prefix, e.name)) : [join(prefix, e.name)]))
    .sort();

export const expectedFiles = (dir: string): Record<string, string> => {
  const config = readConfig(join(dir, "liftoff.yaml"));
  if (!config.ok) throw new Error("bad test config");
  const r = renderAgentFiles(config.value, { generatorVersion: INSTALLED_VERSION });
  if (!r.ok) throw new Error("bad test render");
  return Object.fromEntries(r.value.map((f) => [f.path, f.content]));
};

