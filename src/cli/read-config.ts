import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Config, type ConfigError, SUPPORTED_FORMAT, peekConfig, readConfig } from "../config/index.js";
import type { CliError } from "./types.js";
import { CONFIG_FILE, toCliError } from "./validate.js";
import { INSTALLED_VERSION, compareVersions, outdatedMessage } from "./version.js";

export type ReadOutcome =
  | { kind: "ok"; config: Config }
  | { kind: "missing" }
  | { kind: "invalid"; errors: ConfigError[] }
  | { kind: "outdated"; minimum?: string }; // minimum: the pin, when that is why; absent when only the format is newer

// The one way `check-config` and `render` read the config: the plugin pin first. A config for a newer format, or
// pinned above the installed plugin, is "update the plugin" and nothing else, never unknown-key noise.
export function readConfigWithPin(root: string): ReadOutcome {
  const file = join(root, CONFIG_FILE);
  if (!existsSync(file)) return { kind: "missing" };

  const peek = peekConfig(file);
  const formatTooNew = peek.formatVersion !== undefined && peek.formatVersion > SUPPORTED_FORMAT;
  const pinOrder = peek.pluginVersion === undefined ? undefined : compareVersions(INSTALLED_VERSION, peek.pluginVersion);
  const pinTooNew = pinOrder !== undefined && pinOrder < 0;
  if (formatTooNew || pinTooNew) return pinTooNew ? { kind: "outdated", minimum: peek.pluginVersion! } : { kind: "outdated" };

  const read = readConfig(file);
  return read.ok ? { kind: "ok", config: read.value } : { kind: "invalid", errors: read.errors };
}

// The fatal-error shape `render` reports for a read that did not succeed.
export function readFailure(root: string, outcome: Exclude<ReadOutcome, { kind: "ok" }>): CliError[] {
  switch (outcome.kind) {
    case "missing":
      return [{ code: "config-missing", message: `${CONFIG_FILE} not found in ${root}` }];
    case "invalid":
      return outcome.errors.map(toCliError);
    case "outdated":
      return [{ code: "plugin-outdated", message: outdatedMessage(outcome.minimum) }];
  }
}
