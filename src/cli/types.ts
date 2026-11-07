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

export interface CliError {
  code: ErrorCode;
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
}

// What a command handler returns; `run` adds `root` and serializes it.
export interface Outcome {
  exitCode: 0 | 1 | 2;
  body: Record<string, unknown>;
}

export type Handler = (ctx: Context) => Outcome;
