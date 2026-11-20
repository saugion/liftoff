import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { practiceMode, projectsOf } from "../config/index.js";
import { KEY_RE } from "../plan/build.js";
import { checkCleanReview } from "../plan/cleanreview.js";
import { splitCriteria } from "../plan/criteria.js";
import { readTicket, readWithMap } from "../plan/ticket.js";
import { resolveReal } from "./fsutil.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import type { Handler, Outcome } from "./types.js";

const fail = (code: "usage" | "clean-review-missing" | "clean-review-invalid", message: string, exitCode: 1 | 2 = 1): Outcome => ({ exitCode, body: { ok: false, errors: [{ code, message }] } });

// Read-only. Checks `.liftoff/tmp/clean-review-<KEY>.json`, the result of the clean-context review the Build skill asked for, against
// the criteria of the ticket (`.liftoff/tmp/<KEY>.json`). It judges no finding: it says what is unmet and what must be decided.
export const cleanReviewCommand: Handler = ({ root, key }) => {
  if (!key || !KEY_RE.test(key)) return fail("usage", "clean-review needs --key <ISSUE-KEY> (like PROJ-123)", 2);
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  const mode = practiceMode(read.config, "clean-review");
  const realRoot = resolveReal(root);
  const file = join(realRoot, ".liftoff", "tmp", `clean-review-${key}.json`);
  if (!existsSync(file)) return fail("clean-review-missing", `.liftoff/tmp/clean-review-${key}.json not found: the review was not run, or its result was not saved`);
  let raw: unknown;
  try {
    if (statSync(file).size > 1_000_000) return fail("clean-review-invalid", "the review file is larger than 1,000,000 bytes");
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return fail("clean-review-invalid", `cannot read the review as JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  // The ticket's criteria, when its saved JSON is there: every one needs a verdict.
  let ids: string[] | undefined;
  const ticketFile = join(realRoot, ".liftoff", "tmp", `${key}.json`);
  if (existsSync(ticketFile)) {
    const t = readTicket(readFileSync(ticketFile, "utf8"));
    if (!("error" in t)) {
      const km = KEY_RE.exec(t.key);
      const info = km ? projectsOf(read.config).find((p) => p.project === km[1]) : undefined;
      const type = info?.issueTypes.find((x) => x.name.toLowerCase() === t.issueType.toLowerCase());
      ids = splitCriteria(readWithMap(t, type).acceptanceCriteria.text).map((c) => c.id);
    }
  }
  const report = checkCleanReview(raw, ids);
  return { exitCode: report.ok ? 0 : 1, body: { ...report, mode, criteriaKnown: ids !== undefined, path: `.liftoff/tmp/clean-review-${key}.json` } };
};
