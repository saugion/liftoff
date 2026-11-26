import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureSelfIgnore } from "../src/cli/state.js";
import { isMissing } from "./scaffold.js";
import { childRepos, configIgnore, letIn, MAY_HOLD_KEYS, shareCommands, WORKSPACE_DOC, workspaceDoc, type ShareNames } from "./workspace.js";

// Saving the setup to the team: the one place the panel runs git, and only after the person has seen the exact files and
// said yes. It commits those files to a new branch and pushes that branch (in a repository with no commit yet there is no
// branch to leave alone: they become its first commit); it never merges, never rebases and never opens
// the merge request. The one other thing it does, also on a click: `git init` in a folder of repositories, for a repository
// that holds the setup alone. In the repositories of a workspace it only reads (what is not shared yet, the branch), also
// when a page merely loads, and it writes the commands that share it without running them. What it may commit is the intersection of two lists: the files the setup guide itself wrote (kept in
// .liftoff/ui-written.json, personal and ignored) and what git says is new or changed. A person's own edit of some other
// AGENTS.md, or any file the guide did not write, is never swept in.
export type Stage = "po" | "tl";
const RECORD = ".liftoff/ui-written.json";
const SAFE = /^[\w.@-]+(?:\/[\w.@-]+)*$/; // a plain relative path: no dot-dot, no spaces, nothing a git option could be mistaken for
const MESSAGE: Record<Stage, string> = {
  po: "chore: LiftOff setup, project and Jira ticket templates",
  tl: "chore: LiftOff setup, technical settings",
};

// For a file inside a repository of a workspace: what LiftOff left in it, what the repository's last commit held then,
// and whether it already had changes of the person's own.
export interface Written { wrote: string; head: string; review: boolean }
export interface Record_ { files: string[]; pending: boolean; repos?: Record<string, Written> }
export function readRecord(root: string): Record_ {
  try {
    const v = JSON.parse(readFileSync(join(root, RECORD), "utf8"));
    const repos = v.repos !== null && typeof v.repos === "object" ? { repos: v.repos as Record<string, Written> } : {};
    return { files: Array.isArray(v.files) ? v.files.filter((f: unknown): f is string => typeof f === "string") : [], pending: v.pending === true, ...repos };
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
  writeRecord(root, { ...now, files: [...new Set([...now.files, ...files])], pending: true });
};
const markSaved = (root: string) => writeRecord(root, { ...readRecord(root), pending: false });

const git = (root: string, args: string[], timeout = 30_000): Promise<{ code: number; out: string; err: string }> =>
  new Promise((resolve) =>
    execFile("git", args, { cwd: root, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (e, stdout, stderr) =>
      resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out: String(stdout), err: String(stderr) })),
  );
const line = (r: { out: string; err: string }) => (r.err || r.out).trim().split("\n")[0] ?? "";

export interface Elsewhere { repo: string; files: string[] }
export interface Preview { git: boolean; first?: boolean; branchNow?: string; remote?: string; files: string[]; elsewhere?: Elsewhere[]; ignored?: string[]; branch?: string; base?: string; note?: string; message: string; identity: boolean }

// The paths git reports as new or changed under `root`, relative to `root` (git reports them from the repository's top,
// and a rename comes as the new path followed by the old one).
async function changed(root: string): Promise<string[]> {
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).out.trim();
  const fields = (await git(root, ["--no-optional-locks", "status", "--porcelain=v1", "-z", "-uall", "--", "."])).out.split("\0"); // reads only: the index is not refreshed
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

// ---- onboarding the repositories of a workspace: what LiftOff wrote in each that is not shared yet. Reads only. ------------
export interface ToShare { repo: string; files: string[]; review: string[]; ignored: { file: string; lines: string[] }[]; branch?: string; base?: string; warning?: string; commands?: string[]; why?: string }

// Empty for what cannot be read, or is far larger than anything LiftOff writes: it never equals what LiftOff left there.
const contentSha = (file: string): string => {
  try {
    if (statSync(file).size > 1_000_000) return "";
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return "";
  }
};
const committed = async (at: string, path: string) => (await git(at, ["rev-parse", "-q", "--verify", `HEAD:${path}`])).out.trim();

// The files with changes in each repository, before LiftOff writes: what is in them then belongs to the person.
export async function uncommitted(root: string, repos: string[]): Promise<Map<string, string>> {
  const found = await Promise.all(repos.map(async (repo) => (await changed(join(root, repo))).map((f) => [`${repo}/${f}`, contentSha(join(root, repo, f))] as const)));
  return new Map(found.flat());
}

// Called after a write, with what `uncommitted` said just before it.
export async function noteRepoWrites(root: string, repos: string[], written: string[], before: Map<string, string>): Promise<void> {
  const rec = readRecord(root);
  const notes = { ...rec.repos };
  for (const file of written) {
    const repo = repos.find((r) => file.startsWith(`${r}/`));
    if (repo === undefined) continue;
    const head = await committed(join(root, repo), file.slice(repo.length + 1));
    const last = notes[file]?.head === head ? notes[file] : undefined; // a commit since the last write closes that story
    const theirs = before.has(file) && before.get(file) !== last?.wrote;
    notes[file] = { wrote: contentSha(join(root, file)), head, review: theirs || last?.review === true };
  }
  if (Object.keys(notes).length > 0) writeRecord(root, { ...rec, repos: notes });
}

// The branch a merge request of this repository would go to, and why running the commands now would send more than the setup.
async function branches(at: string, target: string | undefined): Promise<{ branch?: string; base?: string; warning?: string }> {
  const has = async (ref: string) => (await git(at, ["rev-parse", "-q", "--verify", ref])).code === 0;
  const branch = (await git(at, ["symbolic-ref", "--short", "-q", "HEAD"])).out.trim() || undefined;
  const origin = /^refs\/remotes\/origin\/(.+)$/.exec((await git(at, ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"])).out.trim())?.[1];
  let base: string | undefined;
  for (const name of [target, origin, "main", "master"]) {
    if (name && ((await has(`refs/heads/${name}`)) || (await has(`refs/remotes/origin/${name}`)))) {
      base = name;
      break;
    }
  }
  const state = { ...(branch && { branch }), ...(base && { base }) };
  if (base === undefined) return { ...state, warning: "LiftOff cannot tell which is the default branch of this repository." };
  if (branch === undefined) return { ...state, warning: `This repository is not on a branch. Switch to ${base} first.` };
  if (branch !== base) return { ...state, warning: `This repository is on ${branch}, not on ${base}: a merge request from here would carry the commits of ${branch}. Switch to ${base} first.` };
  const ahead = Number((await git(at, ["rev-list", "--count", `refs/remotes/origin/${base}..HEAD`])).out.trim() || 0);
  return ahead > 0 ? { ...state, warning: `${base} holds ${ahead} commit${ahead === 1 ? "" : "s"} not on the server yet: a merge request from here would carry ${ahead === 1 ? "it" : "them"}.` } : state;
}

// The lines for the end of a .gitignore that let one file in. A folder that is ignored has to be opened first, then
// closed again except for the way down, so that nothing else comes with the file.
async function linesFor(at: string, file: string): Promise<string[]> {
  const parts = file.split("/");
  const closed: string[] = [];
  for (let n = 1; n < parts.length; n++) {
    const dir = parts.slice(0, n).join("/");
    if ((await git(at, ["check-ignore", "-q", "--", `${dir}/`])).code === 0) closed.push(dir);
  }
  return letIn(file, closed);
}

// The commands for one repository, on a branch name nobody has taken, here or on the server as last fetched.
async function commandsFor(at: string, repo: string, files: string[], names: ShareNames): Promise<{ commands?: string[]; why?: string }> {
  const taken = async (b: string) => (await Promise.all([`refs/heads/${b}`, `refs/remotes/origin/${b}`].map((ref) => git(at, ["rev-parse", "-q", "--verify", ref])))).some((r) => r.code === 0);
  let branch = names.branch;
  for (let n = 2; await taken(branch); n++) {
    if (n > 50) return { why: `There are too many branches called ${names.branch} here: delete some and try again.` };
    branch = `${names.branch}-${n}`;
  }
  const commands = shareCommands(repo, files, { ...names, branch });
  return commands ? { commands } : { why: "A file or folder name here cannot be written safely in a command: commit these files by hand." };
}

export async function toShare(root: string, repos: string[], target?: string, names?: ShareNames): Promise<ToShare[]> {
  const rec = readRecord(root);
  const found = await Promise.all(repos.map(async (repo): Promise<ToShare | undefined> => {
    const at = join(root, repo);
    // only plain paths below this repository: the record is a file somebody may have edited
    const wrote = rec.files.filter((f) => f.startsWith(`${repo}/`)).map((f) => f.slice(repo.length + 1)).filter((f) => f.split("/").every((s) => s !== "" && s !== "." && s !== ".." && s !== ".git") && existsSync(join(at, f)));
    if (wrote.length === 0) return undefined;
    const dirty = new Set(await changed(at));
    const files: string[] = [], review: string[] = [], ignored: ToShare["ignored"] = [];
    for (const f of wrote.sort()) {
      if (dirty.has(f)) {
        const note = rec.repos?.[`${repo}/${f}`];
        if (note && note.head !== (await committed(at, f))) continue; // committed since LiftOff wrote it: shared, or on its way
        files.push(f);
        // without a note (an earlier LiftOff wrote it) nothing is known about what it holds
        if (!note || note.review || note.wrote !== contentSha(join(at, f))) review.push(f);
      } else if ((await git(at, ["check-ignore", "-q", "--", f])).code === 0) ignored.push({ file: f, lines: await linesFor(at, f) });
    }
    if (files.length + ignored.length === 0) return undefined;
    const where = await branches(at, target);
    // no command before a warning is dealt with
    const how = names && files.length > 0 && where.warning === undefined ? await commandsFor(at, repo, files, names) : {};
    return { repo, files, review, ignored, ...where, ...how };
  }));
  return found.filter((e) => e !== undefined);
}
