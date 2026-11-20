// verify-first: which acceptance criterion of the ticket has a check in the plan. A check is a plan item written as
//   - [ ] verify AC2: <command> (red first)        or, for a bug,        - [ ] verify repro: <command>
// inside the section that implements that criterion. Deterministic; whether the command proves the criterion is the engineer's
// judgment (and the reviewer's), never the CLI's.
import type { Criterion } from "./criteria.js";

export interface VerifyReport {
  known: boolean; // the ticket's criteria were readable (else only the references in the plan are listed)
  bug: boolean;
  criteria: { id: string; text: string; covered: boolean; sections: number[] }[];
  uncovered: string[]; // criterion ids with no check, and `repro` for a bug with no reproduction
  repro: { required: boolean; present: boolean };
  unknownRefs: string[]; // a `verify ACn:` that names a criterion the ticket does not have
}

const CHECK = /^\s*[-*]\s+\[[ xX]\]\s+verify\s+(AC\d+|repro)\s*:\s*(\S.*)$/i;

export function checkVerify(body: string, criteria: Criterion[] | undefined, bug: boolean): VerifyReport {
  const found = new Map<string, Set<number>>(); // id -> sections
  let section = 0;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const h = /^##\s+(\d+)\./.exec(line);
    if (h) { section = Number(h[1]); continue; }
    const m = CHECK.exec(line);
    if (m && section > 0) {
      const id = m[1]!.toLowerCase() === "repro" ? "repro" : m[1]!.toUpperCase();
      (found.get(id) ?? found.set(id, new Set()).get(id)!).add(section);
    }
  }
  const list = (criteria ?? []).map((c) => ({ id: c.id, text: c.text, covered: found.has(c.id), sections: [...(found.get(c.id) ?? [])].sort((a, b) => a - b) }));
  const ids = new Set(list.map((c) => c.id));
  const repro = { required: bug, present: found.has("repro") };
  return {
    known: criteria !== undefined,
    bug,
    criteria: list,
    uncovered: [...list.filter((c) => !c.covered).map((c) => c.id), ...(repro.required && !repro.present ? ["repro"] : [])],
    repro,
    unknownRefs: criteria === undefined ? [] : [...found.keys()].filter((k) => k !== "repro" && !ids.has(k)).sort(),
  };
}
