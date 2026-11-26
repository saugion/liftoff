import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LIFTOFF_DIR } from "../src/cli/state.js";
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

// The folders directly below `root` that are repositories of their own (a `.git` folder, or file for a worktree).
export function childRepos(root: string): ChildRepo[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !/[\r\n]/.test(e.name) && existsSync(join(root, e.name, ".git")))
    .map((e) => {
      const url = cleanUrl(gitInfo(join(root, e.name)).originUrl ?? "");
      return { path: e.name, ...(url && { url }) };
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));
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
