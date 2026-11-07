import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "./fsutil.js";

export const LIFTOFF_DIR = ".liftoff";
export const APPLIED_PATH = `${LIFTOFF_DIR}/applied.json`;
export const GITIGNORE_PATH = `${LIFTOFF_DIR}/.gitignore`;

// Personal and uncommitted. Written only by `render`, and only after every file write succeeded.
export interface AppliedRecord {
  v: 1;
  configHash: string;
  sectionHashes: Record<string, string>;
  requiredSections: string[];
  files: string[]; // every path the last render planned
  conflicts: string[]; // paths left unresolved
}

const readIfExists = (file: string): string | undefined => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};

// The directory ignores itself, so the record and the backups can never be committed and the user's own
// .gitignore is never touched. Rewritten only when it does not already hold a "*" line.
export function ensureSelfIgnore(realRoot: string): void {
  const file = join(realRoot, GITIGNORE_PATH);
  const current = readIfExists(file);
  if (current !== undefined && current.split(/\r?\n/).some((line) => line.trim() === "*")) return;
  atomicWrite(file, "*\n");
}

// Skipped when byte-identical, so an idempotent re-run leaves the file untouched.
export function writeApplied(realRoot: string, record: AppliedRecord): void {
  const file = join(realRoot, APPLIED_PATH);
  const text = JSON.stringify(record, null, 2) + "\n";
  if (readIfExists(file) === text) return;
  atomicWrite(file, text);
}
