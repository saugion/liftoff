import { statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { render } from "./apply.js";
import { checkConfigCommand } from "./check.js";
import { brainCheck } from "./brain-check.js";
import { brainIndex } from "./brain-index.js";
import { brainSource } from "./brain-source.js";
import { lessonAdd } from "./lesson-add.js";
import { lessonList } from "./lesson-list.js";
import { handbookInit, handbookRetire, handbookStatus, handbookUpdate } from "./handbook.js";
import { pilotMetrics } from "./pilot-metrics.js";
import { lessonMetrics } from "./lesson-metrics.js";
import { lessonPromote } from "./lesson-promote.js";
import { brainInit } from "./brain-init.js";
import { draftTicketsCommand } from "./draft-tickets.js";
import { parseTicketCommand } from "./parse-ticket.js";
import { planCommand } from "./plan.js";
import { connectInfo } from "./connect-info.js";
import type { Handler, RunResult } from "./types.js";
import { validate } from "./validate.js";

export type { CliError, Context, ErrorCode, Handler, Outcome, RunResult } from "./types.js";

export const USAGE =
  "liftoff <validate|check-config|render|connect-info|parse-ticket|plan|draft-tickets|brain-init|brain-index|brain-source|brain-check|lesson-add|lesson-list|lesson-promote|lesson-metrics|pilot-metrics|handbook-init|handbook-status|handbook-update|handbook-retire> [--kind <ticket|plan|mr|doc|lesson>] [--root <abs-dir>] [--overwrite <path>]... [--file <ticket.json>] [--review <review.json>] [--key <KEY>] [--page <id>] [--reason <text>] [--approve] [--write] | --help";

// The registry of commands: a name is valid only if it is a key here.
export const handlers: Record<string, Handler> = {
  validate,
  "check-config": checkConfigCommand,
  render,
  "connect-info": connectInfo,
  "parse-ticket": parseTicketCommand,
  plan: planCommand,
  "draft-tickets": draftTicketsCommand,
  "brain-init": brainInit,
  "brain-index": brainIndex,
  "brain-source": brainSource,
  "brain-check": brainCheck,
  "lesson-add": lessonAdd,
  "lesson-list": lessonList,
  "lesson-promote": lessonPromote,
  "lesson-metrics": lessonMetrics,
  "pilot-metrics": pilotMetrics,
  "handbook-init": handbookInit,
  "handbook-status": handbookStatus,
  "handbook-update": handbookUpdate,
  "handbook-retire": handbookRetire,
};

// Commands that can write into the brain; --write is refused everywhere else.
const WRITE_COMMANDS = new Set(["brain-init", "brain-index", "brain-source", "lesson-add", "lesson-promote", "handbook-init", "handbook-update", "handbook-retire"]);

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
          review: { type: "string" },
          page: { type: "string" },
          reason: { type: "string" },
          key: { type: "string" },
          approve: { type: "boolean" },
          write: { type: "boolean" },
          kind: { type: "string" },
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
    if ((values.page !== undefined || values.reason !== undefined) && !command.startsWith("handbook-")) {
      return usageError(root, "--page and --reason are only valid for the handbook commands");
    }
    if (values.review && command !== "draft-tickets") {
      return usageError(root, "--review is only valid for draft-tickets");
    }
    if (values.write && !WRITE_COMMANDS.has(command)) {
      return usageError(root, "--write is only valid for brain-init, brain-index, brain-source, lesson-add, lesson-promote, handbook-init, handbook-update and handbook-retire");
    }
    let isDir = false;
    try {
      isDir = statSync(root).isDirectory();
    } catch {
      // not found: reported below
    }
    if (!isDir) return usageError(root, "--root must be an existing directory");

    const outcome = table[command]!({ root, overwrite: values.overwrite ?? [], file: values.file, review: values.review, page: values.page, reason: values.reason, key: values.key, approve: values.approve, write: values.write, kind: values.kind });
    return json(root, outcome.exitCode, outcome.body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error && e.stack ? e.stack : message;
    return json(root, 2, { ok: false, errors: [{ code: "internal", message }] }, stack + "\n");
  }
}
