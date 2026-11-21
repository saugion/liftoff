import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { jiraTypeOf, projectsOf, practiceMode, typeOfTicket } from "../config/index.js";
import { KEY_RE, planFile } from "../plan/build.js";
import { splitCriteria } from "../plan/criteria.js";
import { readTicket, readWithMap } from "../plan/ticket.js";
import { checkVerify } from "../plan/verify.js";
import { type MetricEvent, appendEvent, brainSize, compareSections, draftFile, metricsOn, readEvents, sectionHashes } from "../brain/metrics.js";
import { approvedText, readPlan } from "../plan/file.js";
import { atomicWrite, isInside, resolveReal } from "./fsutil.js";
import { today } from "./lesson-add.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import { ensureSelfIgnore } from "./state.js";
import type { Handler, Outcome } from "./types.js";

const fail = (code: "plan-missing" | "plan-invalid" | "criterion-unverified" | "usage", message: string, extra: object = {}, exitCode: 1 | 2 = 1): Outcome => ({
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

  // Pilot metrics (only with brain.lessons.metrics): what the engineer changed in the plan between the draft and the
  // approval. Local files only; a failure here never changes the answer.
  const realRoot = resolveReal(root);
  const metrics = metricsOn(read.config);
  const snapshotFile = join(realRoot, draftFile(key));
  const now = sectionHashes(plan.body);
  const readSnapshot = () => {
    try {
      return JSON.parse(readFileSync(snapshotFile, "utf8")) as ReturnType<typeof sectionHashes>;
    } catch {
      return undefined;
    }
  };
  if (metrics && plan.status === "draft" && !approve && !existsSync(snapshotFile)) {
    ensureSelfIgnore(realRoot);
    atomicWrite(snapshotFile, JSON.stringify(now));
  }

  // verify-first (off by default): every criterion of the ticket has a check in the plan. The ticket is read from the file the Plan
  // skill saved (.liftoff/tmp/<KEY>.json); without it the criteria are unknown and only a warning is possible.
  const mode = practiceMode(read.config, "verify-first");
  const warnings: { code: string; message: string }[] = [];
  let verify: ReturnType<typeof checkVerify> | undefined;
  if (mode !== "off") {
    let criteria: ReturnType<typeof splitCriteria> | undefined;
    let bug = false;
    const ticketFile = join(realRoot, ".liftoff", "tmp", `${key}.json`);
    if (existsSync(ticketFile)) {
      const t = readTicket(readFileSync(ticketFile, "utf8"));
      if (!("error" in t)) {
        const km = KEY_RE.exec(t.key);
        const info = km ? projectsOf(read.config).find((p) => p.project === km[1]) : undefined;
        const type = info ? typeOfTicket(info.issueTypes, t) : undefined;
        criteria = splitCriteria(readWithMap(t, type).acceptanceCriteria.text);
        bug = (type ? jiraTypeOf(type) : t.issueType).toLowerCase() === "bug";
      }
    }
    verify = checkVerify(plan.body, criteria, bug);
    if (!verify.known) warnings.push({ code: "criteria-unknown", message: `.liftoff/tmp/${key}.json is missing or unreadable: the ticket's criteria cannot be matched to checks (run the Plan skill's read step again)` });
    for (const r of verify.unknownRefs) warnings.push({ code: "verify-unknown-criterion", message: `the plan has a check for ${r}, which the ticket does not have` });
    if (verify.uncovered.length > 0) {
      const message = `no check in the plan for: ${verify.uncovered.join(", ")}. Add "- [ ] verify <AC id>: <command>" to the section that implements it`;
      if (mode === "on" && approve) return fail("criterion-unverified", message, { uncovered: verify.uncovered });
      warnings.push({ code: "criterion-unverified", message });
    }
  }

  let status = plan.status;
  let approvedValid = plan.status === "approved" && plan.approvedHash === plan.hash;
  if (approve) {
    ensureSelfIgnore(resolveReal(root));
    if (metrics) {
      const before = readSnapshot() ?? now;
      const date = today();
      const earlier = readEvents(realRoot).filter((e) => e.e === "plan-approved" && e.key === key).length;
      const event: MetricEvent = {
        e: "plan-approved", t: date, key, ...compareSections(before, now), approval: earlier + 1,
        afterBuildStart: plan.sections.some((sec) => sec.done > 0), ...brainSize(realRoot, read.config),
      };
      appendEvent(realRoot, event);
      atomicWrite(snapshotFile, JSON.stringify(now));
    }
    atomicWrite(real, approvedText(plan));
    status = "approved";
    approvedValid = true;
  }
  const stale = status === "approved" && !approvedValid;
  const done = plan.sections.reduce((n, s) => n + s.done, 0);
  const total = plan.sections.reduce((n, s) => n + s.total, 0);
  return { exitCode: 0, body: { ok: true, key, path: rel, status, approvedValid, stale, sections: plan.sections, done, total, ...(verify && { verify: { mode, ...verify } }), ...(warnings.length > 0 && { warnings }) } };
};
