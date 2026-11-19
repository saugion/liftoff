import { type Document } from "yaml";

type Path = (string | number)[];
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const keyOf = (x: unknown): string | undefined => (isObj(x) ? (x.id ?? x.name) as string | undefined : undefined);
const keyed = (a: unknown[]) => a.every((x) => keyOf(x) !== undefined);

// Merge a patch into a YAML document without disturbing what the patch does not mention.
//   undefined (key absent)  leave as it is        null  delete the key
//   object                  merged key by key     list of {id|name} items  matched by key (or by `$was`, the
//   old key of a renamed item); unmatched items are removed, new ones appended; matched ones are merged, so
//   learned fields (issue-type templates, transitions) and YAML comments survive
//   any other list or scalar  replaced when different
export function applyPatch(doc: Document, patch: Record<string, unknown>): void {
  sync(doc, [], doc.toJS() ?? {}, patch);
}

function sync(doc: Document, path: Path, cur: unknown, next: unknown): void {
  if (next === undefined) return;
  if (next === null) {
    if (cur !== undefined && path.length) doc.deleteIn(path);
    return;
  }
  if (isObj(next)) {
    if (!isObj(cur)) return void doc.setIn(path, strip(next));
    for (const k of Object.keys(next)) if (k !== "$was") sync(doc, [...path, k], cur[k], next[k]);
    return;
  }
  if (Array.isArray(next) && Array.isArray(cur) && keyed(next) && keyed(cur)) return syncKeyed(doc, path, cur, next);
  if (JSON.stringify(cur) !== JSON.stringify(strip(next))) doc.setIn(path, strip(next));
}

function syncKeyed(doc: Document, path: Path, cur: unknown[], next: unknown[]): void {
  const was = (x: unknown) => (isObj(x) && typeof x.$was === "string" ? x.$was : keyOf(x));
  const keep = new Set(next.map(was));
  const gone = cur.flatMap((x, i) => (keep.has(keyOf(x)) ? [] : [i]));
  for (const i of [...gone].reverse()) doc.deleteIn([...path, i]);
  for (const item of next) {
    const old = cur.findIndex((x) => keyOf(x) === was(item));
    if (old < 0) doc.addIn(path, strip(item)); // appended, so the indexes of the kept items do not move
    else sync(doc, [...path, old - gone.filter((g) => g < old).length], cur[old], item);
  }
}

// `$was` is bookkeeping for the merge, never written; nulls inside a brand new value are not written either.
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (!isObj(v)) return v;
  return Object.fromEntries(Object.entries(v).filter(([k, x]) => k !== "$was" && x !== null && x !== undefined).map(([k, x]) => [k, strip(x)]));
}
