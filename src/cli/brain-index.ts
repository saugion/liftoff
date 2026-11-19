import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildIndex, type IndexPage } from "../brain/index.js";
import { brainPaths, symlinkProblem } from "../brain/paths.js";
import { NO_BRAIN, brainFail } from "./brain-init.js";
import { atomicWrite, resolveReal } from "./fsutil.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import type { Handler } from "./types.js";

// Every .md under the wiki folder, as a path relative to it. Symlinks were refused before this runs.
function wikiPages(wikiAbs: string, prefix = ""): IndexPage[] {
  return readdirSync(join(wikiAbs, prefix)).sort().flatMap((name) => {
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    if (lstatSync(join(wikiAbs, rel)).isDirectory()) return wikiPages(wikiAbs, rel);
    return name.endsWith(".md") ? [{ path: rel, text: readFileSync(join(wikiAbs, rel), "utf8") }] : [];
  });
}

// Builds index.md from the pages' front matter; with --write writes it only when it changed.
export const brainIndex: Handler = ({ root, write }) => {
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  if (!read.config.brain) return brainFail("no-brain", NO_BRAIN);

  const realRoot = resolveReal(root);
  const paths = brainPaths(read.config.brain.dir);
  const link = symlinkProblem(realRoot, paths);
  if (link) return brainFail("brain-invalid", `${link} is or contains a symlink: the brain must be plain folders inside the repo`, { file: link });
  if (!existsSync(join(realRoot, paths.wiki))) return brainFail("brain-invalid", `${paths.wiki} not found: run brain-init first`, { file: paths.wiki });

  const { content, skipped } = buildIndex(wikiPages(join(realRoot, paths.wiki)));
  const file = join(realRoot, paths.index);
  const changed = !existsSync(file) || readFileSync(file, "utf8") !== content;
  if (write && changed) atomicWrite(file, content);
  return { exitCode: 0, body: { ok: true, path: paths.index, content, changed, skipped, written: write === true && changed } };
};
