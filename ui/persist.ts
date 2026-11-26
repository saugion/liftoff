import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureSelfIgnore } from "../src/cli/state.js";
import { isMissing } from "./scaffold.js";
import { childRepos, configIgnore, MAY_HOLD_KEYS, WORKSPACE_DOC, workspaceDoc } from "./workspace.js";

// Saving the setup to the team: the one place the panel runs git, and only after the person has seen the exact files and
// said yes. It commits those files to a new branch and pushes that branch (in a repository with no commit yet there is no
// branch to leave alone: they become its first commit); it never merges, never rebases and never opens
// the merge request. The one other thing it does, also on a click: `git init` in a folder of repositories, for a repository
// that holds the setup alone. What it may commit is the intersection of two lists: the files the setup guide itself wrote (kept in
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

export interface Elsewhere { repo: string; files: string[] }
export interface Preview { git: boolean; first?: boolean; branchNow?: string; remote?: string; files: string[]; elsewhere?: Elsewhere[]; ignored?: string[]; branch?: string; base?: string; note?: string; message: string; identity: boolean }

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

// What the guide wrote inside the repositories below this folder, still uncommitted there. A save here cannot take them:
// they are named, so that nobody believes they were shared.
async function inOtherRepos(root: string, files: string[]): Promise<Elsewhere[]> {
  const out: Elsewhere[] = [];
  for (const { path } of childRepos(root)) {
    const wrote = files.filter((f) => f.startsWith(`${path}/`)).map((f) => f.slice(path.length + 1));
    if (wrote.length === 0) continue;
    const dirty = new Set(await changed(join(root, path)));
    const left = wrote.filter((f) => dirty.has(f)).sort();
    if (left.length > 0) out.push({ repo: path, files: left });
  }
  return out;
}

// What the guide wrote here and .gitignore keeps out of git: named too, never forced in.
async function keptOut(root: string, files: string[]): Promise<string[]> {
  const repos = childRepos(root).map((r) => `${r.path}/`);
  const here = files.filter((f) => SAFE.test(f) && !f.startsWith(".liftoff/") && !repos.some((r) => f.startsWith(r)) && existsSync(join(root, f)));
  return here.length === 0 ? [] : (await git(root, ["check-ignore", "--", ...here])).out.split("\n").filter(Boolean).sort();
}

// What would be saved: the setup files the guide wrote that git sees as new or changed, nothing else.
export async function previewSave(root: string, stage: Stage): Promise<Preview> {
  const message = MESSAGE[stage];
  const rec = readRecord(root);
  const other = await inOtherRepos(root, rec.files);
  const elsewhere = other.length > 0 ? { elsewhere: other } : {};
  if ((await git(root, ["rev-parse", "--is-inside-work-tree"])).code !== 0) return { git: false, files: [], ...elsewhere, message, identity: false };
  const dirty = new Set(await changed(root));
  const files = rec.pending ? rec.files.filter((f) => SAFE.test(f) && !f.startsWith(".liftoff/") && !f.startsWith(".git/") && dirty.has(f)).sort() : [];
  const out = await keptOut(root, rec.files);
  const left = { ...elsewhere, ...(out.length > 0 && { ignored: out }) };
  const branchNow = (await git(root, ["symbolic-ref", "--short", "-q", "HEAD"])).out.trim() || undefined;
  const remote = (await git(root, ["remote", "get-url", "origin"])).out.trim() || undefined;
  const identity = (await git(root, ["config", "user.email"])).out.trim() !== "";
  if (branchNow && (await git(root, ["rev-parse", "-q", "--verify", "HEAD"])).code !== 0) {
    return { git: true, first: true, branchNow, ...(remote && { remote }), files, ...left, branch: branchNow, message, identity };
  }
  let branch = `liftoff/setup-${stage}`;
  for (let n = 2; (await git(root, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`])).code === 0; n++) {
    if (n > 50) return { git: true, files, ...left, message, identity, ...(branchNow && { branchNow }), note: "There are too many old setup branches here: delete some and try again." };
    branch = `liftoff/setup-${stage}-${n}`;
  }
  const { start, note } = await startPoint(root, remote !== undefined);
  return { git: true, ...(branchNow && { branchNow }), ...(remote && { remote }), files, ...left, branch, ...(start && { base: start }), ...(note && { note }), message, identity };
}

export type Saved = { ok: true; first?: boolean; branch: string; files: string[]; pushed: boolean; remote?: string; note?: string } | { ok: false; code: "no-git" | "no-identity" | "nothing" | "changed" | "git-error"; message: string };

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
  const first = p.first ? { first: true } : {};
  const made = p.first ? { code: 0, out: "", err: "" } : await git(root, ["checkout", "-q", "-b", branch, ...(p.base ? [p.base] : [])]);
  if (made.code !== 0) return { ok: false, code: "git-error", message: `git checkout failed: ${line(made)}` };
  for (const s of [["add", "--", ...p.files], ["commit", "-q", "-m", p.message, "--", ...p.files]]) {
    const r = await git(root, s);
    if (r.code !== 0) {
      await git(root, head ? ["restore", "--staged", "--", ...p.files] : ["rm", "--cached", "-q", "--ignore-unmatch", "--", ...p.files]);
      if (head) await git(root, p.branchNow ? ["checkout", "-q", p.branchNow] : ["checkout", "-q", "--detach", head]);
      if (head) await git(root, ["branch", "-D", branch]);
      return { ok: false, code: "git-error", message: `git ${s[0]} failed, nothing was saved: ${line(r)}` };
    }
  }
  markSaved(root);
  const note = p.note;
  const later = p.first
    ? `There is no remote called origin, so nothing was pushed. Create an empty project on your GitLab, then run in this folder: git remote add origin <its address> and git push -u origin ${branch}`
    : "There is no remote called origin, so nothing was pushed. An engineer can push the branch later.";
  if (!p.remote) return { ok: true, ...first, branch, files: p.files, pushed: false, note: later };
  const pushed = await git(root, ["push", "-u", "origin", branch], 60_000);
  return pushed.code === 0
    ? { ok: true, ...first, branch, files: p.files, pushed: true, remote: p.remote, ...(note && { note }) }
    : { ok: true, ...first, branch, files: p.files, pushed: false, remote: p.remote, note: `The save is committed on ${branch}, but the push failed: ${line(pushed)}` };
}

// A repository for the setup alone, in a folder of repositories: `git init` on `main`, a .gitignore that lets through only
// what LiftOff writes (what the file already says stays), and the clone addresses written down. Nothing is committed or
// sent, and nothing is written inside the repositories below. `existing` are setup files already there, so that the first
// save can take them; `paths` are where the config puts the quality bar and the brain.
export async function createConfigRepo(root: string, existing: string[], paths: { constraints: string; brain: string }): Promise<{ ok: true; files: string[] } | { ok: false; message: string }> {
  const repos = childRepos(root);
  if (existsSync(join(root, ".git"))) return { ok: false, message: "This folder is a git repository already." };
  if (repos.length === 0) return { ok: false, message: "There is no repository below this folder." };
  const ignore = join(root, ".gitignore");
  if (lstatSync(ignore, { throwIfNoEntry: false })?.isSymbolicLink()) return { ok: false, message: ".gitignore is a link: replace it with a file first, so that nothing outside this folder is changed." };
  const made = await git(root, ["init", "-q"]);
  const named = made.code === 0 ? await git(root, ["symbolic-ref", "HEAD", "refs/heads/main"]) : made;
  if (named.code !== 0) return { ok: false, message: `git init failed: ${line(named)}` };
  const had = existsSync(ignore) ? readFileSync(ignore, "utf8") : "";
  // a settings file that is there already, and that LiftOff did not write, may hold the person's own keys: it stays out
  const mine = new Set(readRecord(root).files);
  const keepOut = MAY_HOLD_KEYS.filter((f) => !mine.has(f) && existsSync(join(root, f)));
  writeFileSync(ignore, configIgnore(had, repos, { files: [paths.constraints], brain: paths.brain, keepOut }));
  const doc = isMissing(join(root, WORKSPACE_DOC));
  if (doc) writeFileSync(join(root, WORKSPACE_DOC), workspaceDoc(repos));
  const files = [".gitignore", ...(doc ? [WORKSPACE_DOC] : []), ...existing];
  ensureSelfIgnore(root);
  recordWritten(root, files);
  return { ok: true, files };
}

export const hasRecord = (root: string) => existsSync(join(root, RECORD));
