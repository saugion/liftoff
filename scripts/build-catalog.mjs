import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";

// The handbook's shipped pages. `src/handbook/base/<id>.md` is the current text of each page (front matter without origin
// and base). `src/handbook/catalog.json` is append-only: every revision a team may have copied, with the origin and the
// fingerprint a team's copy carries. A new revision is appended when a page's text changed; an old one is never edited, so a
// team's copy can always be compared with the text it started from. Only the last MAX_REVISIONS are kept.

export const MAX_REVISIONS = 5;
export const BASE_DIR = "src/handbook/base";
export const CATALOG_FILE = "src/handbook/catalog.json";

// The same function as `fingerprint` in src/handbook/page.ts: a test holds them equal on every shipped page.
const canonicalize = (v) =>
  Array.isArray(v) ? `[${v.map(canonicalize).join(",")}]`
  : v !== null && typeof v === "object" ? `{${Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => `${JSON.stringify(k)}:${canonicalize(x)}`).join(",")}}`
  : JSON.stringify(v);
const normalize = (s) => s.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
export function fingerprint(front, body) {
  const head = canonicalize({ title: front.title, type: front.type, summary: front.summary, status: front.status ?? null });
  return createHash("sha256").update(`${head}\n${normalize(body)}`).digest("hex").slice(0, 12);
}

// "title: x\n..." front matter lines (kept byte for byte) and the body of a source page.
export function splitPage(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] !== "---") throw new Error("a base page must start with ---");
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error("front matter is not closed");
  const frontLines = lines.slice(1, end);
  const front = parseDocument(frontLines.join("\n")).toJS();
  return { front, frontLines, body: lines.slice(end + 1).join("\n") };
}

// The file a team gets: the source front matter plus origin and base, then the body. `base` is quoted: twelve digits with no
// letter would be read as a number (and `12e3456…` as a float).
export function shippedText(source, since) {
  const { front, frontLines, body } = splitPage(source);
  for (const k of ["origin", "base"]) if (k in front) throw new Error(`a base page does not carry '${k}': the generator adds it`);
  const origin = `liftoff@${since.split(".").slice(0, 2).join(".")}`;
  return `---\n${frontLines.join("\n")}\norigin: ${origin}\nbase: "${fingerprint(front, body)}"\n---\n${body}`;
}

export function buildCatalog({ cwd = process.cwd(), version, write = false, max = MAX_REVISIONS } = {}) {
  const dir = join(cwd, BASE_DIR);
  const file = join(cwd, CATALOG_FILE);
  const old = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { format: 1, pages: [] };
  const byId = new Map(old.pages.map((p) => [p.id, p]));
  const ids = readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3)).sort();
  for (const id of byId.keys()) if (!ids.includes(id)) throw new Error(`the shipped page '${id}' has no source file: a shipped page is never deleted`);
  const pages = ids.map((id) => {
    const source = readFileSync(join(dir, `${id}.md`), "utf8");
    const { front, body } = splitPage(source);
    const fp = fingerprint(front, body);
    const prev = byId.get(id);
    const revisions = prev ? [...prev.revisions] : [];
    const last = revisions[revisions.length - 1];
    if (!last) revisions.push({ rev: 1, since: version, base: fp, text: shippedText(source, version) });
    else if (last.base !== fp) {
      // A text that changed while its version is still the one in development has not reached any team: replace it. From the
      // next version on a change is a new revision and the old one stays (bump the version before the first change after a tag).
      const rev = { rev: last.since === version ? last.rev : last.rev + 1, since: version, base: fp, text: shippedText(source, version) };
      if (last.since === version) revisions[revisions.length - 1] = rev;
      else revisions.push(rev);
    }
    return { id, type: front.type, ...(front.status && { status: front.status }), revisions: revisions.slice(-max) };
  });
  const next = { format: 1, pages };
  const text = JSON.stringify(next, null, 2) + "\n";
  const changed = !existsSync(file) || readFileSync(file, "utf8") !== text;
  if (write && changed) writeFileSync(file, text);
  return { changed, catalog: next };
}
