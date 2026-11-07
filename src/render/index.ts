import type { Config, ConfigError, Result } from "../config/index.js";
import { claudeFile } from "./claude.js";
import type { RenderOptions, RenderedFile } from "./types.js";

export type { RenderOptions, RenderedFile } from "./types.js";
export { bodyHash, isUnedited, parseMarker } from "./marker.js";

// Forward slashes, no "./" or "." segments, no trailing or doubled slashes.
export const normalizeModulePath = (p: string): string =>
  p
    .split(/[\\/]+/)
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");

const byPath = (a: RenderedFile, b: RenderedFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// Pure: config in, files out. No I/O, no clock, nothing machine-specific, so the output is deterministic.
export function renderAgentFiles(config: Config, opts: RenderOptions): Result<RenderedFile[]> {
  const items = config.modules?.items ?? [];
  const errors: ConfigError[] = [];
  const firstUse = new Map<string, number>();
  const paths = items.map((item, i) => {
    const path = normalizeModulePath(item.path);
    const pointer = `/modules/items/${i}/path`;
    if (path === "") {
      errors.push({ path: pointer, message: "module path is the repo root; for a single-app repo leave modules.items empty (the root AGENTS.md covers it)" });
    } else if (firstUse.has(path)) {
      errors.push({ path: pointer, message: `module '${item.id}' has the same path as module '${items[firstUse.get(path)!]!.id}' (${path})` });
    } else {
      firstUse.set(path, i);
    }
    return path;
  });
  if (errors.length > 0) return { ok: false, errors };

  const files: RenderedFile[] = [];
  if (config.agents.targets.includes("claude-code")) {
    files.push(claudeFile("CLAUDE.md", opts.generatorVersion), ...paths.map((p) => claudeFile(`${p}/CLAUDE.md`, opts.generatorVersion)));
  }
  return { ok: true, value: files.sort(byPath) };
}
