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
  isEpic: boolean;
  registerInStream: string | null; // an epic created in a stream: the stream whose `epics` list should get its key
  call: { tool: "jira_create_issue"; args: Json } | null;
  after: { tool: "jira_update_issue"; args: Json }[];
}

const KEY = /^([A-Z][A-Z0-9_]+)-[0-9]+$/;
export const CREATED_KEY_PLACEHOLDER = "<created key>";
export const keyOfTicket = (n: number) => `<key of ticket ${n}>`; // the key of an earlier ticket of the same batch
const isEpicType = (name: unknown) => typeof name === "string" && name.toLowerCase() === "epic";

// What the module check needs from the config: the module ids, and which module each stream feeds.
export interface ModuleContext { modules: Set<string>; streamOf: Map<string, string> }

export function checkTicket(raw: unknown, index: number, tracker: TrackerConfig, info: ProjectInfo, mods: ModuleContext = { modules: new Set(), streamOf: new Map() }, batch: unknown[] = []): DraftResult {
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

  const isEpic = isEpicType(type?.name ?? str("type"));
  const epic = t.epic;
  let epicValue: string | undefined; // the key to link, or the placeholder of an earlier ticket of this batch
  if (epic !== undefined) {
    const ref = typeof epic === "string" ? /^#(\d+)$/.exec(epic) : null;
    const m = typeof epic === "string" ? KEY.exec(epic) : null;
    if (isEpic) err("epic-in-epic", "an epic cannot be linked to another epic");
    else if (ref) {
      const n = Number(ref[1]);
      const target = n < index ? batch[n] : undefined;
      if (!isObj(target) || !isEpicType(target.type)) err("bad-epic", `'${epic}' must point to an earlier ticket of type Epic in this batch`);
      else epicValue = keyOfTicket(n);
    } else if (!m || m[1] !== info.project) err("bad-epic", `epic must be a key of project ${info.project}, or #N for an Epic earlier in this batch`);
    else {
      if (info.stream && info.stream.epics.length > 0 && !info.stream.epics.includes(epic as string)) err("bad-epic", `${epic} is not one of stream ${info.stream.id}'s epics (${info.stream.epics.join(", ")})`);
      epicValue = epic as string;
    }
    if (!tracker.epicLinkField) err("epic-link-field-missing", "tracker.epicLinkField is not in liftoff.yaml: the lead sets the Epic Link field id (Connect skill)");
  }
  if (secretGuard({ summary, description, labels, fields }).length > 0) err("credential-like", "the ticket text looks like a credential; credentials never go in a ticket");

  if (type && typeof description === "string" && type.template) {
    const have = new Set(headingTitles(description, true));
    for (const h of new Set(headingTitles(type.template))) if (!have.has(h)) warnings.push({ code: "template-section-missing", message: `the type's template has a section '${h}' that the description lacks` });
  }

  const ok = errors.length === 0;
  const additional: Json = { ...(type?.createFields ?? {}), ...(isObj(fields) ? fields : {}) };
  if (isEpic && tracker.epicNameField && additional[tracker.epicNameField] === undefined && typeof summary === "string") additional[tracker.epicNameField] = summary.trim(); // the epic's own name: its summary, unless the draft gave `fields`
  if (Array.isArray(labels) && labels.length > 0) additional.labels = labels;
  if (typeof priority === "string") additional.priority = { name: priority };
  const call = ok
    ? { tool: "jira_create_issue" as const, args: { project_key: info.project, issue_type: type!.name, summary: summary!, description: description!, ...(Object.keys(additional).length > 0 && { additional_fields: additional }) } }
    : null;
  const after = ok && epicValue !== undefined && tracker.epicLinkField
    ? [{ tool: "jira_update_issue" as const, args: { issue_key: CREATED_KEY_PLACEHOLDER, fields: { [tracker.epicLinkField]: epicValue } } }]
    : [];
  const preview = [`${type?.name ?? str("type") ?? "?"}${typeof priority === "string" ? ` · ${priority}` : ""}${Array.isArray(labels) && labels.length ? ` · ${labels.join(", ")}` : ""}${typeof epic === "string" ? ` · epic ${epic}` : ""}`, summary ?? ""].join("\n");
  return { index, ok, errors, warnings, preview, isEpic, registerInStream: ok && isEpic && info.stream ? info.stream.id : null, call, after };
}
