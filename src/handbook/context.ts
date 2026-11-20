// Context hygiene: what makes a session expensive without making it better. Offline, over files the repo already has, and only
// warnings. They count lines and characters, never tokens (the CLI has no tokenizer and no network); the messages say so.
// See docs/decisions/handbook-practice-context-hygiene.md for where each default comes from.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { parseDocument } from "yaml";
import type { Finding } from "../brain/check.js";

export interface ContextSettings { maxInstructionLines: number; maxHooks: number; maxMcpServers: number; skip: string[] }
export const CONTEXT_DEFAULTS: ContextSettings = { maxInstructionLines: 200, maxHooks: 40, maxMcpServers: 5, skip: [] };
export const MAX_SKILL_LINES = 500;
export const MAX_SKILL_DESCRIPTION = 1536;
const IMPORT_MIN_LINES = 100;
const EMPHASIS_WORDS = /\b(?:IMPORTANT|ALWAYS|NEVER|MUST|CRITICAL)\b/g;

export interface ContextInput {
  realRoot: string;
  settings: ContextSettings;
  instructionFiles: string[]; // CLAUDE.md, AGENTS.md, module AGENTS.md, CONSTRAINTS.md, relative to the root
}

const lines = (text: string): number => text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").length;
const readIf = (root: string, rel: string): string | undefined => {
  try { return existsSync(join(root, rel)) && statSync(join(root, rel)).isFile() ? readFileSync(join(root, rel), "utf8") : undefined; } catch { return undefined; }
};

// Every SKILL.md of the repo's own skills and of a plugin folder, as paths relative to the root.
function skillFiles(root: string): string[] {
  const out: string[] = [];
  for (const base of [".claude/skills", "plugin/skills", "skills"]) {
    const dir = join(root, base);
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir).sort()) if (existsSync(join(dir, n, "SKILL.md"))) out.push(`${base}/${n}/SKILL.md`);
  }
  return out;
}

export function checkContext({ realRoot, settings, instructionFiles }: ContextInput): Finding[] {
  const findings: Finding[] = [];
  const warn = (code: string, file: string, message: string, line?: number) => {
    if (!settings.skip.includes(code)) findings.push({ code, level: "warning", file, message, ...(line !== undefined && { line }) });
  };
  const max = settings.maxInstructionLines;

  for (const rel of [...new Set(instructionFiles)]) {
    const text = readIf(realRoot, rel);
    if (text === undefined) continue;
    const n = lines(text);
    if (n > max) warn("context-size", rel, `${n} lines, more than ${max} (lines, not tokens): a long always-loaded file costs on every turn and is followed less; move the explanations to a handbook page or a skill (handbook: context-on-demand)`);

    // `@path` imports load in full: they move text, they do not remove it.
    let imported = 0;
    text.replace(/\r\n?/g, "\n").split("\n").forEach((l, i) => {
      const m = /^\s*@(\S+)\s*$/.exec(l);
      if (!m || m[1]!.startsWith("/") || m[1]!.includes("..")) return;
      const target = readIf(realRoot, posix.join(posix.dirname(rel), m[1]!));
      if (target !== undefined && lines(target) > IMPORT_MIN_LINES) {
        imported += lines(target);
        if (n + imported > max) warn("import-no-saving", rel, `imports ${m[1]} (${lines(target)} lines), which loads in full: with it this file is ${n + imported} lines, more than ${max}. An import does not shorten the context`, i + 1);
      }
    });

    // Capitals and shouting are a sign the rule wants a check, not a louder voice.
    if (rel === "CLAUDE.md" || rel.endsWith("AGENTS.md") || rel.endsWith("CONSTRAINTS.md")) {
      const words = (text.match(EMPHASIS_WORDS) ?? []).length;
      const shouted = text.replace(/\r\n?/g, "\n").split("\n").flatMap((l, i) => (/[A-Z]{3}/.test(l) && l.replace(/[^A-Za-z]/g, "").length >= 12 && l === l.toUpperCase() && !/^\s*(#|[|`-]|\*\*)/.test(l) ? [i + 1] : []));
      if (words > 5 || shouted.length > 0) warn("emphasis", rel, `${words} words in capitals (IMPORTANT, NEVER, ALWAYS...)${shouted.length ? ` and ${shouted.length} line(s) fully in capitals` : ""}: shouting does not make a rule followed; a rule that matters wants a check (a test, a hook), not a louder voice`, shouted[0]);
    }
  }

  for (const rel of skillFiles(realRoot)) {
    const text = readIf(realRoot, rel);
    if (text === undefined) continue;
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n?/g, "\n"));
    if (!m) continue;
    const body = lines(m[2]!);
    if (body > MAX_SKILL_LINES) warn("skill-size", rel, `${body} lines of body, more than ${MAX_SKILL_LINES}: split the detail into files the skill loads when it needs them`);
    const doc = parseDocument(m[1]!);
    const front = doc.errors.length === 0 ? (doc.toJS() as Record<string, unknown> | null) : null;
    const description = front && typeof front.description === "string" ? front.description : "";
    if (description.length > MAX_SKILL_DESCRIPTION) warn("skill-size", rel, `a description of ${description.length} characters, more than ${MAX_SKILL_DESCRIPTION}: it is loaded in every session`);
    if (front && "model" in front) warn("skill-model", rel, "has a `model:` key: it switches the model when the skill runs, and every switch starts without the cache (handbook: session-hygiene)");
  }

  const settingsText = readIf(realRoot, ".claude/settings.json");
  if (settingsText !== undefined) {
    try {
      const s = JSON.parse(settingsText) as { hooks?: Record<string, { hooks?: unknown[] }[]> };
      const count = Object.values(s.hooks ?? {}).reduce((n, groups) => n + (Array.isArray(groups) ? groups.reduce((k, g) => k + (Array.isArray(g?.hooks) ? g.hooks.length : 0), 0) : 0), 0);
      if (count > settings.maxHooks) warn("hook-count", ".claude/settings.json", `${count} hooks, more than ${settings.maxHooks}: too many hooks become rigid preferences nobody remembers`);
    } catch { /* an unreadable settings file is not this check's business */ }
  }
  for (const [rel, key] of [[".mcp.json", "mcpServers"], [".vscode/mcp.json", "servers"]] as const) {
    const t = readIf(realRoot, rel);
    if (t === undefined) continue;
    try {
      const names = Object.keys(((JSON.parse(t) as Record<string, unknown>)[key] as object | undefined) ?? {});
      if (names.length > settings.maxMcpServers) warn("mcp-count", rel, `${names.length} MCP servers (${names.join(", ")}), more than ${settings.maxMcpServers} (a LiftOff default, not a vendor figure): each adds tool definitions to the context; prefer a CLI the agent already knows (handbook: lean-output)`);
    } catch { /* ditto */ }
  }
  return findings;
}
