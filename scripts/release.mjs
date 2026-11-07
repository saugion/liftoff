import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// npm run release <x.y.z> [--dry-run]
// Bumps both versions, builds from a clean install, runs the tests, commits and tags. Pushing stays manual, and
// nothing is tagged unless the build and the tests passed: a published tag is immutable (teammates pin to it).

const SEMVER = /^\d+\.\d+\.\d+$/;
const parts = (v) => v.split(".").map(Number);

// An error message, or undefined when `next` is an acceptable next version.
export function checkVersionArg(current, next) {
  if (!SEMVER.test(next ?? "")) return `version must be x.y.z, got ${JSON.stringify(next)}`;
  const [a, b] = [parts(next), parts(current)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? undefined : `${next} is not newer than the current ${current}`;
  return `${next} is the current version`;
}

const defaultExec = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

// What a release may change: the two version files, the lockfile and the generated plugin files.
export const isReleasePath = (path) => path === "package.json" || path === "package-lock.json" || path.startsWith("plugin/");

export function release({ version, cwd = process.cwd(), dryRun = false, exec = defaultExec, log = console.log }) {
  const read = (cmd, args) => exec(cmd, args, cwd); // read-only: always runs
  const step = (cmd, args) => {
    log(`${dryRun ? "[dry run] " : ""}$ ${cmd} ${args.join(" ")}`);
    return dryRun ? "" : exec(cmd, args, cwd);
  };

  const pkgFile = join(cwd, "package.json");
  const pluginFile = join(cwd, "plugin", ".claude-plugin", "plugin.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  const plugin = JSON.parse(readFileSync(pluginFile, "utf8"));
  if (pkg.version !== plugin.version) throw new Error(`package.json (${pkg.version}) and plugin.json (${plugin.version}) already differ: fix that first`);
  const bad = checkVersionArg(pkg.version, version);
  if (bad) throw new Error(bad);

  if (read("git", ["status", "--porcelain"]).trim() !== "") throw new Error("the working tree is not clean: commit or stash first");
  const branch = read("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (branch !== "main") throw new Error(`release from main, not ${branch}`);
  if (read("git", ["tag", "--list", `v${version}`]).trim() !== "") throw new Error(`tag v${version} already exists`);

  step("npm", ["version", version, "--no-git-tag-version"]); // package.json and package-lock.json
  if (!dryRun) writeFileSync(pluginFile, JSON.stringify({ ...plugin, version }, null, 2) + "\n");
  log(`${dryRun ? "[dry run] " : ""}plugin.json -> ${version}`);
  step("npm", ["ci"]); // from the lockfile: the artifact must be reproducible
  step("npm", ["run", "build"]);
  step("npm", ["test"]);

  step("git", ["add", "package.json", "package-lock.json", "plugin"]);
  if (!dryRun) {
    const staged = read("git", ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
    const stray = staged.filter((p) => !isReleasePath(p));
    if (stray.length > 0) throw new Error(`refusing to commit files a release should not touch: ${stray.join(", ")}`);
  }
  step("git", ["commit", "-m", `release: v${version}`]);
  step("git", ["tag", "-a", `v${version}`, "-m", `LiftOff v${version}`]);
  log(`Done. Review it, then publish: git push origin main && git push origin v${version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  try {
    release({ version: args.find((a) => !a.startsWith("--")), dryRun: args.includes("--dry-run") });
  } catch (e) {
    console.error(`release: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
