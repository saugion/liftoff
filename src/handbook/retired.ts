// `retired.txt`: the pages the team retired, one line each: `<id> <YYYY-MM-DD> <reason>`. A committed file that merges by
// union (a .gitattributes line the Brain skill proposes). `handbook-init` and `handbook-update` skip every id in it.
import { PAGE_ID } from "./paths.js";

const LINE = /^([a-z0-9][a-z0-9-]*) (\d{4}-\d{2}-\d{2})(?: (.+))?$/;
export interface Retired { id: string; date: string; reason: string }

export function parseRetired(text: string): { retired: Retired[]; bad: { line: number; text: string }[] } {
  const retired: Retired[] = [];
  const bad: { line: number; text: string }[] = [];
  text.replace(/\r\n?/g, "\n").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const m = LINE.exec(line);
    if (m) retired.push({ id: m[1]!, date: m[2]!, reason: m[3] ?? "" });
    else bad.push({ line: i + 1, text: raw });
  });
  return { retired, bad };
}

export const retiredLine = (id: string, date: string, reason: string): string => {
  if (!PAGE_ID.test(id)) throw new Error(`'${id}' is not a page id`);
  return `${id} ${date} ${reason.replace(/\s+/g, " ").trim()}`.trimEnd();
};
