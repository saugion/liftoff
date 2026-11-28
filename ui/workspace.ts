import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoFolders } from "../src/cli/fsutil.js";
import { LIFTOFF_DIR } from "../src/cli/state.js";
import type { CodeHostConfig } from "../src/config/index.js";
import { shQuote } from "../src/connect/shell.js";
import { fill, safeBranch, slugify } from "../src/plan/build.js";
import { gitInfo } from "./detect.js";

// A "workspace": a folder holding several repositories. LiftOff is made for one repository, so the pages say what does
// not work there and offer a repository for the setup alone (ui/persist.ts makes it, on a click). Files only, no git call.
export interface ChildRepo { path: string; url?: string }
export interface Workspace { repos: ChildRepo[]; isRepo: boolean; skipped: boolean }
export const WORKSPACE_DOC = "WORKSPACE.md";
const CHOICE = `${LIFTOFF_DIR}/workspace.json`; // personal, in a folder that ignores itself

// A clone address safe to commit and to paste into a shell: no password or token, nothing a shell or git would read as
// anything but an address. A local path gives none: it means nothing on a colleague's computer.
export function cleanUrl(text: string): string | undefined {
  const SAFE = /^[A-Za-z0-9._~/@:%+-]+$/;
  const web = /^(https?|ssh):\/\/(?:([^/?#]*)@)?([^/?#@]+)(\/[^?#]*)?(?:[?#].*)?$/i.exec(text);
  if (web) {
    const [, scheme, user, host, path = ""] = web;
    const keep = scheme!.toLowerCase() === "ssh" && user ? `${user.split(":")[0]}@` : ""; // ssh needs the user name; a web address needs neither
    const url = `${scheme}://${keep}${host}${path}`;
    return SAFE.test(url) ? url : undefined;
  }
  return /^[A-Za-z0-9][\w.-]*@[\w.-]+:[A-Za-z0-9._~/%+-]+$/.test(text) ? text : undefined;
}

// The repositories directly below `root`, each with its clone address when it has one that is safe to share.
export function childRepos(root: string): ChildRepo[] {
  return repoFolders(root).map((path) => {
    const url = cleanUrl(gitInfo(join(root, path)).originUrl ?? "");
    return { path, ...(url && { url }) };
  });
}

// The folders .gitmodules lists: they are part of the root's repository, not repositories of the workspace.
function submodules(root: string): Set<string> {
  let text = "";
  try {
    text = readFileSync(join(root, ".gitmodules"), "utf8");
  } catch {
    // none
  }
  return new Set([...text.matchAll(/^[ \t]*path[ \t]*=[ \t]*(?:"([^"\r\n]*)"|([^#;\r\n]*))/gm)].map((m) => (m[1] ?? m[2]!).trim().replace(/^\.\/|\/+$/g, "")));
}

// The repositories LiftOff onboards: a `.git` of their own directly below the root, no submodule, not left out.
export function workspaceRepos(root: string, exclude: string[] = []): string[] {
  const not = new Set([...submodules(root), ...exclude]);
  return repoFolders(root).filter((f) => !not.has(f));
}

const skipped = (root: string) => {
  try {
    return JSON.parse(readFileSync(join(root, CHOICE), "utf8")).skipped === true;
  } catch {
    return false;
  }
};
export const choiceFile = (root: string) => join(root, CHOICE);

// Undefined when the folder holds no repository below it. `isRepo` is about this folder itself, not a repository around it.
export function workspaceState(root: string): Workspace | undefined {
  const repos = childRepos(root);
  const isRepo = existsSync(join(root, ".git"));
  return repos.length === 0 ? undefined : { repos, isRepo, skipped: skipped(root) };
}

const literal = (path: string) => path.replace(/[*?[\]\\]/g, "\\$&");
export const ignoreLine = (folder: string) => `/${literal(folder)}/`;

// The files LiftOff writes at the top of a project. Some of them can also hold a person's own keys.
const SHARED = [".gitignore", ".gitattributes", WORKSPACE_DOC, "liftoff.yaml", "AGENTS.md", "CLAUDE.md", "CONSTRAINTS.md", ".github/copilot-instructions.md"];
export const MAY_HOLD_KEYS = [".mcp.json", ".claude/settings.json", ".vscode/mcp.json", ".vscode/settings.json"];

// Lines that let one path through the "ignore everything" below. Two levels are open already; a deeper one is opened
// folder by folder, each closed again except for the way down.
function allow(path: string, folder = false): string[] {
  const parts = path.split("/").filter((s) => s !== "" && s !== ".").map(literal);
  const out: string[] = [];
  for (let n = 2; n < parts.length; n++) out.push(`!/${parts.slice(0, n).join("/")}/`, `/${parts.slice(0, n).join("/")}/*`);
  const full = parts.join("/");
  return folder ? [...out, ...(parts.length > 1 ? [`!/${full}/`] : []), `!/${full}/**`] : [...out, `!/${full}`];
}

// The lines that let `file` into a repository whose .gitignore keeps it out; `closed` are its folders that are ignored.
export function letIn(file: string, closed: string[]): string[] {
  return [...closed.flatMap((d) => [`!/${literal(d)}/`, `/${literal(d)}/*`]), `!/${literal(file)}`];
}

// The branch and commit message of the commands that share a repository's setup, from the team's own patterns, so they
// match the names Build would make (the server accepts them only with a ticket key).
export interface ShareNames { branch: string; message: string }
export function shareNames(key: string, codeHost?: CodeHostConfig): ShareNames {
  const summary = "LiftOff setup";
  const values = { key, slug: slugify(summary), type: "chore", summary, commitType: "chore" };
  return {
    branch: safeBranch(fill(codeHost?.conventions.branchPattern ?? "{key}-{slug}", values)),
    message: fill(codeHost?.conventions.titlePattern ?? "{key}: {summary}", values),
  };
}

const UNQUOTABLE = /[\u0000-\u001f\u007f]/; // a pasted line break would run what follows it
const PATTERN = /[*?[\]\\]|^:/; // git reads names after `--` as patterns: these would take more than the file itself

// For the engineer to copy and run at the top of the workspace. LiftOff runs none of them. Undefined when a name cannot
// be written safely. Only the listed files are named, so that other work stays out of the commit.
export function shareCommands(repo: string, files: string[], names: ShareNames, push = true): string[] | undefined {
  if (files.length === 0 || [repo, names.branch, names.message, ...files].some((s) => UNQUOTABLE.test(s)) || files.some((f) => PATTERN.test(f))) return undefined;
  const at = `git -C ${shQuote(repo)}`;
  const list = files.map(shQuote).join(" ");
  const steps = [`switch -c ${shQuote(names.branch)}`, `add -- ${list}`, `commit -m ${shQuote(names.message)} -- ${list}`, ...(push ? [`push -u origin ${shQuote(names.branch)}`] : [])];
  // Chained: pasted as a block, nothing after a step that failed runs (a commit would land on the branch the person is on).
  return steps.map((step, i) => `${at} ${step}${i < steps.length - 1 ? " &&" : ""}`);
}

// The .gitignore of a configuration repository. A folder of repositories holds loose files (notes, exports, scripts with
// keys) that must never travel, so everything is ignored but what LiftOff writes. What the file already said comes after
// and keeps the last word; the repositories come last, so that nothing opens them.
export function configIgnore(had: string, repos: ChildRepo[], o: { files: string[]; brain: string; keepOut: string[] }): string {
  const shared = [...new Set([...SHARED, ...MAY_HOLD_KEYS, ...o.files])].filter((f) => !o.keepOut.includes(f));
  const block = [
    "# LiftOff configuration repository: everything is ignored except what LiftOff writes.",
    "# To share something else, add a line below, such as !/notes.md or !/my-folder/**",
    "/*", "!/*/", "/*/*", "!/*/AGENTS.md", "!/*/CLAUDE.md",
    ...allow(o.brain, true),
    ...new Set(shared.flatMap((f) => allow(f))),
  ];
  const lines = new Set(had.split(/\r?\n/));
  const closed = repos.map((r) => ignoreLine(r.path)).filter((l) => !lines.has(l));
  return `${[...block, ...(had ? [had.replace(/\n$/, "")] : []), ...closed].join("\n")}\n`;
}

const quoted = (folder: string) => (/^[\w.@-]+$/.test(folder) ? folder : /^[\w.@ -]+$/.test(folder) ? `'${folder}'` : undefined);

export function workspaceDoc(repos: ChildRepo[]): string {
  const commands = repos.flatMap((r) => (r.url && quoted(r.path) ? [`git clone ${r.url} ${quoted(r.path)}`] : []));
  const others = repos.filter((r) => !r.url || !quoted(r.path)).map((r) => (r.url ? `- \`${r.path}\`: ${r.url}` : `- \`${r.path}\``));
  return [
    "# Workspace",
    "",
    "This repository holds the shared LiftOff setup of a folder that contains several repositories. It does not hold their code.",
    "",
    ...(commands.length > 0 ? ["To set up the same folder on another computer, clone this repository, then run these commands inside it:", "", "```sh", ...commands, "```", ""] : []),
    ...(others.length > 0 ? ["Add these by hand:", "", ...others, ""] : []),
    "LiftOff is made for one repository: its build and merge request steps do not work across several repositories yet.",
    "",
  ].join("\n");
}
