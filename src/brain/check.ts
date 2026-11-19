import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { resolveReal } from "../cli/fsutil.js";
import { buildIndex } from "./index.js";
import { type BrainPaths } from "./paths.js";
import { parsePage, scanLinks } from "./page.js";
import { HEADER_RE } from "./source.js";

export interface Finding {
  code: string;
  level: "error" | "warning";
  file: string; // relative to the repo root
  line?: number;
  message: string;
}
export interface CheckResult {
  errors: Finding[];
  warnings: Finding[];
  stats: { pages: number; raw: number; logs: number };
  bySource: Record<string, string[]>; // raw file -> pages that list it in `sources`
}
export interface CheckInput {
  realRoot: string;
  paths: BrainPaths;
  hotMaxLines: number;
  moduleIds: string[];
}

const PAGE_NAME = /^[a-z0-9][a-z0-9-]*\.md$/;
const LOG_LINE = /^- \d{4}-\d{2}-\d{2} (ingest|save|fix|retract) (\S+?)(?::(?: (.+))?)?$/;

// Every file under `abs`, as paths relative to it, and every symlink (never followed).
function walk(abs: string, rel = ""): { files: string[]; links: string[] } {
  const out = { files: [] as string[], links: [] as string[] };
  let names: string[];
  try {
    names = readdirSync(join(abs, rel)).sort();
  } catch {
    return out;
  }
  for (const name of names) {
    const r = rel === "" ? name : `${rel}/${name}`;
    const st = lstatSync(join(abs, r));
    if (st.isSymbolicLink()) out.links.push(r);
    else if (st.isDirectory()) {
      const sub = walk(abs, r);
      out.files.push(...sub.files);
      out.links.push(...sub.links);
    } else out.files.push(r);
  }
  return out;
}

const safeDecode = (s: string): string => {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
};
const read = (abs: string): string => readFileSync(abs, "utf8");
const nonEmpty = (text: string): number => text.split(/\r?\n/).filter((l) => l.trim() !== "").length;

// Read-only. Every rule of the plan's table that does not need the raw bodies or the quotes (those are added next).
export function checkBrain({ realRoot, paths, hotMaxLines, moduleIds }: CheckInput): CheckResult {
  const findings: Finding[] = [];
  const add = (level: Finding["level"], code: string, file: string, message: string, line?: number) =>
    findings.push({ code, level, file, message, ...(line !== undefined && { line }) });
  const err = (code: string, file: string, message: string, line?: number) => add("error", code, file, message, line);
  const warn = (code: string, file: string, message: string, line?: number) => add("warning", code, file, message, line);
  const result = (pages = 0, raw = 0, logs = 0, bySource: CheckResult["bySource"] = {}): CheckResult => {
    const order = (a: Finding, b: Finding) => (a.file < b.file ? -1 : a.file > b.file ? 1 : (a.line ?? 0) - (b.line ?? 0) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    return { errors: findings.filter((f) => f.level === "error").sort(order), warnings: findings.filter((f) => f.level === "warning").sort(order), stats: { pages, raw, logs }, bySource };
  };

  const dirAbs = join(realRoot, paths.dir);
  if (!existsSync(dirAbs)) {
    err("brain-missing", paths.dir, `${paths.dir} not found: run brain-init`);
    return result();
  }
  if (resolveReal(dirAbs) !== dirAbs) {
    err("symlink", paths.dir, `${paths.dir} is or goes through a symlink`);
    return result();
  }
  for (const [rel, what] of [[paths.hot, "hot.md"], [paths.index, "index.md"], [paths.raw, "raw/"], [paths.wiki, "wiki/"]] as const) {
    if (!existsSync(join(realRoot, rel))) err("brain-missing", rel, `${what} not found: run brain-init`);
  }

  const tree = walk(dirAbs);
  for (const l of tree.links) err("symlink", `${paths.dir}/${l}`, "a symlink inside the brain: it could point outside the repo");
  const inDir = (rel: string) => `${paths.dir}/${rel}`;
  const sub = (folder: string) => tree.files.filter((f) => f.startsWith(`${folder}/`)).map((f) => f.slice(folder.length + 1));

  // raw/: every file carries the header the CLI writes.
  const rawFiles = sub("raw").filter((f) => f !== ".gitkeep");
  for (const f of rawFiles) {
    const first = read(join(dirAbs, "raw", f)).split("\n", 1)[0] ?? "";
    if (!HEADER_RE.test(first)) err("source-unmarked", inDir(`raw/${f}`), "a raw file without the first-line header the CLI writes: it was not added with brain-source");
  }

  // wiki/: names, front matter, sources.
  const wikiFiles = sub("wiki").filter((f) => f !== ".gitkeep");
  const pages: { rel: string; path: string; text: string; title?: string; sources: string[]; module?: string }[] = [];
  for (const f of wikiFiles) {
    const path = inDir(`wiki/${f}`);
    if (!PAGE_NAME.test(f.split("/").pop()!)) {
      err("page-name", path, "wiki files are lowercase kebab-case .md files (a-z, 0-9 and -)");
      continue;
    }
    const text = read(join(dirAbs, "wiki", f));
    const parsed = parsePage(text);
    if (!parsed.ok) {
      for (const m of parsed.errors) err("frontmatter", path, m, 1);
      pages.push({ rel: f, path, text, sources: [] });
      continue;
    }
    pages.push({ rel: f, path, text, title: parsed.front.title, sources: parsed.front.sources, ...(parsed.front.module && { module: parsed.front.module }) });
  }

  const cited = new Set<string>();
  const bySource: Record<string, string[]> = {};
  for (const p of pages) {
    for (const s of p.sources) {
      const norm = posix.normalize(s);
      if (!norm.startsWith("raw/") || norm.startsWith("..") || !existsSync(join(dirAbs, norm)) || !lstatSync(join(dirAbs, norm)).isFile()) {
        err("source-missing", p.path, `source '${s}' is not an existing file under raw/`, 1);
        continue;
      }
      cited.add(norm);
      (bySource[inDir(norm)] ??= []).push(p.path);
    }
    if (p.module !== undefined && !moduleIds.includes(p.module)) warn("module-unknown", p.path, `module '${p.module}' is not in liftoff.yaml modules`, 1);
  }
  for (const f of rawFiles) if (!cited.has(`raw/${f}`)) warn("raw-unreferenced", inDir(`raw/${f}`), "no page cites this source: an unfinished ingest");

  // Links: pages, hot.md and README.md. A link must land on an existing file or folder inside the brain.
  const linkedPages = new Map<string, Set<string>>(); // page rel path -> pages linking to it
  const linkCheck: { rel: string; text: string; isPage: boolean }[] = [
    ...pages.map((p) => ({ rel: `wiki/${p.rel}`, text: p.text, isPage: true })),
    ...["hot.md", "README.md"].filter((n) => existsSync(join(dirAbs, n))).map((n) => ({ rel: n, text: read(join(dirAbs, n)), isPage: false })),
  ];
  for (const f of linkCheck) {
    for (const l of scanLinks(f.text)) {
      const target = posix.normalize(posix.join(posix.dirname(f.rel), safeDecode(l.target)));
      if (target.startsWith("..") || !existsSync(join(dirAbs, target))) err("link-broken", inDir(f.rel), `link '${l.target}' does not point at a file inside the brain`, l.line);
      else if (f.isPage && target !== f.rel) (linkedPages.get(target) ?? linkedPages.set(target, new Set()).get(target)!).add(f.rel);
    }
  }
  for (const p of pages) if (p.title !== undefined && !linkedPages.has(`wiki/${p.rel}`)) warn("orphan", p.path, "no other page links to this page");

  const seen = new Map<string, string>();
  for (const p of pages) {
    if (p.title === undefined) continue;
    const key = p.title.toLowerCase();
    if (seen.has(key)) warn("duplicate-title", p.path, `same title as ${seen.get(key)}: one page per idea`, 1);
    else seen.set(key, p.path);
  }

  // hot.md length, generated index, log lines.
  if (existsSync(join(dirAbs, "hot.md")) && nonEmpty(read(join(dirAbs, "hot.md"))) > hotMaxLines) {
    err("hot-too-long", paths.hot, `hot.md has more than ${hotMaxLines} non-empty lines: keep it short (brain.hotMaxLines)`);
  }
  if (existsSync(join(dirAbs, "index.md"))) {
    // Same input as the brain-index command: every .md under wiki/, whatever its name.
    const want = buildIndex(wikiFiles.filter((f) => f.endsWith(".md")).map((f) => ({ path: f, text: read(join(dirAbs, "wiki", f)) }))).content;
    if (read(join(dirAbs, "index.md")) !== want) err("index-stale", paths.index, "index.md is out of date: run brain-index --write");
  }
  const logs = sub("log").filter((f) => f !== ".gitkeep");
  for (const f of logs) {
    read(join(dirAbs, "log", f)).split(/\r?\n/).forEach((line, i) => {
      if (line.trim() === "") return;
      const m = LOG_LINE.exec(line);
      if (!m) return warn("log-format", inDir(`log/${f}`), "not a log line: '- YYYY-MM-DD <ingest|save|fix|retract> <path>[: <paths>]'", i + 1);
      const named = [m[2]!, ...(m[3] ? m[3].split(/,\s*/) : [])];
      for (const n of m[1] === "retract" ? [] : named) {
        if (!existsSync(join(dirAbs, n))) warn("log-format", inDir(`log/${f}`), `names ${n}, which no longer exists`, i + 1);
      }
    });
  }
  return result(pages.length, rawFiles.length, logs.length, bySource);
}
