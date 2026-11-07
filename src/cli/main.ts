import { statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

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

export const USAGE =
  "liftoff <validate|check-config|render> [--root <abs-dir>] [--overwrite <path>]... | --help";

const notImplemented: Handler = () => ({
  exitCode: 2,
  body: { ok: false, errors: [{ code: "internal", message: "not implemented yet" }] },
});

// ponytail: stubs until each command's task lands; replace entries, keep the registry.
export const handlers: Record<string, Handler> = {
  validate: notImplemented,
  "check-config": notImplemented,
  render: notImplemented,
};

function json(root: string, exitCode: RunResult["exitCode"], body: Record<string, unknown>, stderr = ""): RunResult {
  return { stdout: JSON.stringify({ root, ...body }) + "\n", stderr, exitCode };
}

function usageError(root: string, message: string): RunResult {
  return json(root, 2, { ok: false, errors: [{ code: "usage", message: `${message}. Usage: ${USAGE}` }] });
}

export function run(argv: string[], cwd: string, table: Record<string, Handler> = handlers): RunResult {
  let root = resolve(cwd);
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
          root: { type: "string" },
          overwrite: { type: "string", multiple: true },
          help: { type: "boolean" },
        },
      });
    } catch (e) {
      return usageError(root, e instanceof Error ? e.message : String(e));
    }
    const { values, positionals } = parsed;
    if (values.help) return { stdout: JSON.stringify({ usage: USAGE }) + "\n", stderr: "", exitCode: 0 };

    root = resolve(cwd, values.root ?? ".");
    const [command, ...extra] = positionals;
    if (!command || extra.length > 0 || !Object.hasOwn(table, command)) {
      return usageError(root, command ? `Unknown command or extra arguments: ${positionals.join(" ")}` : "Missing command");
    }
    if (values.overwrite && command !== "render") {
      return usageError(root, "--overwrite is only valid for render");
    }
    let isDir = false;
    try {
      isDir = statSync(root).isDirectory();
    } catch {
      // not found: reported below
    }
    if (!isDir) return usageError(root, "--root must be an existing directory");

    const outcome = table[command]!({ root, overwrite: values.overwrite ?? [] });
    return json(root, outcome.exitCode, outcome.body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error && e.stack ? e.stack : message;
    return json(root, 2, { ok: false, errors: [{ code: "internal", message }] }, stack + "\n");
  }
}
