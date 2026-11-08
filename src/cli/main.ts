import { statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { render } from "./apply.js";
import { checkConfigCommand } from "./check.js";
import { parseTicketCommand } from "./parse-ticket.js";
import { planCommand } from "./plan.js";
import { connectInfo } from "./connect-info.js";
import type { Handler, RunResult } from "./types.js";
import { validate } from "./validate.js";

export type { CliError, Context, ErrorCode, Handler, Outcome, RunResult } from "./types.js";

export const USAGE =
  "liftoff <validate|check-config|render|connect-info|parse-ticket|plan> [--root <abs-dir>] [--overwrite <path>]... [--file <ticket.json>] [--key <KEY>] [--approve] | --help";

// The registry of commands: a name is valid only if it is a key here.
export const handlers: Record<string, Handler> = {
  validate,
  "check-config": checkConfigCommand,
  render,
  "connect-info": connectInfo,
  "parse-ticket": parseTicketCommand,
  plan: planCommand,
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
          file: { type: "string" },
          key: { type: "string" },
          approve: { type: "boolean" },
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

    const outcome = table[command]!({ root, overwrite: values.overwrite ?? [], file: values.file, key: values.key, approve: values.approve });
    return json(root, outcome.exitCode, outcome.body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error && e.stack ? e.stack : message;
    return json(root, 2, { ok: false, errors: [{ code: "internal", message }] }, stack + "\n");
  }
}
