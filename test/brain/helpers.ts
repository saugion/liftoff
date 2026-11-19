import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "../../src/cli/main.js";
import { CONFIG, repo } from "../plan/helpers.js";

export const CFG = CONFIG.replace('version: "0.2"', 'version: "0.4"') + "modules:\n  items:\n    - { id: api, path: src/api }\nbrain: { hotMaxLines: 8 }\n";
export const call = (dir: string, cmd: string, ...args: string[]) => {
  const r = run([cmd, "--root", dir, ...args], "/");
  return { exitCode: r.exitCode, body: JSON.parse(r.stdout) as Record<string, any> };
};
export const check = (dir: string) => call(dir, "brain-check");
export const put = (dir: string, rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
export const page = (title: string, sources: string[], body = "", extra = "") =>
  `---\ntitle: ${title}\ntype: learning\nupdated: 2026-11-19\nsummary: About ${title}.\nsources: [${sources.join(", ")}]\n${extra}---\n# ${title}\n${body}`;

// A quote of the healthy source, as a page under wiki/learnings/ writes it.
export const quote = (raw: string, text = "The reset link expires after 30 minutes.") => `> ${text}\n> -- [notes](../../${raw})\n`;

// A healthy brain: one doc source, two pages that link to each other, a log line, a fresh index.
export function healthy(): { dir: string; raw: string } {
  const dir = repo(CFG, { "notes.md": "The reset link expires after 30 minutes.\n" });
  call(dir, "brain-init", "--write");
  const raw = call(dir, "brain-source", "--kind", "doc", "--file", "notes.md", "--write").body.path.replace(/^brain\//, "");
  put(dir, "brain/wiki/learnings/reset.md", page("Reset", [raw], `See [other](other.md).\n\n${quote(raw)}`));
  put(dir, "brain/wiki/learnings/other.md", page("Other", [raw], `Back to [reset](reset.md).\n\n${quote(raw)}`, "module: api\n"));
  put(dir, "brain/log/2026-11.md", `- 2026-11-19 ingest ${raw}: wiki/learnings/reset.md, wiki/learnings/other.md\n`);
  put(dir, "brain/hot.md", "# Hot\n\n- Now: [reset](wiki/learnings/reset.md)\n");
  call(dir, "brain-index", "--write");
  return { dir, raw };
}
