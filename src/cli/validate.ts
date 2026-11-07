import { existsSync } from "node:fs";
import { join } from "node:path";
import { readConfig } from "../config/read.js";
import type { ConfigError } from "../config/types.js";
import type { CliError, Handler } from "./types.js";

export const CONFIG_FILE = "liftoff.yaml";

export const toCliError = (e: ConfigError): CliError => ({ code: "config-invalid", ...e });

// Ignores the applied record and the plugin pin: Init calls it in a write-then-validate loop.
export const validate: Handler = ({ root }) => {
  const file = join(root, CONFIG_FILE);
  if (!existsSync(file)) {
    return { exitCode: 1, body: { ok: false, errors: [{ code: "config-missing", message: `${CONFIG_FILE} not found in ${root}` }] } };
  }
  const result = readConfig(file);
  if (!result.ok) return { exitCode: 1, body: { ok: false, errors: result.errors.map(toCliError) } };
  return { exitCode: 0, body: { ok: true } };
};
