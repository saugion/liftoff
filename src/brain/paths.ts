import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isInside, resolveReal } from "../cli/fsutil.js";

export const PERSONAL_DIR = ".liftoff/brain";

// Every path is relative to the repo root, with forward slashes.
export interface BrainPaths {
  dir: string;
  hot: string;
  index: string;
  raw: string;
  wiki: string;
  log: string;
  personalHot: string;
  personalNotes: string;
}

// `brain.dir` as the config validated it ("brain", "docs/brain/", "./brain"): one clean relative path.
export const cleanDir = (dir: string): string => dir.split(/[\\/]/).filter((s) => s !== "" && s !== ".").join("/");

export function brainPaths(dirSetting: string): BrainPaths {
  const dir = cleanDir(dirSetting);
  return {
    dir,
    hot: `${dir}/hot.md`,
    index: `${dir}/index.md`,
    raw: `${dir}/raw`,
    wiki: `${dir}/wiki`,
    log: `${dir}/log`,
    personalHot: `${PERSONAL_DIR}/hot.md`,
    personalNotes: `${PERSONAL_DIR}/notes`,
  };
}

// A symlink in or on the way to a brain folder could send a write outside the repo. Returns the offending path
// (relative to the root) or undefined. `realRoot` must already be a real path.
export function symlinkProblem(realRoot: string, paths: BrainPaths): string | undefined {
  for (const rel of [paths.dir, PERSONAL_DIR]) {
    const abs = join(realRoot, rel);
    const real = resolveReal(abs);
    if (!isInside(realRoot, real) || real !== abs) return rel;
    const found = walkForLink(abs, rel);
    if (found) return found;
  }
  return undefined;
}

function walkForLink(abs: string, rel: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return undefined; // does not exist yet
  }
  for (const name of entries.sort()) {
    const child = join(abs, name);
    const stat = lstatSync(child);
    if (stat.isSymbolicLink()) return `${rel}/${name}`;
    if (stat.isDirectory()) {
      const found = walkForLink(child, `${rel}/${name}`);
      if (found) return found;
    }
  }
  return undefined;
}
