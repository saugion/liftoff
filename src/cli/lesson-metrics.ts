import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readEvents, summarize } from "../brain/metrics.js";
import { NO_BRAIN, brainFail } from "./brain-init.js";
import { resolveReal } from "./fsutil.js";
import { NO_LESSONS, lessonFail } from "./lesson-add.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import type { Handler } from "./types.js";

// Read-only. An aggregate by month and bucket (`empty`: no wiki page and no team rule yet, `brain`: otherwise) with no
// ticket key, rule, path or name in it, so the engineer can paste it into the pilot results.
export const lessonMetrics: Handler = ({ root }) => {
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  if (!read.config.brain) return brainFail("no-brain", NO_BRAIN);
  const settings = read.config.brain.lessons;
  if (!settings) return lessonFail("no-lessons", NO_LESSONS);
  if (!settings.metrics) return { exitCode: 0, body: { ok: true, enabled: false, months: [], note: "metrics are off (brain.lessons.metrics: false): nothing is recorded" } };
  const realRoot = resolveReal(root);
  const notesOf = (key: string): number => {
    const file = join(realRoot, ".liftoff", "plans", `${key}.md`);
    return existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^\s*Note:/.test(l)).length : 0;
  };
  return { exitCode: 0, body: { ok: true, enabled: true, months: summarize(readEvents(realRoot), notesOf), note: "local only: copy it by hand into the pilot results; it holds no ticket key, rule, path or name" } };
};
