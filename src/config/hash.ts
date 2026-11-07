import type { Config, RawConfig } from "./types.js";

// Applies the defaults inside every section that is present. An absent section stays absent
// (sectionHashes has no key for it). Hashing is added in T4.
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
    ...(raw.tracker && { tracker: {} }),
    ...(raw.codeHost && { codeHost: {} }),
  };
}
