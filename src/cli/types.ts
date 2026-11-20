export type ErrorCode =
  | "config-missing"
  | "config-invalid"
  | "plugin-outdated"
  | "render-invalid"
  | "agents-md-missing"
  | "agents-md-invalid"
  | "path-escape"
  | "write-failed"
  | "usage"
  | "internal";

// Codes of the Plan and Build commands. Kept apart from ErrorCode (v1) on purpose.
export type PlanErrorCode = "no-tracker" | "ticket-invalid" | "plan-missing" | "plan-invalid" | "ticket-draft-invalid" | "tracker-read-only" | "criterion-unverified" | "clean-review-missing" | "clean-review-invalid";

// Codes of the brain commands.
export type BrainErrorCode = "no-brain" | "brain-invalid" | "source-invalid" | "source-secret";

// Codes of the lessons commands.
export type LessonErrorCode = "no-lessons" | "lesson-invalid" | "lesson-secret" | "lesson-weakens" | "lesson-tainted" | "lessons-full" | "lessons-block-invalid";

export interface CliError {
  code: ErrorCode | PlanErrorCode | BrainErrorCode | LessonErrorCode;
  message: string;
  path?: string; // JSON pointer, config problems only
  file?: string; // file path relative to root, file problems only
  line?: number;
  col?: number;
}

export interface RunResult {
  stdout: string; // exactly one JSON document, newline-terminated
  stderr: string; // only for unexpected crashes
  exitCode: 0 | 1 | 2;
}

export interface Context {
  root: string; // absolute
  overwrite: string[];
  file?: string; // parse-ticket, draft-tickets
  review?: string; // draft-tickets
  page?: string; // handbook-status, handbook-update, handbook-retire
  reason?: string; // handbook-retire
  key?: string; // plan
  approve?: boolean; // plan
  kind?: string; // brain-source
  write?: boolean; // brain-init, brain-index, brain-source
}

// What a command handler returns; `run` adds `root` and serializes it.
export interface Outcome {
  exitCode: 0 | 1 | 2;
  body: Record<string, unknown>;
}

export type Handler = (ctx: Context) => Outcome;
