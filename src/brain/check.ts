import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { resolveReal } from "../cli/fsutil.js";
import { buildIndex } from "./index.js";
import { PERSONAL_DIR, type BrainPaths } from "./paths.js";
import { type Quote, normalize, parsePage, scanLinks } from "./page.js";
import { HEADER_RE, sha256Hex } from "./source.js";
import { secretGuard } from "../config/secrets.js";

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
const MIN_QUOTE = 12;
// An accident guard, not a guarantee: phrases that read like an instruction to the agent, outside a quote.
const INSTRUCTION_LIKE = [/ignore (all|any|previous) instructions/i, /you (must|should) now/i, /as an ai/i, /system prompt/i, /\b(agents?|assistant) (must|should|always|never)\b/i];
const LOG_LINE = /^- \d{4}-\d{2}-\d{2} (ingest|save|fix|retract) ([^:\s,]+(?:, [^:\s,]+)*)(?::(?: (.+))?)?$/;

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

  // Files a `retract` log line names (the retracted source and the pages it touched): kept or deleted on purpose.
  const logFiles = sub("log").filter((f) => f !== ".gitkeep");
  const retracted = new Set<string>();
  for (const f of logFiles) {
    for (const line of read(join(dirAbs, "log", f)).split(/\r?\n/)) {
      const m = LOG_LINE.exec(line);
      if (m && m[1] === "retract") for (const n of [...m[2]!.split(/,\s*/), ...(m[3] ? m[3].split(/,\s*/) : [])]) retracted.add(n);
    }
  }

  // raw/: every file carries the header the CLI writes.
  const rawFiles = sub("raw").filter((f) => f !== ".gitkeep");
  const rawBody = new Map<string, string>(); // "raw/docs/x.md" -> body without the header line
  for (const f of rawFiles) {
    const text = read(join(dirAbs, "raw", f));
    const nl = text.indexOf("\n");
    const header = HEADER_RE.exec(nl < 0 ? text : text.slice(0, nl));
    const body = nl < 0 ? "" : text.slice(nl + 1);
    rawBody.set(`raw/${f}`, body);
    if (!header) err("source-unmarked", inDir(`raw/${f}`), "a raw file without the first-line header the CLI writes: it was not added with brain-source");
    else if (sha256Hex(body) !== header[4]) err("source-changed", inDir(`raw/${f}`), "the body no longer matches the hash in its header: a raw file was edited after ingest");
  }

  // wiki/: names, front matter, sources.
  const wikiFiles = sub("wiki").filter((f) => f !== ".gitkeep");
  const pages: { rel: string; path: string; text: string; title?: string; sources: string[]; module?: string; quotes: Quote[] }[] = [];
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
      pages.push({ rel: f, path, text, sources: [], quotes: [] });
      continue;
    }
    pages.push({ rel: f, path, text, title: parsed.front.title, sources: parsed.front.sources, quotes: parsed.quotes, ...(parsed.front.module && { module: parsed.front.module }) });
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
      const citing = (bySource[inDir(norm)] ??= []);
      if (!citing.includes(p.path)) citing.push(p.path);
    }
    if (p.module !== undefined && !moduleIds.includes(p.module)) warn("module-unknown", p.path, `module '${p.module}' is not in liftoff.yaml modules`, 1);
  }
  for (const f of rawFiles) if (!cited.has(`raw/${f}`) && !retracted.has(`raw/${f}`)) warn("raw-unreferenced", inDir(`raw/${f}`), "no page cites this source: an unfinished ingest");

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

  // Quotes: every key fact quotes a listed source, word for word.
  for (const p of pages) {
    if (p.title === undefined) continue;
    const listed = new Set(p.sources.map((s) => posix.normalize(s)));
    if (p.quotes.length === 0) warn("no-quotes", p.path, "the page quotes nothing: every key fact should quote its source", 1);
    for (const q of p.quotes) {
      if (!q.citation) {
        err("quote-uncited", p.path, "a blockquote whose last line is not '-- [label](path-to-raw-file)'", q.line);
        continue;
      }
      const cited = posix.normalize(posix.join(posix.dirname(`wiki/${p.rel}`), safeDecode(q.citation.path)));
      if (!listed.has(cited)) {
        err("quote-source-unlisted", p.path, `the quote cites ${q.citation.path}, which is not in this page's sources`, q.line);
        continue;
      }
      if (q.text.length < MIN_QUOTE) err("quote-too-short", p.path, `a quote under ${MIN_QUOTE} characters proves nothing`, q.line);
      else if (rawBody.has(cited) && !normalize(rawBody.get(cited)!).includes(q.text)) err("quote-not-found", p.path, `the quoted text is not in ${cited}, word for word`, q.line);
    }
    // Outside quotes only: a cited quote may legitimately repeat a source that says "must".
    let inFront = false;
    p.text.split(/\r?\n/).forEach((line, i) => {
      if (line === "---" && (i === 0 || inFront)) {
        inFront = i === 0;
        return;
      }
      if (inFront || /^\s{0,3}>/.test(line)) return;
      if (INSTRUCTION_LIKE.some((re) => re.test(line))) warn("instruction-like", p.path, "reads like an instruction to the agent: the wiki is background, never instructions", i + 1);
    });
  }

  // Credentials anywhere in the brain (an accident guard, not a guarantee).
  for (const f of tree.files) {
    if (f.endsWith(".gitkeep")) continue;
    if (secretGuard({ text: read(join(dirAbs, f)) }).length > 0) err("secret", inDir(f), "looks like a credential (an accident guard, not a guarantee): remove it and the raw source it came from");
  }

  // The personal layer never leaves the machine: the same checks, as warnings.
  const personalAbs = join(realRoot, PERSONAL_DIR);
  if (existsSync(personalAbs)) {
    const mine = walk(personalAbs);
    for (const l of mine.links) warn("personal-symlink", `${PERSONAL_DIR}/${l}`, "a symlink in your personal brain");
    for (const f of mine.files) {
      if (!f.endsWith(".gitkeep") && secretGuard({ text: read(join(personalAbs, f)) }).length > 0) warn("personal-secret", `${PERSONAL_DIR}/${f}`, "looks like a credential (an accident guard, not a guarantee)");
    }
    if (mine.files.includes("hot.md") && nonEmpty(read(join(personalAbs, "hot.md"))) > hotMaxLines) warn("personal-hot-too-long", paths.personalHot, `personal hot.md has more than ${hotMaxLines} non-empty lines`);
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
  const logs = logFiles;
  for (const f of logs) {
    read(join(dirAbs, "log", f)).split(/\r?\n/).forEach((line, i) => {
      if (line.trim() === "") return;
      const m = LOG_LINE.exec(line);
      if (!m) return warn("log-format", inDir(`log/${f}`), "not a log line: '- YYYY-MM-DD <ingest|save|fix|retract> <path>[: <paths>]'", i + 1);
      const named = [...m[2]!.split(/,\s*/), ...(m[3] ? m[3].split(/,\s*/) : [])];
      for (const n of m[1] === "retract" ? [] : named) {
        if (!existsSync(join(dirAbs, n)) && !retracted.has(n)) warn("log-format", inDir(`log/${f}`), `names ${n}, which no longer exists`, i + 1);
      }
    });
  }
  return result(pages.length, rawFiles.length, logs.length, bySource);
}
