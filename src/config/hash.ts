import { createHash } from "node:crypto";
import { normalizeCodeHost, normalizeStreams, normalizeTracker, type RawCodeHost, type RawStreams, type RawTracker } from "./connectors.js";
import type { Config, RawConfig } from "./types.js";

// Applies the defaults inside every section that is present. An absent section stays absent
// (sectionHashes has no key for it).
export function normalize(raw: RawConfig): Config {
  return {
    liftoff: 1,
    plugin: { version: raw.plugin.version, required: true },
    project: { name: raw.project.name, kind: raw.project.kind, required: raw.project.required ?? false },
    agents: { targets: [...raw.agents.targets], required: raw.agents.required ?? false },
    ...(raw.stack && {
      stack: { languages: raw.stack.languages ?? [], frameworks: raw.stack.frameworks ?? [], required: raw.stack.required ?? false },
    }),
    ...(raw.modules && {
      modules: { items: (raw.modules.items ?? []).map((i) => ({ ...i })), required: raw.modules.required ?? false },
    }),
    ...(raw.constraints && {
      constraints: { file: raw.constraints.file ?? "CONSTRAINTS.md", required: raw.constraints.required ?? false },
    }),
    ...(raw.tracker && { tracker: Object.keys(raw.tracker).length === 0 ? {} : normalizeTracker(raw.tracker as RawTracker) }),
    ...(raw.streams && { streams: Object.keys(raw.streams).length === 0 ? {} : normalizeStreams(raw.streams as RawStreams) }),
    ...(raw.codeHost && { codeHost: Object.keys(raw.codeHost).length === 0 ? {} : normalizeCodeHost(raw.codeHost as RawCodeHost) }),
  };
}

// JSON with keys sorted recursively and no whitespace. Array order is meaningful and kept.
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (text: string): string => "sha256:" + createHash("sha256").update(text).digest("hex");

// One hash per present top-level section (the `liftoff` scalar too). `required` is part of its section's hash.
export function sectionHashes(config: Config): Record<string, string> {
  return Object.fromEntries(Object.entries(config).map(([name, value]) => [name, sha256(canonicalize(value))]));
}

export const configHash = (config: Config): string => sha256(canonicalize(sectionHashes(config)));

// Sections flagged `required: true`, plus `liftoff` and `plugin`, which are always required. Sorted.
export function requiredSections(config: Config): string[] {
  const flagged = Object.entries(config)
    .filter(([name, value]) => name !== "plugin" && value !== null && typeof value === "object" && (value as { required?: unknown }).required === true)
    .map(([name]) => name);
  return [...new Set(["liftoff", "plugin", ...flagged])].sort();
}
