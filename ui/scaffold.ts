import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { atomicWrite, isInside, resolveReal } from "../src/cli/fsutil.js";
import { buildInfo } from "../src/connect/info.js";
import type { Config } from "../src/config/index.js";
import { INSTALLED_VERSION } from "../src/cli/version.js";

// The files Init used to write by hand, written from the same templates (plugin/skills/liftoff-init/assets) with
// what the panel knows. Never replaces a file that exists: a team's own AGENTS.md or CONSTRAINTS.md wins.
export interface ModuleInfo { id: string; path: string; stack: string; build?: string; test?: string; lint?: string }
export interface ScaffoldInput { name: string; purpose: string; constraintsFile: string; targets: string[]; modules: ModuleInfo[]; commands: { build?: string; test?: string; lint?: string } }
// A settings file left alone, and what the person has to add to it.
export interface ByHand { file: string; add: Record<string, unknown> }
export interface Scaffolded { written: string[]; kept: string[]; byHand?: ByHand[] }

const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
const cmd = (c: string | undefined) => (c ? `\`${c}\`` : "not configured");
const AGENT_FILE: Record<string, string> = { "claude-code": "`CLAUDE.md` (Claude Code)", copilot: "`.github/copilot-instructions.md` (GitHub Copilot)" };

// The two blocks of the root AGENTS.md that depend on what the technical lead confirms. They are written between
// markers so a later run can refresh exactly them and nothing a team added around them.
const block = (name: string, text: string) => `<!-- liftoff:${name} -->\n${text}\n<!-- /liftoff:${name} -->`;
const modulesText = (i: ScaffoldInput) =>
  i.modules.length === 0 ? "Single application: no modules." : ["| Module | Path | Stack |", "|---|---|---|", ...i.modules.map((m) => `| ${m.id} | \`${m.path}\` | ${m.stack || "-"} |`)].join("\n");
const pathsText = (i: ScaffoldInput) => i.modules.map((m) => `| \`${m.path}/\` | ${m.id} module |`).join("\n");
const agentsText = (i: ScaffoldInput) => i.targets.map((t) => `- ${AGENT_FILE[t] ?? t}`).join("\n");
const commandsText = (i: ScaffoldInput) =>
  i.modules.length === 0
    ? ["| Task | Command |", "|---|---|", `| Build | ${cmd(i.commands.build)} |`, `| Test | ${cmd(i.commands.test)} |`, `| Lint/format | ${cmd(i.commands.lint)} |`].join("\n")
    : "Each module lists its own commands in its `AGENTS.md`.";

// Not there, or there with nothing in it: an empty file holds no team's words, so the template may fill it.
export const isMissing = (file: string): boolean => {
  try {
    const st = lstatSync(file);
    return st.isFile() && readFileSync(file, "utf8").trim() === "";
  } catch {
    return !existsSync(file);
  }
};

// The files the guide and the control panel will create, to say so before they do.
export const toCreate = (root: string, modulePaths: string[], constraintsFile: string): string[] =>
  [...new Set(["AGENTS.md", ...modulePaths.map((p) => `${p.replace(/^\.\/|\/+$/g, "")}/AGENTS.md`), constraintsFile])].filter((rel) => isMissing(join(root, rel)));

// The stack each module has in the root table today: what someone confirmed wins over what files suggest.
export const stacksIn = (root: string): Map<string, string> => {
  const file = join(root, "AGENTS.md");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  return new Map([...text.matchAll(/^\| [^|\n]+? \| `([^`\n]+)` \| ([^|\n]*?) \|$/gm)].filter((m) => m[2] !== "-").map((m) => [m[1]!, m[2]!]));
};

// Brings the root AGENTS.md up to date after the technical lead confirmed the modules. It touches only the marked
// blocks: anything a team wrote or changed stays as it is. Returns true when the file changed.
export function refreshRoot(root: string, input: ScaffoldInput, only: string[] = ["modules", "commands", "agents"]): boolean {
  const file = join(root, "AGENTS.md");
  if (!existsSync(file)) return false;
  const before = readFileSync(file, "utf8");
  let text = before;
  for (const [name, now] of [["modules", modulesText(input)], ["commands", commandsText(input)], ["agents", agentsText(input)]] as const) {
    if (!only.includes(name)) continue;
    const re = new RegExp(`<!-- liftoff:${name} -->\\n[\\s\\S]*?\\n<!-- /liftoff:${name} -->`);
    if (re.test(text)) text = text.replace(re, () => block(name, now));
  }
  if (text === before) return false;
  atomicWrite(file, text);
  return true;
}

export function scaffold(root: string, assetsDir: string, input: ScaffoldInput): Scaffolded {
  const out: Scaffolded = { written: [], kept: [] };
  const tpl = (n: string) => readFileSync(join(assetsDir, n), "utf8");
  const put = (rel: string, text: string) => {
    const file = join(root, rel);
    // a folder that is a link leading out of the project must not take a file with it
    if (!isInside(resolveReal(root), resolveReal(file))) throw new Error(`${rel} leads outside the project`);
    if (!isMissing(file)) return void out.kept.push(rel);
    mkdirSync(dirname(file), { recursive: true });
    atomicWrite(file, text);
    out.written.push(rel);
  };
  put("AGENTS.md", fill(tpl("agents-md-template.md"), {
    PROJECT_NAME: input.name, PURPOSE: input.purpose.trim() || "<!-- TODO: purpose -->", CONSTRAINTS_FILE: input.constraintsFile,
    MODULE_TABLE: block("modules", modulesText(input)), COMMANDS_TABLE: block("commands", commandsText(input)),
    EXTRA_RULES: "", EXTRA_PATHS: pathsText(input), // rows of a table: no marker can sit inside it
    AGENT_FILES_LIST: block("agents", agentsText(input)),
  }));
  for (const m of input.modules) {
    put(`${m.path}/AGENTS.md`, fill(tpl("module-agents-md-template.md"), {
      MODULE_NAME: m.id, REL_PATH_TO_ROOT: "../".repeat(m.path.split("/").filter(Boolean).length), STACK: m.stack || "-", MODULE_PATH: m.path,
      BUILD_CMD: cmd(m.build), TEST_CMD: cmd(m.test), LINT_CMD: cmd(m.lint), RUN_CMD: "not configured",
    }));
  }
  const first = input.modules[0] ?? input.commands;
  put(input.constraintsFile, fill(tpl("constraints-template.md"), {
    PROJECT_NAME: input.name, BUILD_CMD: first.build ? `\`${first.build}\`` : "not configured", TEST_CMD: first.test ? `\`${first.test}\`` : "not configured",
    LINT_CMD: first.lint ? `\`${first.lint}\`` : "not configured", COVERAGE_TARGET: first.test ? "80%" : "n/a", COVERAGE_CMD: first.test ? `\`${first.test}\`` : "not configured",
  }));
  return out;
}

const readJson = (file: string): Record<string, any> => {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
// A settings file as it is, `{}` when there is nothing in it. Undefined when it holds something this cannot read
// (comments, a trailing comma, not an object): writing over it would destroy what a person put there.
const settingsAt = (file: string): Record<string, any> | undefined => {
  if (isMissing(file)) return {};
  try {
    const v = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
};
const writeJson = (root: string, rel: string, value: unknown) => {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  atomicWrite(file, JSON.stringify(value, null, 2) + "\n");
};

// .claude/settings.json: the marketplace and the plugin switch, each only if absent (the teammate's Claude Code
// then offers to install the plugin). The fragment is the one the plugin ships, pinned to its own release.
export function claudeSettings(root: string, assetsDir: string, byHand: ByHand[] = []): string | undefined {
  const rel = ".claude/settings.json";
  const file = join(root, rel);
  const fragment = readJson(join(assetsDir, "marketplace-entry.json"));
  const now = settingsAt(file);
  if (now === undefined) return void byHand.push({ file: rel, add: fragment });
  const next = { ...now, extraKnownMarketplaces: { ...fragment.extraKnownMarketplaces, ...now.extraKnownMarketplaces }, enabledPlugins: { ...fragment.enabledPlugins, ...now.enabledPlugins } };
  if (JSON.stringify(next) === JSON.stringify(now) && existsSync(file)) return undefined;
  writeJson(root, rel, next);
  return rel;
}

// The Jira server entry of each agent's MCP file, from the same code the Connect skill uses. A different entry of
// ours (same name) is replaced; every other server in the file stays.
export function mcpFiles(root: string, config: Config, byHand: ByHand[] = []): string[] {
  const written: string[] = [];
  for (const m of buildInfo(config, INSTALLED_VERSION).mcp) {
    const now = settingsAt(join(root, m.file));
    if (now === undefined) {
      byHand.push({ file: m.file, add: { [m.serversKey]: { [m.server]: m.entry } } });
      continue;
    }
    const servers = { ...(now[m.serversKey] ?? {}) };
    if (JSON.stringify(servers[m.server]) === JSON.stringify(m.entry)) continue;
    servers[m.server] = m.entry;
    writeJson(root, m.file, { ...now, [m.serversKey]: servers });
    written.push(relative(root, join(root, m.file)));
  }
  return written;
}

// ---- the project brain: what the technical lead's "yes" in the guide turns on ------------------------------------------------
// brain-init (the CLI's own function) makes the brain's folders. The four things it only proposes, because they change files the
// whole team shares, are applied here, since the lead's yes is the approval and the save lists every file for a second look:
// a pointer in AGENTS.md, a rule that stops edits of the brain's raw sources, the same for VS Code, and a merge rule for the log.
interface BrainProposals { claudeSettings?: { permissions: { deny: string[] } }; vscodeSettings?: Record<string, Record<string, boolean>>; gitattributes: string; agentsMd: string }

const inside = (root: string, rel: string) => {
  const abs = join(root, rel);
  if (!isInside(resolveReal(root), resolveReal(abs))) throw new Error(`${rel} leads outside the project`);
  return abs;
};
const mergeJson = (root: string, rel: string, add: object, byHand: ByHand[], merge: (now: Record<string, any>) => Record<string, any>): boolean => {
  const file = inside(root, rel);
  const now = settingsAt(file);
  if (now === undefined) {
    byHand.push({ file: rel, add: add as Record<string, unknown> });
    return false;
  }
  const next = merge(JSON.parse(JSON.stringify(now)));
  if (JSON.stringify(next) === JSON.stringify(now) && existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true });
  atomicWrite(file, JSON.stringify(next, null, 2) + "\n");
  return true;
};

// Returns the files it changed (relative to the project). Everything is additive and safe to run twice.
export function brainExtras(root: string, p: BrainProposals, byHand: ByHand[] = []): string[] {
  const touched: string[] = [];
  const agents = inside(root, "AGENTS.md");
  if (existsSync(agents)) {
    const text = readFileSync(agents, "utf8");
    if (!text.includes("<!-- liftoff:brain -->")) {
      atomicWrite(agents, `${text.replace(/\n*$/, "\n")}\n<!-- liftoff:brain -->\n${p.agentsMd}\n<!-- /liftoff:brain -->\n`);
      touched.push("AGENTS.md");
    }
  }
  if (p.claudeSettings && mergeJson(root, ".claude/settings.json", p.claudeSettings, byHand, (c) => ({ ...c, permissions: { ...c.permissions, deny: [...new Set([...(c.permissions?.deny ?? []), ...p.claudeSettings!.permissions.deny])] } }))) touched.push(".claude/settings.json");
  if (p.vscodeSettings && mergeJson(root, ".vscode/settings.json", p.vscodeSettings, byHand, (c) => Object.fromEntries([...Object.entries(c), ...Object.entries(p.vscodeSettings!).map(([k, v]) => [k, { ...(c[k] ?? {}), ...v }])]))) touched.push(".vscode/settings.json");
  const attrs = inside(root, ".gitattributes");
  const now = existsSync(attrs) ? readFileSync(attrs, "utf8") : "";
  if (!now.split(/\r?\n/).includes(p.gitattributes)) {
    atomicWrite(attrs, `${now.replace(/\n*$/, now ? "\n" : "")}${p.gitattributes}\n`);
    touched.push(".gitattributes");
  }
  return touched;
}
