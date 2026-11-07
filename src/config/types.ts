export const AGENTS = ["claude-code", "copilot"] as const;
export type Agent = (typeof AGENTS)[number];

export interface ModuleItem {
  id: string;
  path: string;
  description?: string;
}

// What the schema accepts: optional sections and optional fields inside them.
export interface RawConfig {
  liftoff: 1;
  plugin: { version: string; required?: true };
  project: { name: string; kind: "new" | "existing"; required?: boolean };
  agents: { targets: Agent[]; required?: boolean };
  stack?: { languages?: string[]; frameworks?: string[]; required?: boolean };
  modules?: { items?: ModuleItem[]; required?: boolean };
  constraints?: { file?: string; required?: boolean };
  tracker?: Record<string, never>;
  codeHost?: Record<string, never>;
}

// Normalized: defaults applied inside every section that is present. An absent section stays absent.
export interface Config {
  liftoff: 1;
  plugin: { version: string; required: true };
  project: { name: string; kind: "new" | "existing"; required: boolean };
  agents: { targets: Agent[]; required: boolean };
  stack?: { languages: string[]; frameworks: string[]; required: boolean };
  modules?: { items: ModuleItem[]; required: boolean };
  constraints?: { file: string; required: boolean };
  tracker?: Record<string, never>;
  codeHost?: Record<string, never>;
}

export interface ConfigError {
  path: string; // JSON pointer, e.g. /agents/targets/0; "" for syntax errors and root problems
  message: string;
  line?: number; // YAML syntax errors only
  col?: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: ConfigError[] };
