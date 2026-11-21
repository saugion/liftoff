import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Saving the setup to the team: the one place the panel runs git, and only after the person has seen the exact files and
// said yes. It commits those files to a new branch and pushes that branch; it never merges, never rebases and never opens
// the merge request. What it may commit is the intersection of two lists: the files the setup guide itself wrote (kept in
// .liftoff/ui-written.json, personal and ignored) and what git says is new or changed. A person's own edit of some other
// AGENTS.md, or any file the guide did not write, is never swept in.
export type Stage = "po" | "tl";
const RECORD = ".liftoff/ui-written.json";
const SAFE = /^[\w.@-]+(?:\/[\w.@-]+)*$/; // a plain relative path: no dot-dot, no spaces, nothing a git option could be mistaken for
const MESSAGE: Record<Stage, string> = {
  po: "chore: LiftOff setup, project and Jira ticket templates",
  tl: "chore: LiftOff setup, technical settings",
};

export interface Record_ { files: string[]; pending: boolean }
export function readRecord(root: string): Record_ {
  try {
    const v = JSON.parse(readFileSync(join(root, RECORD), "utf8"));
    return { files: Array.isArray(v.files) ? v.files.filter((f: unknown): f is string => typeof f === "string") : [], pending: v.pending === true };
  } catch {
    return { files: [], pending: false };
  }
}
const writeRecord = (root: string, r: Record_) => {
  mkdirSync(join(root, ".liftoff"), { recursive: true });
  writeFileSync(join(root, RECORD), JSON.stringify(r) + "\n");
};
// The guide wrote these files and they are not saved yet.
export const recordWritten = (root: string, files: string[]) => {
  const now = readRecord(root);
  writeRecord(root, { files: [...new Set([...now.files, ...files])], pending: true });
};
const markSaved = (root: string) => writeRecord(root, { ...readRecord(root), pending: false });

const git = (root: string, args: string[], timeout = 30_000): Promise<{ code: number; out: string; err: string }> =>
  new Promise((resolve) =>
    execFile("git", args, { cwd: root, encoding: "utf8", timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (e, stdout, stderr) =>
      resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out: String(stdout), err: String(stderr) })),
  );
const line = (r: { out: string; err: string }) => (r.err || r.out).trim().split("\n")[0] ?? "";

export interface Preview { git: boolean; branchNow?: string; remote?: string; files: string[]; branch?: string; base?: string; note?: string; message: string; identity: boolean }

// The paths git reports as new or changed under `root`, relative to `root` (git reports them from the repository's top,
// and a rename comes as the new path followed by the old one).
async function changed(root: string): Promise<string[]> {
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).out.trim();
  const fields = (await git(root, ["status", "--porcelain=v1", "-z", "-uall", "--", "."])).out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    if (f.length < 4) continue;
    if (/^[RC]/.test(f) || /^.[RC]/.test(f)) i++; // the old path of a rename or copy
    const p = f.slice(3);
    if (p.startsWith(prefix)) paths.push(p.slice(prefix.length));
  }
  return paths;
}

// Where the new branch starts. Normally from where the person is. But if their branch holds commits that are not on any
// remote branch, those would travel with the push: then the setup branch starts from the remote's default branch.
async function startPoint(root: string, hasRemote: boolean): Promise<{ start?: string; note?: string }> {
  if (!hasRemote || (await git(root, ["rev-parse", "-q", "--verify", "HEAD"])).code !== 0) return {};
  if ((await git(root, ["branch", "-r", "--contains", "HEAD"])).out.trim() !== "") return {}; // everything here is already shared
  const head = /refs\/remotes\/(.+)/.exec((await git(root, ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"])).out.trim())?.[1];
  for (const c of [head, "origin/main", "origin/master"]) {
    if (c && (await git(root, ["rev-parse", "-q", "--verify", c])).code === 0) {
      return { start: c, note: `Your branch has commits that are not shared yet, so the setup branch starts from ${c} and they are not sent.` };
    }
  }
  return {};
}

// What would be saved: the setup files the guide wrote that git sees as new or changed, nothing else.
export async function previewSave(root: string, stage: Stage): Promise<Preview> {
  const message = MESSAGE[stage];
  if ((await git(root, ["rev-parse", "--is-inside-work-tree"])).code !== 0) return { git: false, files: [], message, identity: false };
  const rec = readRecord(root);
  const dirty = new Set(await changed(root));
  const files = rec.pending ? rec.files.filter((f) => SAFE.test(f) && !f.startsWith(".liftoff/") && !f.startsWith(".git/") && dirty.has(f)).sort() : [];
  const branchNow = (await git(root, ["symbolic-ref", "--short", "-q", "HEAD"])).out.trim() || undefined;
  const remote = (await git(root, ["remote", "get-url", "origin"])).out.trim() || undefined;
  const identity = (await git(root, ["config", "user.email"])).out.trim() !== "";
  let branch = `liftoff/setup-${stage}`;
  for (let n = 2; (await git(root, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`])).code === 0; n++) {
    if (n > 50) return { git: true, files, message, identity, ...(branchNow && { branchNow }), note: "There are too many old setup branches here: delete some and try again." };
    branch = `liftoff/setup-${stage}-${n}`;
  }
  const { start, note } = await startPoint(root, remote !== undefined);
  return { git: true, ...(branchNow && { branchNow }), ...(remote && { remote }), files, branch, ...(start && { base: start }), ...(note && { note }), message, identity };
}

export type Saved = { ok: true; branch: string; files: string[]; pushed: boolean; remote?: string; note?: string } | { ok: false; code: "no-git" | "no-identity" | "nothing" | "changed" | "git-error"; message: string };

// `expected` is the list the person approved: if the working tree has changed since, nothing is committed. If any step
// fails after the branch was made, the person is put back where they were and the empty branch is removed.
export async function save(root: string, stage: Stage, expected: unknown): Promise<Saved> {
  const p = await previewSave(root, stage);
  if (!p.git) return { ok: false, code: "no-git", message: "This folder is not a git repository yet. Run git init in it (or ask an engineer), then save again." };
  if (!p.identity) return { ok: false, code: "no-identity", message: "Git does not know who you are. Run: git config --global user.name \"Your Name\" and git config --global user.email you@example.com, then save again." };
  if (p.files.length === 0) return { ok: false, code: "nothing", message: "There is nothing new to save." };
  if (!p.branch || JSON.stringify(expected) !== JSON.stringify(p.files)) return { ok: false, code: "changed", message: p.note ?? "The files changed since you looked at the list. Look at it again." };
  const branch = p.branch;
  const head = (await git(root, ["rev-parse", "-q", "--verify", "HEAD"])).out.trim();
  const made = await git(root, ["checkout", "-q", "-b", branch, ...(p.base ? [p.base] : [])]);
  if (made.code !== 0) return { ok: false, code: "git-error", message: `git checkout failed: ${line(made)}` };
  for (const s of [["add", "--", ...p.files], ["commit", "-q", "-m", p.message, "--", ...p.files]]) {
    const r = await git(root, s);
    if (r.code !== 0) {
      await git(root, ["restore", "--staged", "--", ...p.files]);
      if (head) await git(root, p.branchNow ? ["checkout", "-q", p.branchNow] : ["checkout", "-q", "--detach", head]);
      if (head) await git(root, ["branch", "-D", branch]);
      return { ok: false, code: "git-error", message: `git ${s[0]} failed, nothing was saved: ${line(r)}` };
    }
  }
  markSaved(root);
  const note = p.note;
  if (!p.remote) return { ok: true, branch, files: p.files, pushed: false, note: "There is no remote called origin, so nothing was pushed. An engineer can push the branch later." };
  const pushed = await git(root, ["push", "-u", "origin", branch], 60_000);
  return pushed.code === 0
    ? { ok: true, branch, files: p.files, pushed: true, remote: p.remote, ...(note && { note }) }
    : { ok: true, branch, files: p.files, pushed: false, remote: p.remote, note: `The save is committed on ${branch}, but the push failed: ${line(pushed)}` };
}

export const hasRecord = (root: string) => existsSync(join(root, RECORD));
