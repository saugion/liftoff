import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { previewSave, recordWritten, save } from "../../ui/persist.js";
import { tempDir } from "../helpers.js";

// What saving the setup may do to a person's git, in the situations a real repository is in.
const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@e.c", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@e.c", GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, env, encoding: "utf8" }).trim();
const put = (root: string, rel: string, text = "x\n") => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};
// a repository with a bare remote, one commit pushed; `sub` makes the project a folder of a larger repository
function world(sub = "") {
  const base = tempDir("liftoff-persist-");
  const remote = join(base, "remote.git");
  git(base, "init", "-q", "--bare", "-b", "main", remote);
  const top = join(base, "repo");
  git(base, "init", "-q", "-b", "main", top);
  git(top, "config", "user.email", "t@e.c");
  git(top, "config", "user.name", "T");
  git(top, "remote", "add", "origin", remote);
  put(top, "README.md");
  git(top, "add", "-A");
  git(top, "commit", "-qm", "init");
  git(top, "push", "-q", "-u", "origin", "main");
  const root = sub ? join(top, sub) : top;
  mkdirSync(root, { recursive: true });
  return { top, root, remote };
}

describe("saving the setup", () => {
  it("lists only the files the guide wrote, never another person's edit of a file with the same name", async () => {
    const { top, root } = world();
    put(root, "liftoff.yaml");
    put(root, "AGENTS.md");
    put(root, "docs/AGENTS.md", "an engineer's work in progress\n"); // same name, not written by the guide
    put(root, "CLAUDE.md");
    recordWritten(root, ["liftoff.yaml", "AGENTS.md", "CLAUDE.md"]);
    expect((await previewSave(root, "po")).files).toEqual(["AGENTS.md", "CLAUDE.md", "liftoff.yaml"]);
    void top;
  });
  it("works when the project is a folder of a larger repository, and ignores the siblings", async () => {
    const { root, top } = world("apps/web");
    put(root, "liftoff.yaml");
    put(root, "AGENTS.md");
    put(top, "apps/other/AGENTS.md"); // a sibling project's file
    put(top, "notes.txt");
    recordWritten(root, ["liftoff.yaml", "AGENTS.md"]);
    const p = await previewSave(root, "po");
    expect(p.files).toEqual(["AGENTS.md", "liftoff.yaml"]);
    const r = await save(root, "po", p.files);
    expect(r).toMatchObject({ ok: true, pushed: true });
    expect(git(top, "show", "--name-only", "--format=", "liftoff/setup-po").split("\n").sort()).toEqual(["apps/web/AGENTS.md", "apps/web/liftoff.yaml"]);
    expect(git(top, "status", "--porcelain", "-uall")).toContain("apps/other/AGENTS.md"); // untouched
  });
  it("a staged rename of someone's file is not mistaken for one of ours", async () => {
    const { root } = world();
    put(root, "docs/AGENTS.md", "a\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "docs");
    mkdirSync(join(root, "web"));
    git(root, "mv", "docs/AGENTS.md", "web/AGENTS.md");
    put(root, "liftoff.yaml");
    recordWritten(root, ["liftoff.yaml"]);
    expect((await previewSave(root, "po")).files).toEqual(["liftoff.yaml"]);
  });
  it("does not send the person's own unpushed commits, and leaves their branch where it is", async () => {
    const { root, top, remote } = world();
    put(root, "feature.txt", "my own work\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "my own unpushed work");
    put(root, "liftoff.yaml");
    recordWritten(root, ["liftoff.yaml"]);
    const p = await previewSave(root, "po");
    expect(p.base).toBe("origin/main");
    expect(p.note).toContain("not shared yet");
    expect(await save(root, "po", p.files)).toMatchObject({ ok: true, pushed: true });
    expect(git(remote, "log", "liftoff/setup-po", "--format=%s")).not.toContain("my own unpushed work");
    expect(git(top, "log", "main", "--format=%s")).toContain("my own unpushed work"); // still on their branch, untouched
  });
  it("a failure after the branch was made puts the person back and removes the empty branch", async () => {
    const { root, top } = world();
    put(root, "liftoff.yaml");
    recordWritten(root, ["liftoff.yaml"]);
    put(top, ".git/hooks/pre-commit", "#!/bin/sh\necho no >&2\nexit 1\n");
    execFileSync("chmod", ["+x", join(top, ".git/hooks/pre-commit")]);
    const p = await previewSave(root, "po");
    const r = await save(root, "po", p.files);
    expect(r).toMatchObject({ ok: false, code: "git-error" });
    expect(git(top, "branch", "--show-current")).toBe("main");
    expect(git(top, "branch", "--list", "liftoff/*")).toBe("");
    expect(git(top, "diff", "--cached", "--name-only")).toBe(""); // nothing left staged
    expect(existsSync(join(root, "liftoff.yaml"))).toBe(true); // and the file is still there
  });
  it("offers nothing when the guide wrote nothing, or after the save", async () => {
    const { root } = world();
    put(root, "liftoff.yaml");
    expect((await previewSave(root, "po")).files).toEqual([]); // not written by the guide
    recordWritten(root, ["liftoff.yaml"]);
    const p = await previewSave(root, "po");
    await save(root, "po", p.files);
    put(root, "liftoff.yaml", "edited later by hand\n");
    expect((await previewSave(root, "tl")).files).toEqual([]); // saved: a later edit is the person's own
  });
  it("refuses a recorded path that is not a plain relative path", async () => {
    const { root } = world();
    put(root, "liftoff.yaml");
    symlinkSync("/etc/hosts", join(root, "link"));
    recordWritten(root, ["liftoff.yaml", "../outside", "--option", ".git/config", ".liftoff/x", "a b"]);
    expect((await previewSave(root, "po")).files).toEqual(["liftoff.yaml"]);
  });
});
