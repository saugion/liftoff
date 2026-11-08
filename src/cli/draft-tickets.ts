import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { connectors, projectsOf } from "../config/index.js";
import { checkTicket, type ModuleContext } from "../plan/draft.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import type { Handler, Outcome } from "./types.js";

const fail = (code: "no-tracker" | "ticket-draft-invalid" | "tracker-read-only" | "usage", message: string, exitCode: 1 | 2 = 1): Outcome => ({ exitCode, body: { ok: false, errors: [{ code, message }] } });
const MAX_BYTES = 2_000_000;
const MAX_TICKETS = 200;

// Read-only. Checks a batch of drafts against the team config and returns the exact creation calls. Calls nothing.
export const draftTicketsCommand: Handler = ({ root, file }) => {
  if (!file) return fail("usage", "draft-tickets needs --file <drafts.json>", 2);
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  const { tracker } = connectors(read.config);
  if (!tracker) return fail("no-tracker", "liftoff.yaml has no tracker: run the Connect skill first");
  if (tracker.server.readOnly) return fail("tracker-read-only", "tracker.server.readOnly is true: the Jira server exposes no write tool");

  let raw: unknown;
  try {
    const path = resolve(root, file);
    if (statSync(path).size > MAX_BYTES) return fail("ticket-draft-invalid", `${file} is larger than ${MAX_BYTES} bytes`);
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return fail("ticket-draft-invalid", `cannot read ${file} as JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const doc = raw as { project?: unknown; tickets?: unknown };
  if (raw === null || typeof raw !== "object" || !Array.isArray(doc.tickets) || doc.tickets.length === 0) return fail("ticket-draft-invalid", "the file must be {\"project\": \"KEY\", \"tickets\": [ ... ]} with at least one ticket");
  if (doc.tickets.length > MAX_TICKETS) return fail("ticket-draft-invalid", `at most ${MAX_TICKETS} tickets per batch`);
  const wanted = doc.project === undefined ? tracker.project : doc.project;
  const info = projectsOf(read.config).find((p) => p.project === wanted);
  if (!info) return fail("ticket-draft-invalid", `project ${String(wanted)} is neither the tracker's nor a stream's (${projectsOf(read.config).map((p) => p.project).join(", ")})`);

  const streamOf = new Map<string, string>();
  for (const p of projectsOf(read.config)) if (p.stream?.module) streamOf.set(p.stream.module, p.stream.id);
  const mods: ModuleContext = { modules: new Set((read.config.modules?.items ?? []).map((m) => m.id)), streamOf };
  const tickets = doc.tickets.map((t, i) => checkTicket(t, i, tracker, info, mods));
  return {
    exitCode: 0,
    body: {
      ok: true,
      project: info.project,
      stream: info.stream ? { id: info.stream.id, mode: info.stream.mode, module: info.stream.module ?? null, epics: info.stream.epics } : null,
      inheritedTypes: info.inherited,
      count: tickets.length,
      allOk: tickets.every((t) => t.ok),
      tickets,
    },
  };
};
