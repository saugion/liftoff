import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, realpathSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

const errno = (e: unknown) => (e as NodeJS.ErrnoException).code;

// Real path of `abs` even when it does not exist yet: the real path of its deepest existing ancestor, plus the rest.
// A symlink anywhere on the way (including the last component of an existing file) is followed.
export function resolveReal(abs: string): string {
  const rest: string[] = [];
  let existing = abs;
  for (;;) {
    try {
      return join(realpathSync(existing), ...rest);
    } catch (e) {
      if ((errno(e) !== "ENOENT" && errno(e) !== "ENOTDIR") || dirname(existing) === existing) throw e;
      rest.unshift(basename(existing));
      existing = dirname(existing);
    }
  }
}

// Not `startsWith`: "/repo2" is not inside "/repo".
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      return renameSync(from, to);
    } catch (e) {
      // Windows: the target can be briefly locked by an antivirus scan or an editor.
      if ((errno(e) !== "EPERM" && errno(e) !== "EBUSY") || attempt >= 5) throw e;
      sleep(50 * (attempt + 1));
    }
  }
}

// Temp file in the same directory (random name, O_EXCL), then rename: readers never see a half-written file.
export function atomicWrite(file: string, content: string): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const fd = openSync(tmp, "wx");
    try {
      writeSync(fd, content);
    } finally {
      closeSync(fd);
    }
    renameWithRetry(tmp, file);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // nothing to clean up
    }
    throw e;
  }
}
