import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { INSTALLED_VERSION } from "../../src/cli/version.js";
import { parseMarker } from "../../src/render/marker.js";
import { buildTempBundle, runBundle, tempDir } from "../helpers.js";
import { expectedFiles, list, makeRepo, render } from "./repo.js";

describe("liftoff render: fresh repo", () => {
  it("creates every generated file with the expected content, and says so", () => {
    const dir = makeRepo();
    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(0);
    expect(body).toMatchObject({ ok: true, applied: true, root: dir, notices: [] });
    expect(body.configHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(body.files.map((f: any) => [f.path, f.action, f.agent])).toEqual([
      [".github/copilot-instructions.md", "created", "copilot"],
      ["CLAUDE.md", "created", "claude-code"],
      ["apps/web/CLAUDE.md", "created", "claude-code"],
      ["src/api/CLAUDE.md", "created", "claude-code"],
    ]);
    for (const [path, content] of Object.entries(expectedFiles(dir))) expect(readFileSync(join(dir, path), "utf8"), path).toBe(content);
  });

  it("the marker carries the installed version", () => {
    const dir = makeRepo();
    render(dir);
    expect(parseMarker(readFileSync(join(dir, "CLAUDE.md"), "utf8"))!.version).toBe(INSTALLED_VERSION);
  });

  it("makes .liftoff ignore itself and writes the applied record last, with hashes, required sections, files, conflicts", () => {
    const dir = makeRepo({ extra: "constraints:\n  required: true\n" });
    const { body } = render(dir);
    expect(readFileSync(join(dir, ".liftoff/.gitignore"), "utf8")).toBe("*\n");
    const record = JSON.parse(readFileSync(join(dir, ".liftoff/applied.json"), "utf8"));
    expect(Object.keys(record)).toEqual(["v", "configHash", "sectionHashes", "requiredSections", "files", "conflicts"]);
    expect(record).toMatchObject({
      v: 1,
      configHash: body.configHash,
      requiredSections: ["constraints", "liftoff", "plugin"],
      files: [".github/copilot-instructions.md", "CLAUDE.md", "apps/web/CLAUDE.md", "src/api/CLAUDE.md"],
      conflicts: [],
    });
    expect(Object.keys(record.sectionHashes)).toEqual(["agents", "constraints", "liftoff", "modules", "plugin", "project"]);
  });

  it("does not touch the user's own .gitignore", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, ".gitignore"), "node_modules\n");
    render(dir);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe("node_modules\n");
  });

  it("leaves no temp files behind", () => {
    const dir = makeRepo();
    render(dir);
    expect(list(dir).filter((p) => p.endsWith(".tmp"))).toEqual([]);
  });

  it("copilot only: module AGENTS.md files are not needed and no module file is created", () => {
    const dir = makeRepo({ targets: "[copilot]", agentsMd: ["AGENTS.md"] });
    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(0);
    expect(body.files.map((f: any) => f.path)).toEqual([".github/copilot-instructions.md"]);
    expect(existsSync(join(dir, "src"))).toBe(false);
  });

  it("claude only with no modules needs just the root AGENTS.md", () => {
    const dir = makeRepo({ targets: "[claude-code]", modules: [] });
    expect(render(dir).body.files.map((f: any) => f.path)).toEqual(["CLAUDE.md"]);
  });
});

describe("liftoff render: idempotent", () => {
  it("a second run reports everything unchanged and rewrites nothing", () => {
    const dir = makeRepo();
    render(dir);
    const old = new Date("2001-01-01T00:00:00Z");
    const touched = [".liftoff/applied.json", ".liftoff/.gitignore", "CLAUDE.md", ".github/copilot-instructions.md", "src/api/CLAUDE.md"];
    for (const p of touched) utimesSync(join(dir, p), old, old);

    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(0);
    expect(body.files.map((f: any) => f.action)).toEqual(["unchanged", "unchanged", "unchanged", "unchanged"]);
    for (const p of touched) expect(lstatSync(join(dir, p)).mtime.getTime(), `${p} was rewritten`).toBe(old.getTime());
    expect(list(dir).filter((p) => p.endsWith(".tmp"))).toEqual([]);
  });

  it("a CRLF copy of an unedited file counts as unchanged and keeps its CRLF", () => {
    const dir = makeRepo();
    render(dir);
    const file = join(dir, "CLAUDE.md");
    const crlf = readFileSync(file, "utf8").replace(/\n/g, "\r\n");
    writeFileSync(file, crlf);
    const { body } = render(dir);
    expect(body.files.find((f: any) => f.path === "CLAUDE.md").action).toBe("unchanged");
    expect(readFileSync(file, "utf8")).toBe(crlf);
  });
});

describe("liftoff render: AGENTS.md preflight (nothing is written before it passes)", () => {
  const untouched = (dir: string) => {
    expect(existsSync(join(dir, ".liftoff")), ".liftoff created").toBe(false);
    expect(list(dir).filter((p) => /CLAUDE\.md$|copilot-instructions\.md$/.test(p)), "files written").toEqual([]);
  };

  it("a missing module AGENTS.md is fatal; every missing path is listed; nothing is written", () => {
    const dir = makeRepo({ agentsMd: ["AGENTS.md"] });
    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(1);
    expect(body.ok).toBe(false);
    expect(body.errors.map((e: any) => [e.code, e.file])).toEqual([
      ["agents-md-missing", "src/api/AGENTS.md"],
      ["agents-md-missing", "apps/web/AGENTS.md"],
    ]);
    untouched(dir);
  });

  it("a missing root AGENTS.md is fatal", () => {
    const dir = makeRepo({ agentsMd: false });
    const { body } = render(dir);
    expect(body.errors[0]).toMatchObject({ code: "agents-md-missing", file: "AGENTS.md" });
    untouched(dir);
  });

  it("the name is case-sensitive: Agents.md does not count (it would break on Linux)", () => {
    const dir = makeRepo({ targets: "[copilot]", modules: [], agentsMd: false });
    writeFileSync(join(dir, "Agents.md"), "# rules\n");
    expect(render(dir).body.errors[0]).toMatchObject({ code: "agents-md-missing", file: "AGENTS.md" });
    untouched(dir);
  });

  it("a directory named AGENTS.md is invalid", () => {
    const dir = makeRepo({ targets: "[copilot]", modules: [], agentsMd: false });
    mkdirSync(join(dir, "AGENTS.md"));
    expect(render(dir).body.errors[0]).toMatchObject({ code: "agents-md-invalid", file: "AGENTS.md" });
    untouched(dir);
  });

  it("AGENTS.md -> CLAUDE.md is invalid: @AGENTS.md would import the file into itself", () => {
    const dir = makeRepo({ targets: "[claude-code]", modules: [], agentsMd: false });
    writeFileSync(join(dir, "CLAUDE.md"), "# my rules\n");
    symlinkSync("CLAUDE.md", join(dir, "AGENTS.md"));
    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(1);
    expect(body.errors[0]).toMatchObject({ code: "agents-md-invalid", file: "AGENTS.md" });
    expect(body.errors[0].message).toMatch(/import the file into itself/);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("# my rules\n"); // the only copy is intact
    expect(existsSync(join(dir, ".liftoff"))).toBe(false);
  });

  it("a module AGENTS.md -> CLAUDE.md in the same directory is invalid too", () => {
    const dir = makeRepo({ targets: "[claude-code]", modules: ["src/api"], agentsMd: ["AGENTS.md"] });
    mkdirSync(join(dir, "src/api"), { recursive: true });
    writeFileSync(join(dir, "src/api/CLAUDE.md"), "# module rules\n");
    symlinkSync("CLAUDE.md", join(dir, "src/api/AGENTS.md"));
    expect(render(dir).body.errors.map((e: any) => [e.code, e.file])).toEqual([["agents-md-invalid", "src/api/AGENTS.md"]]);
  });

  it("a broken symlink is invalid", () => {
    const dir = makeRepo({ targets: "[copilot]", modules: [], agentsMd: false });
    symlinkSync("nowhere.md", join(dir, "AGENTS.md"));
    const { body } = render(dir);
    expect(body.errors[0]).toMatchObject({ code: "agents-md-invalid", file: "AGENTS.md" });
    expect(body.errors[0].message).toMatch(/broken symlink/);
  });

  it("a symlink to an ordinary file that render does not write is fine", () => {
    const dir = makeRepo({ targets: "[copilot]", modules: [], agentsMd: false });
    writeFileSync(join(dir, "RULES.md"), "# rules\n");
    symlinkSync("RULES.md", join(dir, "AGENTS.md"));
    expect(render(dir).exitCode).toBe(0);
  });
});

describe("liftoff render: containment (nothing outside the real root is touched)", () => {
  it("a symlinked directory that leaves the repo is a path-escape, and the outside stays untouched", () => {
    const base = tempDir();
    const dir = join(base, "repo");
    mkdirSync(join(base, "outside/api"), { recursive: true });
    writeFileSync(join(base, "outside/api/AGENTS.md"), "# rules\n");
    mkdirSync(dir);
    const repo = makeRepo({ targets: "[claude-code]", modules: ["src/api"], agentsMd: ["AGENTS.md"] });
    writeFileSync(join(dir, "liftoff.yaml"), readFileSync(join(repo, "liftoff.yaml")));
    writeFileSync(join(dir, "AGENTS.md"), "# rules\n");
    symlinkSync(join(base, "outside"), join(dir, "src"));

    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(1);
    expect(body.errors.map((e: any) => [e.code, e.file])).toEqual([["path-escape", "src/api/CLAUDE.md"]]);
    expect(list(join(base, "outside"))).toEqual(["api/AGENTS.md"]);
    expect(existsSync(join(dir, ".liftoff"))).toBe(false);
  });

  it("a sibling directory whose name starts with the root's name is still outside (/repo2 is not /repo)", () => {
    const base = tempDir();
    const dir = join(base, "repo");
    mkdirSync(join(base, "repo2/api"), { recursive: true });
    writeFileSync(join(base, "repo2/api/AGENTS.md"), "# rules\n");
    mkdirSync(dir);
    const seed = makeRepo({ targets: "[claude-code]", modules: ["src/api"], agentsMd: ["AGENTS.md"] });
    writeFileSync(join(dir, "liftoff.yaml"), readFileSync(join(seed, "liftoff.yaml")));
    writeFileSync(join(dir, "AGENTS.md"), "# rules\n");
    symlinkSync(join(base, "repo2"), join(dir, "src"));
    expect(render(dir).body.errors[0]).toMatchObject({ code: "path-escape", file: "src/api/CLAUDE.md" });
    expect(list(join(base, "repo2"))).toEqual(["api/AGENTS.md"]);
  });

  it("a .liftoff that is a symlink out of the repo is a path-escape", () => {
    const base = tempDir();
    const outside = join(base, "elsewhere");
    mkdirSync(outside);
    const dir = makeRepo({ targets: "[copilot]", modules: [] });
    symlinkSync(outside, join(dir, ".liftoff"));
    const { body } = render(dir);
    expect(body.errors.map((e: any) => [e.code, e.file])).toEqual([
      ["path-escape", ".liftoff/.gitignore"],
      ["path-escape", ".liftoff/applied.json"],
    ]);
    expect(list(outside)).toEqual([]);
  });

  it("an existing output file that is a symlink out of the repo is a path-escape", () => {
    const base = tempDir();
    const target = join(base, "somewhere.md");
    writeFileSync(target, "x");
    const dir = makeRepo({ targets: "[claude-code]", modules: [] });
    symlinkSync(target, join(dir, "CLAUDE.md"));
    expect(render(dir).body.errors[0]).toMatchObject({ code: "path-escape", file: "CLAUDE.md" });
    expect(readFileSync(target, "utf8")).toBe("x");
  });
});

describe("liftoff render: config problems", () => {
  const nothingWritten = (dir: string) => expect(list(dir).filter((p) => !["liftoff.yaml", "AGENTS.md"].includes(p) && !p.endsWith("/AGENTS.md"))).toEqual([]);

  it("no liftoff.yaml: config-missing, exit 1", () => {
    const dir = tempDir();
    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(1);
    expect(body.errors[0].code).toBe("config-missing");
  });

  it("an invalid config: config-invalid with the pointer, nothing written", () => {
    const dir = makeRepo({ extra: "bogus: 1\n" });
    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(1);
    expect(body.errors[0]).toMatchObject({ code: "config-invalid", path: "/bogus" });
    nothingWritten(dir);
  });

  it("a module at the repo root is render-invalid, at its pointer, nothing written", () => {
    const dir = makeRepo({ modules: ["."], targets: "[claude-code]", agentsMd: ["AGENTS.md"] });
    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(1);
    expect(body.errors[0]).toMatchObject({ code: "render-invalid", path: "/modules/items/0/path" });
    nothingWritten(dir);
  });

  it("two modules on one path are render-invalid", () => {
    const dir = makeRepo({ modules: ["src/api", "./src/api/"], agentsMd: ["AGENTS.md", "src/api/AGENTS.md"] });
    expect(render(dir).body.errors[0]).toMatchObject({ code: "render-invalid", path: "/modules/items/1/path" });
  });
});

describe("liftoff render: files that already exist (full conflict handling arrives in T8)", () => {
  it("a differing file is a conflict: not written, proposed content returned, recorded; the rest is created", () => {
    const dir = makeRepo({ targets: "[claude-code]", modules: ["src/api"] });
    writeFileSync(join(dir, "CLAUDE.md"), "# my own rules\n");
    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(0);
    expect(body.applied).toBe(true);
    const claude = body.files.find((f: any) => f.path === "CLAUDE.md");
    expect(claude).toMatchObject({ action: "conflict" });
    expect(claude.proposed).toBe(expectedFiles(dir)["CLAUDE.md"]);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("# my own rules\n");
    expect(body.files.find((f: any) => f.path === "src/api/CLAUDE.md").action).toBe("created");
    expect(JSON.parse(readFileSync(join(dir, ".liftoff/applied.json"), "utf8")).conflicts).toEqual(["CLAUDE.md"]);
  });

  it("a directory where a file should be is a not-regular conflict, not a crash", () => {
    const dir = makeRepo({ targets: "[claude-code]", modules: [] });
    mkdirSync(join(dir, "CLAUDE.md"));
    const { exitCode, body } = render(dir);
    expect(exitCode).toBe(0);
    expect(body.files[0]).toMatchObject({ path: "CLAUDE.md", action: "conflict", reason: "not-regular" });
  });

  it("a symlink to an unrelated file is a conflict and is never written through", () => {
    const dir = makeRepo({ targets: "[claude-code]", modules: [] });
    writeFileSync(join(dir, "OTHER.md"), "# other\n");
    symlinkSync("OTHER.md", join(dir, "CLAUDE.md"));
    const { body } = render(dir);
    expect(body.files[0]).toMatchObject({ action: "conflict", reason: "symlink" });
    expect(readFileSync(join(dir, "OTHER.md"), "utf8")).toBe("# other\n");
  });
});

describe("liftoff render from the built bundle", () => {
  let file = "";
  beforeAll(async () => {
    file = (await buildTempBundle()).file;
  });

  it("renders a repo end to end: exit 0, one JSON document, files on disk, no stderr", () => {
    const dir = makeRepo();
    const r = runBundle(file, ["render", "--root", dir]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, applied: true });
    for (const [path, content] of Object.entries(expectedFiles(dir))) expect(readFileSync(join(dir, path), "utf8")).toBe(content);
  });

  it("a fatal error exits 1 with a coded error", () => {
    const r = runBundle(file, ["render", "--root", makeRepo({ agentsMd: false })]);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).errors[0].code).toBe("agents-md-missing");
  });
});
