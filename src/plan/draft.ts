// Checks a batch of ticket drafts against the team config and turns each into the exact tool call that creates it.
// Pure: JSON in, JSON out. The agent makes the calls, after the engineer approved the batch.
import type { IssueType, ProjectInfo, TrackerConfig } from "../config/index.js";
import { secretGuard } from "../config/secrets.js";
import { headingTitles } from "./ticket.js";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);

export interface DraftIssue { code: string; message: string }
export interface DraftResult {
  index: number;
  ok: boolean;
  errors: DraftIssue[];
  warnings: DraftIssue[];
  preview: string;
  call: { tool: "jira_create_issue"; args: Json } | null;
  after: { tool: "jira_update_issue"; args: Json }[];
}

const KEY = /^([A-Z][A-Z0-9_]+)-[0-9]+$/;
export const CREATED_KEY_PLACEHOLDER = "<created key>";

// What the module check needs from the config: the module ids, and which module each stream feeds.
export interface ModuleContext { modules: Set<string>; streamOf: Map<string, string> }

export function checkTicket(raw: unknown, index: number, tracker: TrackerConfig, info: ProjectInfo, mods: ModuleContext = { modules: new Set(), streamOf: new Map() }): DraftResult {
  const errors: DraftIssue[] = [], warnings: DraftIssue[] = [];
  const err = (code: string, message: string) => errors.push({ code, message });
  const t = isObj(raw) ? raw : {};
  if (!isObj(raw)) err("bad-ticket", "a ticket must be a JSON object");

  const str = (k: string) => (typeof t[k] === "string" ? (t[k] as string) : undefined);
  const type: IssueType | undefined = info.issueTypes.find((x) => x.name.toLowerCase() === (str("type") ?? "").toLowerCase());
  if (info.issueTypes.length === 0) err("no-issue-types", `project ${info.project} has no issue types in liftoff.yaml: run the Connect skill`);
  else if (!type) err("unknown-issue-type", `type '${str("type") ?? ""}' is not one of: ${info.issueTypes.map((x) => x.name).join(", ")}`);

  const summary = str("summary");
  if (summary === undefined || summary.trim() === "" || summary.length > 255 || /[\r\n]/.test(summary)) err("bad-summary", "summary must be one line of 1-255 characters");
  const description = str("description");
  if (description === undefined || description.trim() === "") err("bad-description", "description is required");
  else if (description.length > 32_000) err("bad-description", "description is longer than 32000 characters");

  const labels = t.labels === undefined ? [] : t.labels;
  if (!Array.isArray(labels) || labels.some((l) => typeof l !== "string" || !/^[^\s,\u0000-\u001f]{1,255}$/.test(l))) err("bad-label", "labels must be a list of strings without spaces or commas");
  const priority = t.priority;
  if (priority !== undefined && (typeof priority !== "string" || !/^[A-Za-z0-9 ._-]{1,30}$/.test(priority))) err("bad-priority", "priority must be a plain name like High");
  const fields = t.fields === undefined ? {} : t.fields;
  if (!isObj(fields) || Object.keys(fields).some((k) => !/^[A-Za-z0-9_]+$/.test(k))) err("bad-fields", "fields must be an object whose keys are Jira field ids");

  const modules = t.modules === undefined ? [] : t.modules;
  if (!Array.isArray(modules) || modules.some((m) => typeof m !== "string")) err("bad-modules", "modules must be a list of module ids");
  else for (const m of modules as string[]) {
    const stream = mods.streamOf.get(m);
    if (!mods.modules.has(m)) err("unknown-module", `module '${m}' is not in modules.items`);
    else if (info.stream && stream !== info.stream.id) err("module-wrong-project", `module '${m}' does not belong to stream ${info.stream.id}: create its ticket in its own project`);
    else if (!info.stream && stream) err("module-in-stream", `module '${m}' belongs to stream ${stream}: its ticket goes in that stream's project; split the work into one ticket per project`);
  }

  const epic = t.epic;
  if (epic !== undefined) {
    const m = typeof epic === "string" ? KEY.exec(epic) : null;
    if (!m || m[1] !== info.project) err("bad-epic", `epic must be a key of project ${info.project}`);
    else if (info.stream && info.stream.epics.length > 0 && !info.stream.epics.includes(epic as string)) err("bad-epic", `${epic} is not one of stream ${info.stream.id}'s epics (${info.stream.epics.join(", ")})`);
    if (!tracker.epicLinkField) err("epic-link-field-missing", "tracker.epicLinkField is not in liftoff.yaml: the lead sets the Epic Link field id (Connect skill)");
  }
  if (secretGuard({ summary, description, labels, fields }).length > 0) err("credential-like", "the ticket text looks like a credential; credentials never go in a ticket");

  if (type && typeof description === "string" && type.template) {
    const have = new Set(headingTitles(description, true));
    for (const h of new Set(headingTitles(type.template))) if (!have.has(h)) warnings.push({ code: "template-section-missing", message: `the type's template has a section '${h}' that the description lacks` });
  }

  const ok = errors.length === 0;
  const additional: Json = { ...(type?.createFields ?? {}), ...(isObj(fields) ? fields : {}) };
  if (Array.isArray(labels) && labels.length > 0) additional.labels = labels;
  if (typeof priority === "string") additional.priority = { name: priority };
  const call = ok
    ? { tool: "jira_create_issue" as const, args: { project_key: info.project, issue_type: type!.name, summary: summary!, description: description!, ...(Object.keys(additional).length > 0 && { additional_fields: additional }) } }
    : null;
  const after = ok && typeof epic === "string" && tracker.epicLinkField
    ? [{ tool: "jira_update_issue" as const, args: { issue_key: CREATED_KEY_PLACEHOLDER, fields: { [tracker.epicLinkField]: epic } } }]
    : [];
  const preview = [`${type?.name ?? str("type") ?? "?"}${typeof priority === "string" ? ` · ${priority}` : ""}${Array.isArray(labels) && labels.length ? ` · ${labels.join(", ")}` : ""}${typeof epic === "string" ? ` · epic ${epic}` : ""}`, summary ?? ""].join("\n");
  return { index, ok, errors, warnings, preview, call, after };
}
