import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KEY_RE, planFile } from "../plan/build.js";
import { approvedText, readPlan } from "../plan/file.js";
import { atomicWrite, isInside, resolveReal } from "./fsutil.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import { ensureSelfIgnore } from "./state.js";
import type { Handler, Outcome } from "./types.js";

const fail = (code: "plan-missing" | "plan-invalid" | "usage", message: string, extra: object = {}, exitCode: 1 | 2 = 1): Outcome => ({
  exitCode,
  body: { ok: false, errors: [{ code, message, ...extra }] },
});

// Validates the local plan, reports approval and progress. `--approve` records approval and writes nothing else.
export const planCommand: Handler = ({ root, key, approve }) => {
  if (!key || !KEY_RE.test(key)) return fail("usage", "plan needs --key <ISSUE-KEY> (like PROJ-123)", {}, 2);
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };

  const rel = planFile(key);
  const file = join(root, rel);
  if (!existsSync(file)) return fail("plan-missing", `${rel} not found: run the Plan skill first`, { file: rel });
  const real = resolveReal(file);
  if (!isInside(resolveReal(root), real)) return fail("plan-invalid", `${rel} resolves outside the repository`, { file: rel });

  const plan = readPlan(readFileSync(real, "utf8"), key);
  if (!plan.ok) return { exitCode: 1, body: { ok: false, errors: plan.errors.map((message) => ({ code: "plan-invalid", message, file: rel })) } };

  let status = plan.status;
  let approvedValid = plan.status === "approved" && plan.approvedHash === plan.hash;
  if (approve) {
    ensureSelfIgnore(resolveReal(root));
    atomicWrite(real, approvedText(plan));
    status = "approved";
    approvedValid = true;
  }
  const stale = status === "approved" && !approvedValid;
  const done = plan.sections.reduce((n, s) => n + s.done, 0);
  const total = plan.sections.reduce((n, s) => n + s.total, 0);
  return { exitCode: 0, body: { ok: true, key, path: rel, status, approvedValid, stale, sections: plan.sections, done, total } };
};
