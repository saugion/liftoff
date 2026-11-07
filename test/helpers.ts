import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildBundle } from "../scripts/build.mjs";

// realpath: on macOS tmpdir() is under /var, which resolves to /private/var.
export const tempDir = (prefix = "liftoff-test-") => realpathSync(mkdtempSync(join(tmpdir(), prefix)));

export async function buildTempBundle(): Promise<{ dir: string; file: string }> {
  const dir = tempDir("liftoff-bundle-");
  const file = join(dir, "liftoff.mjs");
  await buildBundle(file);
  return { dir, file };
}

export function runBundle(file: string, args: string[], cwd?: string) {
  const r = spawnSync(process.execPath, [file, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
