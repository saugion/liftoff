// What a team's copy of a shipped page is, compared with what LiftOff ships now. Pure.
import { type CatalogPage, latest, revisionOf } from "./catalog.js";
import { fingerprint, parseHandbookPage } from "./page.js";

export type PageStatus =
  | "current" // the team's copy is what LiftOff ships now
  | "update-available" // untouched by the team, and LiftOff has a newer text: it can replace it
  | "modified" // the team changed it; LiftOff did not
  | "both-changed" // the team changed it and LiftOff did too
  | "new-practice" // never adopted, not retired
  | "retired" // the team retired it: it stays retired
  | "team" // `origin: team`: the team's own, no updates
  | "invalid"; // the file does not parse

export interface StatusRow {
  id: string;
  status: PageStatus;
  stub: boolean; // a stub the team has not filled in yet
  origin?: string;
  base?: string;
  latestBase?: string;
  baseKnown?: boolean; // `both-changed` only: whether the text the team started from is still kept (else a two-way diff)
  errors?: string[];
}

// `teamText` is the file as it is in the repo (undefined when absent).
export function statusOf(page: CatalogPage, teamText: string | undefined, retired: boolean): StatusRow {
  const newest = latest(page);
  const row = (status: PageStatus, extra: Partial<StatusRow> = {}): StatusRow => ({ id: page.id, status, stub: false, latestBase: newest.base, ...extra });
  if (teamText === undefined) return retired ? row("retired") : row("new-practice");
  const parsed = parseHandbookPage(teamText);
  if (!parsed.ok) return row("invalid", { errors: parsed.errors });
  const { front, body } = parsed;
  const stub = front.status === "stub";
  if (front.origin === "team") return row("team", { origin: "team", stub });
  const mine = fingerprint(front, body);
  const common = { origin: front.origin, ...(front.base && { base: front.base }), stub };
  if (mine === front.base) return front.base === newest.base ? row("current", common) : row("update-available", common);
  // The team changed the text. Did LiftOff change its own since the team copied it?
  if (front.base === newest.base) return row("modified", common);
  return row("both-changed", { ...common, baseKnown: front.base !== undefined && revisionOf(page, front.base) !== undefined });
}

// The pages that are behind what LiftOff ships (nothing is imposed: the lead decides what to take).
export const drift = (rows: StatusRow[]): { newPractices: string[]; updates: string[]; conflicts: string[] } => ({
  newPractices: rows.filter((r) => r.status === "new-practice").map((r) => r.id),
  updates: rows.filter((r) => r.status === "update-available").map((r) => r.id),
  conflicts: rows.filter((r) => r.status === "both-changed").map((r) => r.id),
});
