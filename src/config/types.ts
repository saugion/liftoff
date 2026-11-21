import type { CodeHostConfig, RawCodeHost, RawStreams, RawTracker, StreamsConfig, TrackerConfig } from "./connectors.js";

export const AGENTS = ["claude-code", "copilot"] as const;
export type Agent = (typeof AGENTS)[number];

export interface ModuleItem {
  id: string;
  path: string;
  description?: string;
}

// The lessons loop (opt-in inside `brain`): presence of `lessons` turns it on.
export interface RawLessons { capture?: "notify" | "ask" | "off"; promoteAfter?: number; maxRules?: number; reviewAfterDays?: number; metrics?: boolean }
export interface LessonsConfig { capture: "notify" | "ask" | "off"; promoteAfter: number; maxRules: number; reviewAfterDays: number; metrics: boolean }

// The living handbook (opt-in inside `brain`): presence of `handbook` turns it on.
// `context` (the context-hygiene warnings of brain-check): false turns them off, an object changes a limit or skips a code.
export interface RawContext { maxInstructionLines?: number; maxHooks?: number; maxMcpServers?: number; skip?: string[] }
export interface RawHandbook { maxPages?: number; reviewAfterDays?: number; context?: false | RawContext }
export interface ContextConfig { maxInstructionLines: number; maxHooks: number; maxMcpServers: number; skip: string[] }
export interface HandbookConfig { maxPages: number; reviewAfterDays: number; context: false | ContextConfig }

// Practices with a step of their own in a skill, each on | nudge | off (see docs/decisions/handbook.md, rule 20). Only the
// keys the lead wrote are kept: a default added later never changes the hash of a config already written.
export const PRACTICE_IDS = ["ticket-po-review", "verify-first", "clean-review"] as const;
export type PracticeId = (typeof PRACTICE_IDS)[number];
export type PracticeMode = "on" | "nudge" | "off";
export const PRACTICE_DEFAULTS: Record<PracticeId, PracticeMode> = { "ticket-po-review": "on", "verify-first": "off", "clean-review": "off" };
export type RawPractices = { [K in PracticeId]?: PracticeMode } & { required?: boolean };
export type PracticesConfig = { [K in PracticeId]?: PracticeMode } & { required: boolean };
export interface RawPilot { metrics?: boolean; required?: boolean }
export interface PilotConfig { metrics: boolean; required: boolean }

// What the schema accepts: optional sections and optional fields inside them.
export interface RawConfig {
  liftoff: 1;
  plugin: { version: string; required?: true };
  project: { name: string; kind: "new" | "existing"; setup?: "po" | "done"; required?: boolean };
  agents: { targets: Agent[]; required?: boolean };
  stack?: { languages?: string[]; frameworks?: string[]; required?: boolean };
  modules?: { items?: ModuleItem[]; required?: boolean };
  constraints?: { file?: string; required?: boolean };
  tracker?: Record<string, never> | RawTracker;
  codeHost?: Record<string, never> | RawCodeHost;
  streams?: Record<string, never> | RawStreams;
  build?: { git?: "assisted" | "manual"; required?: boolean };
  practices?: RawPractices;
  pilot?: RawPilot;
  brain?: { dir?: string; hotMaxLines?: number; afterBuild?: "propose" | "off"; required?: boolean; lessons?: RawLessons; handbook?: RawHandbook };
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
  tracker?: Record<string, never> | TrackerConfig;
  codeHost?: Record<string, never> | CodeHostConfig;
  streams?: Record<string, never> | StreamsConfig;
  build?: { git: "assisted" | "manual"; required: boolean }; // assisted: the agent runs git after an approved dry-run; manual: the engineer runs every git write
  practices?: PracticesConfig;
  pilot?: PilotConfig;
  brain?: { dir: string; hotMaxLines: number; afterBuild: "propose" | "off"; required: boolean; lessons?: LessonsConfig; handbook?: HandbookConfig }; // presence of the section is the opt-in
}

export interface ConfigError {
  path: string; // JSON pointer, e.g. /agents/targets/0; "" for syntax errors and root problems
  message: string;
  line?: number; // YAML syntax errors only
  col?: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: ConfigError[] };
