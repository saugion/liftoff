// The result of the clean-context review (clean-review): what a reviewer that never saw the session found in the diff, the
// ticket and the quality bar. Pure: JSON in, a report out. The CLI never judges the findings; it checks their shape, that the
// ticket's criteria are all answered, and that nothing in them is a credential or points outside the repo.
import { secretGuard } from "../config/secrets.js";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);

export const MET = ["yes", "no", "unclear"] as const;
export const KINDS = ["criterion", "scope", "constraint", "untested", "invented", "secret"] as const;
export const SEVERITIES = ["must", "should"] as const;

export interface ReviewIssue { code: string; message: string }
export interface CleanReviewReport {
  ok: boolean;
  errors: ReviewIssue[];
  criteria: { total: number; yes: number; no: number; unclear: number; unanswered: string[] };
  findings: { total: number; must: number; should: number; byKind: Record<string, number> };
  unmet: string[]; // criterion ids that are not `yes`: the engineer decides what to do with them
}

const safePath = (p: unknown): boolean => typeof p === "string" && p !== "" && !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && !p.split(/[\\/]/).includes("..") && !/[\r\n\0]/.test(p);

export function checkCleanReview(raw: unknown, ticketCriteria: string[] | undefined): CleanReviewReport {
  const errors: ReviewIssue[] = [];
  const bad = (code: string, message: string) => errors.push({ code, message });
  const out: CleanReviewReport = { ok: false, errors, criteria: { total: 0, yes: 0, no: 0, unclear: 0, unanswered: [] }, findings: { total: 0, must: 0, should: 0, byKind: {} }, unmet: [] };
  if (!isObj(raw) || !Array.isArray(raw.criteria) || !Array.isArray(raw.findings)) {
    bad("clean-review-invalid", 'the review must be { "criteria": [ { "id", "met", "evidence" } ], "findings": [ { "id", "kind", "severity", "file", "line", "text" } ] }');
    return out;
  }
  const seen = new Set<string>();
  for (const c of raw.criteria) {
    if (!isObj(c) || typeof c.id !== "string" || !/^AC\d+$/.test(c.id)) { bad("clean-review-invalid", 'every criterion needs an id like "AC1"'); continue; }
    if (seen.has(c.id)) { bad("clean-review-invalid", `${c.id} is answered twice`); continue; }
    seen.add(c.id);
    out.criteria.total++;
    if (typeof c.met !== "string" || !(MET as readonly string[]).includes(c.met)) { bad("clean-review-invalid", `${c.id}: met must be one of ${MET.join(", ")}`); continue; }
    out.criteria[c.met as "yes" | "no" | "unclear"]++;
    if (c.met === "yes" && (typeof c.evidence !== "string" || c.evidence.trim() === "")) bad("clean-review-invalid", `${c.id} is met: the reviewer must say where in the diff (evidence)`);
    if (c.met !== "yes") out.unmet.push(c.id);
  }
  if (ticketCriteria) out.criteria.unanswered = ticketCriteria.filter((id) => !seen.has(id));
  if (out.criteria.unanswered.length > 0) bad("clean-review-incomplete", `the review does not answer ${out.criteria.unanswered.join(", ")}: every criterion of the ticket needs a verdict`);

  const ids = new Set<string>();
  for (const f of raw.findings) {
    if (!isObj(f) || typeof f.id !== "string" || f.id.trim() === "") { bad("clean-review-invalid", "every finding needs an id"); continue; }
    if (ids.has(f.id)) { bad("clean-review-invalid", `finding ${f.id} appears twice`); continue; }
    ids.add(f.id);
    out.findings.total++;
    if (typeof f.kind !== "string" || !(KINDS as readonly string[]).includes(f.kind)) bad("clean-review-invalid", `finding ${f.id}: kind must be one of ${KINDS.join(", ")}`);
    else out.findings.byKind[f.kind] = (out.findings.byKind[f.kind] ?? 0) + 1;
    if (typeof f.severity !== "string" || !(SEVERITIES as readonly string[]).includes(f.severity)) bad("clean-review-invalid", `finding ${f.id}: severity must be one of ${SEVERITIES.join(", ")}`);
    else out.findings[f.severity as "must" | "should"]++;
    if (typeof f.text !== "string" || f.text.trim() === "") bad("clean-review-invalid", `finding ${f.id} needs a text`);
    if (f.file !== undefined && !safePath(f.file)) bad("clean-review-invalid", `finding ${f.id}: file must be a path inside the repository`);
    if (f.line !== undefined && !(Number.isInteger(f.line) && (f.line as number) > 0)) bad("clean-review-invalid", `finding ${f.id}: line must be a positive integer`);
  }
  if (secretGuard({ raw }).length > 0) bad("clean-review-secret", "the review text looks like a credential: do not keep it, and tell the engineer");
  out.ok = errors.length === 0;
  return out;
}
