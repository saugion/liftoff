import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { symlinkProblem } from "../brain/paths.js";
import { brainPaths } from "../brain/paths.js";
import { secretGuard } from "../config/secrets.js";
import { CATALOG, catalogPage, latest, revisionOf } from "../handbook/catalog.js";
import { buildHandbookIndex } from "../handbook/index.js";
import { PAGE_ID, type HandbookPaths, handbookPaths, pageFile } from "../handbook/paths.js";
import { parseRetired, retiredLine } from "../handbook/retired.js";
import { type StatusRow, drift, statusOf } from "../handbook/status.js";
import { atomicWrite, resolveReal } from "./fsutil.js";
import { today } from "./lesson-add.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import type { Handler, Outcome } from "./types.js";

type Code = "no-brain" | "no-handbook" | "brain-invalid" | "usage" | "handbook-invalid";
const fail = (code: Code, message: string, extra: object = {}, exitCode: 1 | 2 = 1): Outcome => ({ exitCode, body: { ok: false, errors: [{ code, message, ...extra }] } });
export const NO_HANDBOOK = "liftoff.yaml has no brain.handbook: the lead turns the handbook on (Brain skill, Setup)";

interface Loaded { realRoot: string; paths: HandbookPaths; maxPages: number; reviewAfterDays: number; teamText: Map<string, string>; retired: ReturnType<typeof parseRetired>["retired"]; badRetired: { line: number; text: string }[] }
const loadFail = (o: Outcome): { fail: Outcome } => ({ fail: o });

// Config, folder and files of the handbook, read once. Read-only.
function load(root: string): Loaded | { fail: Outcome } {
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return loadFail({ exitCode: 1, body: { ok: false, errors: readFailure(root, read) } });
  const { brain } = read.config;
  if (!brain) return loadFail(fail("no-brain", "liftoff.yaml has no brain section: the lead enables the brain first (Brain skill, Setup)"));
  if (!brain.handbook) return loadFail(fail("no-handbook", NO_HANDBOOK));
  const realRoot = resolveReal(root);
  const link = symlinkProblem(realRoot, brainPaths(brain.dir));
  if (link) return loadFail(fail("brain-invalid", `${link} is or contains a symlink: the brain must be plain folders inside the repo`, { file: link }));
  const paths = handbookPaths(brain.dir);
  const teamText = new Map<string, string>();
  const dirAbs = join(realRoot, paths.dir);
  if (existsSync(dirAbs)) {
    for (const n of readdirSync(dirAbs).sort()) {
      if (n.endsWith(".md") && n !== "index.md" && PAGE_ID.test(n.slice(0, -3))) teamText.set(n.slice(0, -3), readFileSync(join(dirAbs, n), "utf8"));
    }
  }
  const rp = existsSync(join(realRoot, paths.retired)) ? parseRetired(readFileSync(join(realRoot, paths.retired), "utf8")) : { retired: [], bad: [] };
  return { realRoot, paths, maxPages: brain.handbook.maxPages, reviewAfterDays: brain.handbook.reviewAfterDays, teamText, retired: rp.retired, badRetired: rp.bad };
}

export function rowsOf(h: Loaded): StatusRow[] {
  const retiredIds = new Set(h.retired.map((r) => r.id));
  const rows = CATALOG.map((p) => statusOf(p, h.teamText.get(p.id), retiredIds.has(p.id)));
  for (const id of h.teamText.keys()) if (!catalogPage(id)) rows.push({ id, ...teamOnly(h.teamText.get(id)!) });
  return rows;
}
// A page of the team's own (not in the catalog).
function teamOnly(text: string): Omit<StatusRow, "id"> {
  const r = statusOf({ id: "", type: "practice", revisions: [{ rev: 1, since: "0", base: "", text: "" }] }, text, false);
  return { status: r.status === "invalid" ? "invalid" : "team", stub: r.stub, ...(r.origin && { origin: r.origin }), ...(r.errors && { errors: r.errors }) };
}

// The text of the generated index of the pages as they are (or will be) on disk.
export const indexOf = (texts: Map<string, string>): string => buildHandbookIndex([...texts].map(([id, text]) => ({ id, text }))).content;

// Plans, and with --write creates, the shipped pages the team does not have and has not retired (with --page, only that one:
// how a new practice is adopted one at a time). Never overwrites.
export const handbookInit: Handler = ({ root, write, page }) => {
  const h = load(root);
  if ("fail" in h) return h.fail;
  if (page !== undefined && !catalogPage(page)) return fail("usage", `'${page}' is not a page LiftOff ships`, {}, 2);
  const retired = new Set(h.retired.map((r) => r.id));
  if (page !== undefined && retired.has(page)) return fail("handbook-invalid", `${page} is retired: take it out of retired.txt first if the team wants it back`, { page });
  const files = CATALOG.filter((p) => !retired.has(p.id) && (page === undefined || p.id === page)).map((p) => ({ id: p.id, path: pageFile(h.paths, p.id), exists: h.teamText.has(p.id), text: latest(p).text, stub: p.status === "stub" }));
  const planned = files.filter((f) => !f.exists);
  if (planned.length + h.teamText.size > h.maxPages) return fail("handbook-invalid", `${planned.length} new pages would take the handbook past brain.handbook.maxPages (${h.maxPages}): retire a page first`);
  if (write) {
    for (const f of planned) { atomicWrite(join(h.realRoot, f.path), f.text); h.teamText.set(f.id, f.text); }
    if (planned.length > 0) atomicWrite(join(h.realRoot, h.paths.index), indexOf(h.teamText));
  }
  return { exitCode: 0, body: { ok: true, written: write === true, files: files.map((f) => ({ id: f.id, path: f.path, stub: f.stub, action: f.exists ? "exists" : write ? "created" : "create" })), skippedRetired: [...retired].sort(), proposals: { gitattributes: `${h.paths.retired} merge=union` } } };
};

// Per page: status, origin, stub, review due; the drift. With --page, the three texts of that page.
export const handbookStatus: Handler = ({ root, page }) => {
  const h = load(root);
  if ("fail" in h) return h.fail;
  const rows = rowsOf(h);
  if (page !== undefined) {
    const row = rows.find((r) => r.id === page);
    if (!row) return fail("usage", `no page '${page}' in the handbook or the catalog`, {}, 2);
    const cp = catalogPage(page);
    const mine = h.teamText.get(page);
    const original = cp && row.base ? revisionOf(cp, row.base)?.text : undefined;
    return { exitCode: 0, body: { ok: true, page: row, texts: { team: mine ?? null, original: original ?? null, shipped: cp ? latest(cp).text : null } } };
  }
  return { exitCode: 0, body: { ok: true, pages: rows, drift: drift(rows), counts: { pages: h.teamText.size, maxPages: h.maxPages }, retired: h.retired } };
};

// `update-available` only: the shipped text replaces the team's untouched copy. Anything else is refused, with the reason.
export const handbookUpdate: Handler = ({ root, page, write }) => {
  if (!page) return fail("usage", "handbook-update needs --page <id>", {}, 2);
  const h = load(root);
  if ("fail" in h) return h.fail;
  const cp = catalogPage(page);
  if (!cp) return fail("usage", `'${page}' is not a page LiftOff ships`, {}, 2);
  const row = rowsOf(h).find((r) => r.id === page)!;
  const why: Partial<Record<StatusRow["status"], string>> = {
    current: "already the text LiftOff ships", modified: "the team changed it and LiftOff has nothing new", "both-changed": "the team changed it and LiftOff did too: merge it by hand (handbook-status --page shows the three texts)",
    "new-practice": "not adopted yet: use handbook-init", retired: "the team retired it", team: "origin: team, the team's own page", invalid: "the file does not parse",
  };
  if (row.status !== "update-available") return fail("handbook-invalid", `${page} is ${row.status}: ${why[row.status] ?? ""}`, { page, status: row.status });
  const next = latest(cp).text;
  if (write) {
    atomicWrite(join(h.realRoot, pageFile(h.paths, page)), next);
    h.teamText.set(page, next);
    atomicWrite(join(h.realRoot, h.paths.index), indexOf(h.teamText));
  }
  return { exitCode: 0, body: { ok: true, written: write === true, page, from: row.base, to: latest(cp).base, path: pageFile(h.paths, page) } };
};

// Writes the tombstone and deletes the file. The team decides; liftoff only keeps the page from coming back.
export const handbookRetire: Handler = ({ root, page, reason, write }) => {
  if (!page || !PAGE_ID.test(page)) return fail("usage", "handbook-retire needs --page <id>", {}, 2);
  if (!reason || reason.trim() === "" || /[\r\n]/.test(reason) || reason.length > 200) return fail("usage", "handbook-retire needs --reason <one line, at most 200 characters>", {}, 2);
  if (secretGuard({ reason }).length > 0) return fail("handbook-invalid", "the reason looks like a credential: remove it");
  const h = load(root);
  if ("fail" in h) return h.fail;
  const known = h.teamText.has(page) || catalogPage(page) !== undefined;
  if (!known) return fail("usage", `no page '${page}' in the handbook or the catalog`, {}, 2);
  const already = h.retired.some((r) => r.id === page);
  const line = retiredLine(page, today(), reason);
  const file = pageFile(h.paths, page);
  const hadFile = h.teamText.has(page);
  if (write) {
    if (!already) {
      const retiredAbs = join(h.realRoot, h.paths.retired);
      const before = existsSync(retiredAbs) ? readFileSync(retiredAbs, "utf8") : "";
      atomicWrite(retiredAbs, `${before}${before === "" || before.endsWith("\n") ? "" : "\n"}${line}\n`);
    }
    if (h.teamText.has(page)) { unlinkSync(join(h.realRoot, file)); h.teamText.delete(page); }
    atomicWrite(join(h.realRoot, h.paths.index), indexOf(h.teamText));
  }
  return { exitCode: 0, body: { ok: true, written: write === true, page, tombstone: already ? null : line, deletes: hadFile ? file : null, alreadyRetired: already } };
};
