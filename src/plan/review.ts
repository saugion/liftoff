// The PO's part of a ticket: what only the person can decide (why, out of scope), and the review of everything the
// agent added on its own (the assumptions). Pure: JSON in, JSON out. Nothing here judges whether an answer is good,
// only that it is there, that it came from the person, and that the ticket carries it.
import { secretGuard } from "../config/secrets.js";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);

export interface Issue { code: string; message: string }

export const TBD = "_TBD_";
export type PoField = "why" | "outOfScope";
export const PO_FIELDS: readonly PoField[] = ["why", "outOfScope"];
const LABEL: Record<PoField, string> = { why: "why", outOfScope: "out of scope" };

// Whitespace-insensitive: the agent may re-wrap a sentence, never change the words.
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// Which questions a ticket type asks. Epic and Story: both. Bug: neither (steps, expected and actual are facts the
// Ticket skill already asks for). Anything else (Task, Sub-task, a type the team named in its own language): the why.
export function asked(typeName: string | undefined): Record<PoField, boolean> {
  const n = (typeName ?? "").trim().toLowerCase();
  if (n === "epic" || n === "story" || n === "user story") return { why: true, outOfScope: true };
  if (n === "bug") return { why: false, outOfScope: false };
  return { why: true, outOfScope: false };
}

export type PoStatus = "answered" | "missing" | "not-asked";

export interface PoCheck {
  errors: Issue[];
  warnings: Issue[];
  status: Record<PoField, PoStatus>;
  texts: string[]; // the person's answers, for the credential check
}

// `po` is what the person said, copied as given: { why, outOfScope }. A question the type asks and the person did not
// answer (absent, blank or `_TBD_`) is a warning, never a guess: the ticket can still be created and Plan stops on it.
export function checkPo(po: unknown, typeName: string | undefined, description: string | undefined): PoCheck {
  const errors: Issue[] = [], warnings: Issue[] = [];
  const status: Record<PoField, PoStatus> = { why: "not-asked", outOfScope: "not-asked" };
  const texts: string[] = [];
  const want = asked(typeName);
  let given: Json = {};
  if (po !== undefined) {
    if (!isObj(po) || Object.keys(po).some((k) => !PO_FIELDS.includes(k as PoField) || typeof po[k] !== "string")) {
      errors.push({ code: "bad-po", message: "po must be an object with the person's own words as strings: { \"why\": \"...\", \"outOfScope\": \"...\" }" });
    } else given = po;
  }
  for (const f of PO_FIELDS) {
    const text = typeof given[f] === "string" ? (given[f] as string).trim() : "";
    const answered = text !== "" && text !== TBD;
    if (answered) {
      status[f] = "answered";
      texts.push(text);
      if (description !== undefined && !norm(description).includes(norm(text))) {
        warnings.push({ code: "po-text-not-in-description", message: `the person's words for '${LABEL[f]}' are not in the description: put them in, as said (only the format may change)` });
      }
    } else if (want[f]) {
      status[f] = "missing";
      warnings.push({ code: "po-decision-missing", message: `no answer from the person for '${LABEL[f]}': leave the section as ${TBD}, never fill it with a guess; Plan will stop on it` });
    }
  }
  return { errors, warnings, status, texts };
}

export type Answer = "confirmed" | "changed" | "dropped";
const ANSWERS: readonly string[] = ["confirmed", "changed", "dropped"];

export interface ReviewReport {
  provided: boolean;
  ok: boolean;
  errors: (Issue & { ticket?: number })[];
  warnings: (Issue & { ticket?: number })[];
  assumptions: { total: number; confirmed: number; changed: number; dropped: number; unanswered: number };
}

const REF = /^#(\d+)$/;

// The review file: one entry per ticket of the batch, in the person's words about each thing the agent added:
//   { "tickets": [ { "ref": "#0", "assumptions": [ { "id": 1, "text": "...", "section": "Acceptance criteria",
//                    "answer": "confirmed" | "changed" | "dropped", "final": "the text the person wants" } ] } ] }
// The batch is not ready until every ticket has an entry and every assumption an answer. `final` is the text the person
// settled on when the answer is `changed`.
export function checkReview(raw: unknown, descriptions: (string | undefined)[]): ReviewReport {
  const empty = { total: 0, confirmed: 0, changed: 0, dropped: 0, unanswered: 0 };
  if (raw === undefined) {
    return { provided: false, ok: false, errors: [{ code: "review-missing", message: "no review file: list what you added on your own as assumptions, take the person's answer to each one, and pass the file with --review" }], warnings: [], assumptions: empty };
  }
  const errors: ReviewReport["errors"] = [], warnings: ReviewReport["warnings"] = [];
  const counts = { ...empty };
  const entries = isObj(raw) && Array.isArray(raw.tickets) ? raw.tickets : undefined;
  if (!entries) {
    return { provided: true, ok: false, errors: [{ code: "review-invalid", message: "the review file must be { \"tickets\": [ { \"ref\": \"#0\", \"assumptions\": [ ... ] } ] }" }], warnings, assumptions: counts };
  }
  const seen = new Set<number>();
  entries.forEach((e, i) => {
    const at = (code: string, message: string, ticket?: number) => errors.push({ code, message, ...(ticket !== undefined && { ticket }) });
    const m = isObj(e) && typeof e.ref === "string" ? REF.exec(e.ref) : null;
    if (!isObj(e) || !m) return at("review-ref", `entry ${i} needs a ref like "#0" (the ticket's index in the batch)`);
    const n = Number(m[1]);
    if (n >= descriptions.length) return at("review-ref", `entry ${i}: ${e.ref} is not a ticket of this batch (${descriptions.length} tickets)`);
    if (seen.has(n)) return at("review-ref", `${e.ref} has more than one entry`, n);
    seen.add(n);
    if (!Array.isArray(e.assumptions)) return at("review-invalid", `${e.ref}: assumptions must be a list (empty when you added nothing on your own)`, n);
    const ids = new Set<unknown>();
    const description = descriptions[n];
    for (const a of e.assumptions) {
      counts.total++;
      if (!isObj(a) || typeof a.text !== "string" || a.text.trim() === "" || !Number.isInteger(a.id)) {
        counts.unanswered++;
        at("assumption-invalid", `${e.ref}: every assumption needs an integer id and a text`, n);
        continue;
      }
      const label = `${e.ref} assumption ${String(a.id)}`;
      if (ids.has(a.id)) at("assumption-invalid", `${label}: the id is used twice`, n);
      ids.add(a.id);
      if (typeof a.answer !== "string" || a.answer === "") {
        counts.unanswered++;
        at("assumption-unanswered", `${label} has no answer from the person: ask, never assume they agree`, n);
        continue;
      }
      if (!ANSWERS.includes(a.answer)) {
        counts.unanswered++;
        at("assumption-invalid", `${label}: answer must be confirmed, changed or dropped`, n);
        continue;
      }
      const answer = a.answer as Answer;
      counts[answer]++;
      const final = typeof a.final === "string" ? a.final.trim() : "";
      if (answer === "changed" && final === "") at("assumption-invalid", `${label} is changed: give the text the person wants in final`, n);
      if (description === undefined) continue;
      const present = (s: string) => norm(description).includes(norm(s));
      if (answer === "confirmed" && !present(a.text)) warnings.push({ code: "assumption-not-in-description", message: `${label} is confirmed but its text is not in the description`, ticket: n });
      if (answer === "changed" && final !== "" && !present(final)) warnings.push({ code: "assumption-not-in-description", message: `${label} is changed but the new text is not in the description`, ticket: n });
      if (answer === "dropped" && present(a.text)) warnings.push({ code: "assumption-still-in-description", message: `${label} was dropped but its text is still in the description`, ticket: n });
    }
    if (secretGuard({ assumptions: e.assumptions }).length > 0) at("credential-like", `${e.ref}: an assumption looks like a credential`, n);
  });
  descriptions.forEach((_d, n) => {
    if (!seen.has(n)) errors.push({ code: "review-ticket-missing", message: `ticket #${n} has no entry in the review file (an entry with an empty assumptions list is fine)`, ticket: n });
  });
  return { provided: true, ok: errors.length === 0, errors, warnings, assumptions: counts };
}
