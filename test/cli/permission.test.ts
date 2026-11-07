import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { buildTempBundle, tempDir } from "../helpers.js";

// The bundle must run alone (no node_modules next to it), spawn nothing, and write only inside the repo root.
// Node's permission model proves the last two at runtime; it does NOT cover the network (the static guard does).
// `--permission` is the stable flag from Node 24; on 22.12 it was experimental, so this runs on 24+ (CI), per SPEC-cli.
const major = Number(process.versions.node.split(".")[0]);

describe.skipIf(major < 24)("the bundle under `node --permission`", () => {
  let bundle = "";
  beforeAll(async () => {
    const built = await buildTempBundle();
    const alone = tempDir("liftoff-alone-"); // a directory with nothing but the bundle: no node_modules anywhere near
    bundle = join(alone, "liftoff.mjs");
    copyFileSync(built.file, bundle);
  });

  const repo = () => {
    const dir = join(tempDir(), "repo");
    mkdirSync(dir);
    writeFileSync(join(dir, "liftoff.yaml"), 'liftoff: 1\nplugin:\n  version: "0.1"\nproject:\n  name: acme\n  kind: new\nagents:\n  targets: [claude-code, copilot]\n');
    writeFileSync(join(dir, "AGENTS.md"), "# rules\n");
    return dir;
  };

  const sandboxed = (args: string[], { read, write }: { read: string[]; write: string[] }) =>
    spawnSync(
      process.execPath,
      ["--permission", ...read.map((p) => `--allow-fs-read=${p}`), ...write.map((p) => `--allow-fs-write=${p}`), bundle, ...args],
      { encoding: "utf8" },
    );

  it("validate, render and check-config work with read access to the bundle and the repo, write access to the repo only", () => {
    const dir = repo();
    const grant = { read: [bundle, dir], write: [dir] }; // no --allow-child-process, no other path
    const validate = sandboxed(["validate", "--root", dir], grant);
    expect([validate.status, validate.stderr]).toEqual([0, ""]);
    expect(JSON.parse(validate.stdout).ok).toBe(true);

    const render = sandboxed(["render", "--root", dir], grant);
    expect([render.status, render.stderr]).toEqual([0, ""]);
    expect(JSON.parse(render.stdout)).toMatchObject({ ok: true, applied: true });
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");

    const check = sandboxed(["check-config", "--root", dir], grant);
    expect([check.status, check.stderr]).toEqual([0, ""]);
    expect(JSON.parse(check.stdout)).toMatchObject({ status: "ok" });
  });

  it("negative control: without write access the same render fails (so the grant above really is what allows it)", () => {
    const dir = repo();
    const denied = sandboxed(["render", "--root", dir], { read: [bundle, dir], write: [] });
    expect(denied.status).toBe(1);
    expect(JSON.parse(denied.stdout).errors[0].code).toBe("write-failed");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
  });

  it("negative control: the permission model really blocks spawning a process", () => {
    const r = spawnSync(process.execPath, ["--permission", "--allow-fs-read=*", "-e", 'require("node:child_process").execSync("true")'], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/ERR_ACCESS_DENIED|Access to this API has been restricted/);
  });
});
