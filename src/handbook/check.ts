// The handbook's part of the brain health check. Read-only. Findings have the brain's shape; none of them reaches outside the
// repo. Credentials anywhere in the brain folder are already an error of `brain-check` (handbook included).
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { type Finding } from "../brain/check.js";
import { instructionLike, weakensBar } from "../brain/guards.js";
import { normalize, quotesOf, scanLinks } from "../brain/page.js";
import { HEADER_RE } from "../brain/source.js";
import { compareVersions } from "../config/version.js";
import { catalogPage } from "./catalog.js";
import { buildHandbookIndex } from "./index.js";
import { MAX_PAGE_LINES, ORIGIN_LIFTOFF, fingerprint, parseHandbookPage } from "./page.js";
import { PAGE_ID, type HandbookPaths } from "./paths.js";
import { parseRetired } from "./retired.js";
import { drift, statusOf, type StatusRow } from "./status.js";
import { CATALOG } from "./catalog.js";
import { type ContextSettings, checkContext } from "./context.js";

export interface HandbookCheckInput {
  realRoot: string;
  brainDir: string;
  paths: HandbookPaths;
  maxPages: number;
  reviewAfterDays: number;
  installedVersion: string;
  moduleIds: string[];
  today: string; // YYYY-MM-DD
  context: false | ContextSettings; // the context-hygiene warnings, or false for none
  instructionFiles: string[]; // CLAUDE.md, AGENTS.md, module AGENTS.md, CONSTRAINTS.md (relative to the root)
}

const MIN_QUOTE = 12;
const DAY = 86_400_000;
const days = (from: string, to: string): number => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export function checkHandbook(i: HandbookCheckInput): { findings: Finding[]; pages: number; rows: StatusRow[] } {
  const findings: Finding[] = [];
  const add = (level: Finding["level"], code: string, file: string, message: string, line?: number) => findings.push({ code, level, file, message, ...(line !== undefined && { line }) });
  const dirAbs = join(i.realRoot, i.paths.dir);
  const rel = (n: string) => `${i.paths.dir}/${n}`;
  if (!existsSync(dirAbs)) {
    add("warning", "handbook-missing", i.paths.dir, `${i.paths.dir} not found: run handbook-init`);
    if (i.context) findings.push(...checkContext({ realRoot: i.realRoot, settings: i.context, instructionFiles: i.instructionFiles }));
    return { findings, pages: 0, rows: [] };
  }

  const texts = new Map<string, string>();
  for (const n of readdirSync(dirAbs).sort()) {
    if (n === "index.md" || n === "retired.txt") continue;
    if (lstatSync(join(dirAbs, n)).isDirectory() || !n.endsWith(".md")) { add("warning", "handbook-stray-file", rel(n), "not a handbook page: pages are .md files directly in the handbook folder"); continue; }
    if (!PAGE_ID.test(n.slice(0, -3))) { add("error", "handbook-page-name", rel(n), "page files are lowercase kebab-case .md files (a-z, 0-9 and -)"); continue; }
    texts.set(n.slice(0, -3), readFileSync(join(dirAbs, n), "utf8"));
  }
  if (texts.size > i.maxPages) add("error", "handbook-full", i.paths.dir, `${texts.size} pages, more than brain.handbook.maxPages (${i.maxPages}): retire a page`);

  const retiredFile = join(i.realRoot, i.paths.retired);
  const rp = existsSync(retiredFile) ? parseRetired(readFileSync(retiredFile, "utf8")) : { retired: [], bad: [] };
  for (const b of rp.bad) add("warning", "handbook-retired-format", i.paths.retired, "not a retired line: '<id> <YYYY-MM-DD> <reason>'", b.line);
  const retiredIds = new Set(rp.retired.map((r) => r.id));
  for (const id of retiredIds) if (texts.has(id)) add("warning", "handbook-retired-present", rel(`${id}.md`), `${id} is in retired.txt but its file is back: delete it, or take it out of retired.txt`);

  const rows: StatusRow[] = [];
  for (const [id, text] of texts) {
    const file = rel(`${id}.md`);
    const page = parseHandbookPage(text);
    if (!page.ok) { for (const m of page.errors) add("error", "handbook-frontmatter", file, m, 1); continue; }
    const { front, body } = page;
    if (page.lines > MAX_PAGE_LINES) add("error", "handbook-too-long", file, `${page.lines} lines, more than ${MAX_PAGE_LINES}: split it or cut it, so reading one page stays cheap`);
    const stub = front.status === "stub";
    if (stub) add("warning", "handbook-stub", file, "not filled in yet: answer its questions, remove `_TBD_` and `status: stub` in one merge request (agents skip it until then)");
    else if (days(front.updated, i.today) > i.reviewAfterDays) add("warning", "handbook-review-due", file, `not updated for ${days(front.updated, i.today)} days (brain.handbook.reviewAfterDays ${i.reviewAfterDays}): still true? Settle it in a merge request`);
    if (front.module !== undefined && !i.moduleIds.includes(front.module)) add("warning", "handbook-module-unknown", file, `module '${front.module}' is not in liftoff.yaml modules`, 1);

    const origin = ORIGIN_LIFTOFF.exec(front.origin);
    if (origin && (compareVersions(origin[1]!, i.installedVersion) ?? 0) > 0) add("error", "handbook-origin-newer", file, `origin ${front.origin} is newer than the installed plugin ${i.installedVersion}: update the plugin`, 1);
    const shipped = catalogPage(id);
    if (origin && !shipped) add("warning", "handbook-origin-unknown", file, `origin ${front.origin} but LiftOff does not ship a page '${id}': set origin: team and remove base if it is yours now`, 1);
    const untouched = origin !== null && front.base === fingerprint(front, body);

    // A page the team wrote or changed is text an agent will read while acting: say so when it reads like an order or lowers the bar.
    if (!untouched && !stub) {
      let inFront = false, inHow = false;
      text.replace(/\r\n?/g, "\n").split("\n").forEach((line, n) => {
        if (line === "---" && (n === 0 || inFront)) { inFront = n === 0; return; }
        if (inFront || /^\s{0,3}>/.test(line)) return;
        const h = /^##\s+(.+?)\s*$/.exec(line);
        if (h) inHow = h[1] === "How here";
        if (instructionLike(line)) add("warning", "handbook-instruction-like", file, "reads like an instruction aimed at the agent itself: a page is guidance for a step LiftOff already performs, never a new order", n + 1);
        if (inHow && weakensBar(line)) add("warning", "handbook-weakens-bar", file, "reads like it lowers the quality bar: a page may add detail to a step, never relax CONSTRAINTS.md", n + 1);
      });
    }

    // Links stay inside the brain folder and land on a file.
    for (const l of scanLinks(text)) {
      const target = posix.normalize(posix.join(i.paths.dir.slice(i.brainDir.length + 1), safeDecode(l.target)));
      if (target.startsWith("..") || !existsSync(join(i.realRoot, i.brainDir, target))) add("error", "handbook-link-broken", file, `link '${l.target}' does not point at a file inside the brain`, l.line);
    }

    // A case that cites real sources: each source exists under raw/, and every quote is word for word in one of them.
    if (front.sources) {
      const raw = new Map<string, string>();
      for (const s of front.sources) {
        const norm = posix.normalize(s);
        const abs = join(i.realRoot, i.brainDir, norm);
        if (!norm.startsWith("raw/") || norm.startsWith("..") || !existsSync(abs) || !lstatSync(abs).isFile()) { add("error", "handbook-source-missing", file, `source '${s}' is not an existing file under raw/`, 1); continue; }
        const t = readFileSync(abs, "utf8");
        const nl = t.indexOf("\n");
        raw.set(norm, nl >= 0 && HEADER_RE.test(t.slice(0, nl)) ? t.slice(nl + 1) : t);
      }
      const listed = new Set(front.sources.map((s) => posix.normalize(s)));
      for (const q of quotesOf(text)) {
        if (!q.citation) { add("error", "handbook-quote-uncited", file, "a blockquote whose last line is not '-- [label](path-to-raw-file)'", q.line); continue; }
        const cited = posix.normalize(posix.join(posix.dirname(i.paths.dir.slice(i.brainDir.length + 1) + "/x"), safeDecode(q.citation.path)));
        if (!listed.has(cited)) { add("error", "handbook-quote-source-unlisted", file, `the quote cites ${q.citation.path}, which is not in this page's sources`, q.line); continue; }
        if (q.text.length < MIN_QUOTE) add("error", "handbook-quote-too-short", file, `a quote under ${MIN_QUOTE} characters proves nothing`, q.line);
        else if (raw.has(cited) && !normalize(raw.get(cited)!).includes(q.text)) add("error", "handbook-quote-not-found", file, `the quoted text is not in ${cited}, word for word`, q.line);
      }
    }
  }

  // The generated index must match the pages as they are.
  const indexAbs = join(i.realRoot, i.paths.index);
  const want = buildHandbookIndex([...texts].map(([id, text]) => ({ id, text }))).content;
  if (texts.size > 0 && (!existsSync(indexAbs) || readFileSync(indexAbs, "utf8") !== want)) add("error", "handbook-index-stale", i.paths.index, "the handbook index is out of date: run brain-index --write");

  // Drift against what LiftOff ships: said, never imposed.
  for (const p of CATALOG) rows.push(statusOf(p, texts.get(p.id), retiredIds.has(p.id)));
  const d = drift(rows);
  const behind = d.newPractices.length + d.updates.length + d.conflicts.length;
  if (behind > 0) {
    const parts = [d.newPractices.length ? `${d.newPractices.length} new (${d.newPractices.join(", ")})` : "", d.updates.length ? `${d.updates.length} with an update (${d.updates.join(", ")})` : "", d.conflicts.length ? `${d.conflicts.length} changed by both (${d.conflicts.join(", ")})` : ""].filter(Boolean);
    add("warning", "handbook-drift", i.paths.dir, `${behind} shipped pages differ from yours: ${parts.join("; ")}. Run handbook-status; take what the team wants, one page at a time`);
  }
  if (i.context) findings.push(...checkContext({ realRoot: i.realRoot, settings: i.context, instructionFiles: i.instructionFiles }));
  return { findings, pages: texts.size, rows };
}

const safeDecode = (s: string): string => {
  try { return decodeURI(s); } catch { return s; }
};
