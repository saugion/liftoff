import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildIndex, type IndexPage } from "../brain/index.js";
import { brainPaths, symlinkProblem } from "../brain/paths.js";
import { buildHandbookIndex } from "../handbook/index.js";
import { handbookPaths } from "../handbook/paths.js";
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
const buildBrainIndex: Handler = ({ root, write }) => {
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
  // The handbook's own index, when the handbook is on (a no-op otherwise, so a brain without one answers exactly as before).
  let handbook: { path: string; content: string; changed: boolean; skipped: { id: string; errors: string[] }[]; written: boolean } | undefined;
  if (read.config.brain.handbook) {
    const hp = handbookPaths(read.config.brain.dir);
    const dirAbs = join(realRoot, hp.dir);
    const pages = existsSync(dirAbs) ? readdirSync(dirAbs).sort().filter((n) => n.endsWith(".md") && n !== "index.md").map((n) => ({ id: n.slice(0, -3), text: readFileSync(join(dirAbs, n), "utf8") })) : [];
    const built = buildHandbookIndex(pages);
    const hfile = join(realRoot, hp.index);
    const hchanged = existsSync(dirAbs) && (!existsSync(hfile) || readFileSync(hfile, "utf8") !== built.content);
    if (write && hchanged) atomicWrite(hfile, built.content);
    handbook = { path: hp.index, content: built.content, changed: hchanged, skipped: built.skipped, written: write === true && hchanged };
  }
  return { exitCode: 0, body: { ok: true, path: paths.index, content, changed, skipped, written: write === true && changed, ...(handbook && { handbook }) } };
};

// With --hook (the plugin's Stop hook) the command never fails: no brain, no wiki or a broken one is reported in the body
// and the exit code is 0, so a repo without a brain sees nothing. Without --hook it behaves as before.
export const brainIndex: Handler = (ctx) => {
  const out = buildBrainIndex(ctx);
  if (!ctx.hook || out.exitCode === 0) return out;
  return { exitCode: 0, body: { ok: true, skipped: true, reason: out.body.errors } };
};
