import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { connectors, projectsOf } from "../config/index.js";
import { KEY_RE, buildInfo } from "../plan/build.js";
import { readTicket, readWithMap } from "../plan/ticket.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import type { Handler, Outcome } from "./types.js";

const fail = (code: "no-tracker" | "ticket-invalid" | "usage", message: string, exitCode: 1 | 2 = 1): Outcome => ({ exitCode, body: { ok: false, errors: [{ code, message }] } });

const MAX_BYTES = 2_000_000;

// Read-only. The ticket JSON was fetched by the agent; this applies the team's reading map and conventions to it.
export const parseTicketCommand: Handler = ({ root, file }) => {
  if (!file) return fail("usage", "parse-ticket needs --file <ticket.json>", 2);
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  const { tracker, codeHost } = connectors(read.config);
  if (!tracker) return fail("no-tracker", "liftoff.yaml has no tracker: run the Connect skill first");

  const path = resolve(root, file);
  let text: string;
  try {
    if (statSync(path).size > MAX_BYTES) return fail("ticket-invalid", `${file} is larger than ${MAX_BYTES} bytes`);
    text = readFileSync(path, "utf8");
  } catch (e) {
    return fail("ticket-invalid", `cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const ticket = readTicket(text);
  if ("error" in ticket) return fail("ticket-invalid", ticket.error);
  const km = KEY_RE.exec(ticket.key);
  if (!km) return fail("ticket-invalid", `'${ticket.key}' is not an issue key like ${tracker.project}-123`);
  const project = projectsOf(read.config).find((p) => p.project === km[1]);
  if (!project) {
    const known = projectsOf(read.config).map((p) => p.project).join(", ");
    return fail("ticket-invalid", `${ticket.key} is not in a configured project (${known})`);
  }

  const type = project.issueTypes.find((t) => t.name.toLowerCase() === ticket.issueType.toLowerCase());
  const reading = readWithMap(ticket, type);
  const warnings: { code: string; message: string }[] = [];
  if (!type) warnings.push({ code: "unknown-issue-type", message: `issue type '${ticket.issueType}' is not in liftoff.yaml: read with defaults; the lead can add it with the Connect skill` });
  if (reading.acceptanceCriteria.source === "none") warnings.push({ code: "no-acceptance-criteria", message: "no acceptance criteria found with the reading map: ask the engineer, do not invent them" });
  if (!ticket.description) warnings.push({ code: "empty-description", message: "the ticket has no description" });
  if (project.stream && project.inherited) warnings.push({ code: "types-inherited", message: `stream ${project.stream.id} has no issue types of its own: read with the tracker's; its workflow may differ, ask the lead to learn them with the Connect skill` });
  const tpl = codeHost?.conventions.mrTemplate;
  if (tpl && !existsSync(resolve(root, tpl))) warnings.push({ code: "mr-template-missing", message: `the configured merge request template ${tpl} does not exist in the repo: write a short summary and tell the engineer` });
  for (const id of reading.missing) warnings.push({ code: "field-missing", message: `field ${id} has no value on this ticket` });

  return {
    exitCode: 0,
    body: {
      ok: true,
      ticket: { key: ticket.key, url: `${tracker.url}/browse/${ticket.key}`, summary: ticket.summary, issueType: ticket.issueType, ...(ticket.status && { status: ticket.status }), description: ticket.description },
      known: type !== undefined,
      stream: project.stream ? { id: project.stream.id, mode: project.stream.mode, module: project.stream.module ?? null, epics: project.stream.epics } : null,
      reading: { acceptanceCriteria: reading.acceptanceCriteria, fields: reading.fields },
      warnings,
      build: { git: read.config.build?.git ?? "assisted", ...buildInfo(ticket, tracker, type, codeHost) },
    },
  };
};
