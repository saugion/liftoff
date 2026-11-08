import { compareVersions } from "./version.js";
import type { Config, ConfigError, RawConfig } from "./types.js";

export const MIN_CONNECT_PLUGIN = "0.2";
export const MIN_JIRA_SERVER_VERSION = "0.22.0";
export const MIN_STREAMS_PLUGIN = "0.3";
export const MIN_BUILD_PLUGIN = "0.3";

export type Transition = { name: string; fields?: Record<string, unknown> };
export type IssueType = {
  name: string;
  branchType?: string;
  readingMap: { acceptanceCriteria?: { heading: string } | { field: string }; fields: { id: string; label: string }[] };
  template?: string;
  createFields: Record<string, unknown>;
  transitions: { start?: Transition; review?: Transition; done?: Transition };
};
export type TrackerConfig = {
  kind: "jira-dc";
  url: string;
  project: string;
  server: { version: string; sslVerify: boolean; readOnly: boolean };
  epicLinkField?: string; // the Server/DC Epic Link custom field, set after creation
  epicNameField?: string; // the Epic Name custom field Jira asks for when an Epic is created (its value is the epic's own name)
  issueTypes: IssueType[];
};
export type Stream = { id: string; project: string; mode: "kanban"; module?: string; epics: string[]; issueTypes: IssueType[] };
export type StreamsConfig = { items: Stream[] };
export type CodeHostConfig = {
  kind: "gitlab";
  host: string;
  conventions: { targetBranch?: string; branchPattern?: string; titlePattern?: string; mrTemplate?: string; labels: string[]; reviewers: string[] };
};

// What the schema accepts (optionals still optional).
export type RawIssueType = Partial<Omit<IssueType, "readingMap">> & { name: string; readingMap?: Partial<IssueType["readingMap"]> };
export type RawTracker = Omit<TrackerConfig, "server" | "issueTypes"> & {
  server: { version: string; sslVerify?: boolean; readOnly?: boolean };
  issueTypes?: RawIssueType[];
};
export type RawStream = Omit<Stream, "epics" | "issueTypes"> & { epics?: string[]; issueTypes?: RawIssueType[] };
export type RawStreams = { items?: RawStream[] };
export type RawCodeHost = Omit<CodeHostConfig, "conventions"> & { conventions?: Partial<CodeHostConfig["conventions"]> };

// `{}` matches anything in TypeScript, so a section is read only through this accessor.
// Which tracker project a key belongs to, with the issue types that apply there. A stream without its own issue
// types inherits the tracker's (`inherited`), because workflows and templates are per project.
export interface ProjectInfo { project: string; stream?: Stream; issueTypes: IssueType[]; inherited: boolean }
export function projectsOf(config: Config): ProjectInfo[] {
  const { tracker } = connectors(config);
  if (!tracker) return [];
  const streams = isConnector(config.streams) ? (config.streams as StreamsConfig).items : [];
  return [
    { project: tracker.project, issueTypes: tracker.issueTypes, inherited: false },
    ...streams.map((s) => ({ project: s.project, stream: s, issueTypes: s.issueTypes.length > 0 ? s.issueTypes : tracker.issueTypes, inherited: s.issueTypes.length === 0 })),
  ];
}

export function connectors(config: Config): { tracker?: TrackerConfig; codeHost?: CodeHostConfig } {
  return {
    ...(isConnector(config.tracker) && { tracker: config.tracker }),
    ...(isConnector(config.codeHost) && { codeHost: config.codeHost }),
  };
}
const isConnector = (v: unknown): v is never => v !== null && typeof v === "object" && Object.keys(v).length > 0;

// Lowercase the host, drop trailing slashes. Shapes are already validated by the schema.
const normalizeUrl = (url: string): string => {
  const m = /^(https:\/\/)([^/:]+)(:\d+)?(\/.*)?$/.exec(url)!;
  return `${m[1]}${m[2]!.toLowerCase()}${m[3] ?? ""}${(m[4] ?? "").replace(/\/+$/, "")}`;
};

const normalizeTransition = (t: Transition): Transition => ({ name: t.name, ...(t.fields && { fields: t.fields }) });

function normalizeIssueType(t: RawIssueType): IssueType {
  const transitions: IssueType["transitions"] = {};
  for (const role of ["start", "review", "done"] as const) if (t.transitions?.[role]) transitions[role] = normalizeTransition(t.transitions[role]);
  return {
    name: t.name,
    ...(t.branchType !== undefined && { branchType: t.branchType }),
    readingMap: {
      ...(t.readingMap?.acceptanceCriteria && { acceptanceCriteria: t.readingMap.acceptanceCriteria }),
      fields: (t.readingMap?.fields ?? []).map((f) => ({ ...f })),
    },
    ...(t.template !== undefined && { template: t.template }),
    createFields: t.createFields ?? {},
    transitions,
  };
}

export const normalizeStreams = (s: RawStreams): StreamsConfig => ({
  items: (s.items ?? []).map((i) => ({
    id: i.id,
    project: i.project,
    mode: i.mode,
    ...(i.module !== undefined && { module: i.module }),
    epics: [...(i.epics ?? [])],
    issueTypes: (i.issueTypes ?? []).map(normalizeIssueType),
  })),
});

export const normalizeTracker = (t: RawTracker): TrackerConfig => ({
  kind: t.kind,
  url: normalizeUrl(t.url),
  project: t.project,
  ...(t.epicLinkField !== undefined && { epicLinkField: t.epicLinkField }),
  ...(t.epicNameField !== undefined && { epicNameField: t.epicNameField }),
  server: { version: t.server.version, sslVerify: t.server.sslVerify ?? true, readOnly: t.server.readOnly ?? false },
  issueTypes: (t.issueTypes ?? []).map(normalizeIssueType),
});

export const normalizeCodeHost = (c: RawCodeHost): CodeHostConfig => {
  const v = c.conventions ?? {};
  return {
    kind: c.kind,
    host: c.host.toLowerCase(),
    conventions: {
      ...(v.targetBranch !== undefined && { targetBranch: v.targetBranch }),
      ...(v.branchPattern !== undefined && { branchPattern: v.branchPattern }),
      ...(v.titlePattern !== undefined && { titlePattern: v.titlePattern }),
      ...(v.mrTemplate !== undefined && { mrTemplate: v.mrTemplate }),
      labels: v.labels ?? [],
      reviewers: v.reviewers ?? [],
    },
  };
};

const portOk = (hostPort: string): boolean => {
  const m = /:(\d+)(?:\/|$)/.exec(hostPort);
  return m === null || (Number(m[1]) >= 1 && Number(m[1]) <= 65535);
};

function badPlaceholders(pattern: string, allowed: string[]): string[] {
  return [...pattern.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]!).filter((p) => !allowed.includes(p));
}

// Duplicate type names (Jira treats them case-insensitively) and duplicate reading-map field ids.
function issueTypeErrors(types: RawIssueType[], base: string): ConfigError[] {
  const errors: ConfigError[] = [];
  const seen = new Map<string, number>();
  types.forEach((t, i) => {
    const key = t.name.toLowerCase();
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i);
    else errors.push({ path: `${base}/${i}/name`, message: `duplicate issue type '${t.name}' (first at ${base}/${first}/name)` });
    const ids = new Map<string, number>();
    (t.readingMap?.fields ?? []).forEach((f, j) => {
      const firstId = ids.get(f.id);
      if (firstId === undefined) ids.set(f.id, j);
      else errors.push({ path: `${base}/${i}/readingMap/fields/${j}/id`, message: `duplicate field id '${f.id}' (first at index ${firstId})` });
    });
  });
  return errors;
}

// The checks the schema cannot express, each pointing at the offender. Runs only on a schema-valid config.
export function connectorErrors(raw: RawConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  const tracker = isConnector(raw.tracker) ? (raw.tracker as RawTracker) : undefined;
  const codeHost = isConnector(raw.codeHost) ? (raw.codeHost as RawCodeHost) : undefined;

  if ((tracker || codeHost) && (compareVersions(raw.plugin.version, MIN_CONNECT_PLUGIN) ?? -1) < 0) {
    errors.push({ path: "/plugin/version", message: `tracker and codeHost need plugin.version ${MIN_CONNECT_PLUGIN} or newer` });
  }
  if (raw.build && (compareVersions(raw.plugin.version, MIN_BUILD_PLUGIN) ?? -1) < 0) {
    errors.push({ path: "/plugin/version", message: `the build section needs plugin.version ${MIN_BUILD_PLUGIN} or newer` });
  }
  if (tracker) {
    if (!portOk(tracker.url.slice("https://".length))) errors.push({ path: "/tracker/url", message: "port must be 1-65535" });
    if ((compareVersions(tracker.server.version, MIN_JIRA_SERVER_VERSION) ?? -1) < 0) {
      errors.push({ path: "/tracker/server/version", message: `mcp-atlassian ${MIN_JIRA_SERVER_VERSION} or newer is needed (the lead flow uses tools added in it)` });
    }
    errors.push(...issueTypeErrors(tracker.issueTypes ?? [], "/tracker/issueTypes"));
  }
  if (codeHost) {
    if (!portOk(codeHost.host)) errors.push({ path: "/codeHost/host", message: "port must be 1-65535" });
    const c = codeHost.conventions;
    const bp = c?.branchPattern !== undefined ? badPlaceholders(c.branchPattern, ["key", "slug", "type"]) : [];
    if (bp.length) errors.push({ path: "/codeHost/conventions/branchPattern", message: `unknown placeholder {${bp[0]}}; allowed: {key} {slug} {type}` });
    const tp = c?.titlePattern !== undefined ? badPlaceholders(c.titlePattern, ["key", "summary", "type"]) : [];
    if (tp.length) errors.push({ path: "/codeHost/conventions/titlePattern", message: `unknown placeholder {${tp[0]}}; allowed: {key} {summary} {type}` });
  }
  const items = isConnector(raw.streams) ? ((raw.streams as RawStreams).items ?? []) : [];
  if (items.length > 0) {
    if (!tracker) errors.push({ path: "/streams", message: "streams need a tracker: link the Jira instance first (Connect skill)" });
    if ((compareVersions(raw.plugin.version, MIN_STREAMS_PLUGIN) ?? -1) < 0) errors.push({ path: "/plugin/version", message: `streams need plugin.version ${MIN_STREAMS_PLUGIN} or newer` });
    const ids = new Map<string, number>(), projects = new Map<string, number>();
    const modules = new Set((raw.modules?.items ?? []).map((m) => m.id));
    items.forEach((s, i) => {
      const at = `/streams/items/${i}`;
      if (ids.has(s.id)) errors.push({ path: `${at}/id`, message: `duplicate stream id '${s.id}' (first at /streams/items/${ids.get(s.id)}/id)` });
      else ids.set(s.id, i);
      if (tracker && s.project === tracker.project) errors.push({ path: `${at}/project`, message: `'${s.project}' is the tracker's own project, not a stream` });
      else if (projects.has(s.project)) errors.push({ path: `${at}/project`, message: `duplicate stream project '${s.project}' (first at /streams/items/${projects.get(s.project)}/project)` });
      else projects.set(s.project, i);
      if (s.module !== undefined && !modules.has(s.module)) errors.push({ path: `${at}/module`, message: `module '${s.module}' is not in modules.items` });
      (s.epics ?? []).forEach((e, j) => {
        if (!e.startsWith(`${s.project}-`)) errors.push({ path: `${at}/epics/${j}`, message: `epic ${e} is not in the stream's project ${s.project}` });
      });
      errors.push(...issueTypeErrors(s.issueTypes ?? [], `${at}/issueTypes`));
    });
  }
  return errors;
}
