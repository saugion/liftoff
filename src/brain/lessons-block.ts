// The team's lessons block: one marked list of rules inside AGENTS.md (root or module) and the constraints file.
// Pure: text in, text or data out. Nothing outside the markers is ever changed.

export const BEGIN_PREFIX = "<!-- liftoff lessons: begin";
export const BEGIN = `${BEGIN_PREFIX} (rules promoted from repeated corrections, reviewed in a merge request; edit through the Brain skill or by hand in a reviewed change) -->`;
export const END = "<!-- liftoff lessons: end -->";
export const HEADING = "## Team lessons";
export const CONSTRAINTS_HEADING = "## Team lessons (quality bar additions)";
export type BlockKind = "agents" | "constraints";

export interface BlockRule { key: string; rule: string; since: string }
export interface Block {
  found: boolean;
  begin: number; // line index of the begin marker (-1 when absent)
  end: number; // line index of the end marker
  rules: BlockRule[];
  errors: { line: number; message: string }[]; // 1-based lines
}

const BULLET = /^- (.+?) <!-- lesson: ([a-z0-9][a-z0-9-]{1,39}); since: (\d{4}-\d{2}-\d{2}) -->$/;

export function parseBlock(text: string): Block {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const begins = lines.flatMap((l, i) => (l.startsWith(BEGIN_PREFIX) ? [i] : []));
  const ends = lines.flatMap((l, i) => (l.trim() === END ? [i] : []));
  const errors: Block["errors"] = [];
  if (begins.length === 0 && ends.length === 0) return { found: false, begin: -1, end: -1, rules: [], errors };
  if (begins.length > 1) errors.push({ line: begins[1]! + 1, message: "more than one lessons block in this file" });
  if (ends.length > 1) errors.push({ line: ends[1]! + 1, message: "more than one lessons end marker" });
  if (begins.length === 0 || ends.length === 0 || ends[0]! < begins[0]!) {
    errors.push({ line: (begins[0] ?? ends[0] ?? 0) + 1, message: "the begin and end markers of the lessons block do not pair up" });
    return { found: true, begin: begins[0] ?? -1, end: ends[0] ?? -1, rules: [], errors };
  }
  const [begin, end] = [begins[0]!, ends[0]!];
  const rules: BlockRule[] = [];
  for (let i = begin + 1; i < end; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    const m = BULLET.exec(line);
    if (!m) errors.push({ line: i + 1, message: "a line in the lessons block that is not '- <rule> <!-- lesson: <key>; since: <YYYY-MM-DD> -->'" });
    else if (m[1]!.length > 160) errors.push({ line: i + 1, message: "a rule longer than 160 characters" });
    else rules.push({ key: m[2]!, rule: m[1]!, since: m[3]! });
  }
  const seen = new Set<string>();
  for (const r of rules) {
    if (seen.has(r.key)) errors.push({ line: begin + 1, message: `the key ${r.key} appears twice in the block` });
    seen.add(r.key);
  }
  return { found: true, begin, end, rules, errors };
}

export const renderRules = (rules: BlockRule[]): string[] => rules.map((r) => `- ${r.rule} <!-- lesson: ${r.key}; since: ${r.since} -->`);
export const renderBlock = (rules: BlockRule[], kind: BlockKind): string =>
  [kind === "constraints" ? CONSTRAINTS_HEADING : HEADING, "", BEGIN, ...renderRules(rules), END].join("\n");

// Index just after the last line of the section that starts at heading `title` (before the next `## ` heading),
// trailing blank lines excluded. -1 when there is no such section.
function endOfSection(lines: string[], title: RegExp): number {
  const start = lines.findIndex((l) => /^##\s/.test(l) && title.test(l));
  if (start < 0) return -1;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i]!)) { end = i; break; }
  while (end > start + 1 && lines[end - 1]!.trim() === "") end--;
  return end;
}

// The file text with the block's rules set to `rules`; undefined when the file already has a block that does not parse
// (a hand edit gone wrong is never silently repaired or doubled: the caller reports it). An existing block is rewritten
// between its markers only; a new block goes right after "Rules that always apply" (AGENTS.md) or "Banned shortcuts"
// (constraints), else at the end.
export function setBlock(text: string, rules: BlockRule[], kind: BlockKind): string | undefined {
  const crlf = text.includes("\r\n");
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const info = parseBlock(text);
  if (info.found && info.errors.length > 0) return undefined;
  let out: string[];
  if (info.found) {
    out = [...lines.slice(0, info.begin + 1), ...renderRules(rules), ...lines.slice(info.end)];
  } else {
    const block = renderBlock(rules, kind).split("\n");
    const at = endOfSection(lines, kind === "constraints" ? /banned shortcuts/i : /rules that always apply/i);
    if (at >= 0) out = [...lines.slice(0, at), "", ...block, ...(lines[at] !== undefined && lines[at]!.trim() !== "" ? [""] : []), ...lines.slice(at)];
    else {
      const trimmed = [...lines];
      while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.trim() === "") trimmed.pop();
      out = [...trimmed, ...(trimmed.length > 0 ? [""] : []), ...block, ""];
    }
  }
  const result = out.join("\n");
  return crlf ? result.replace(/\n/g, "\r\n") : result;
}

// Days between two YYYY-MM-DD dates (b - a).
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
