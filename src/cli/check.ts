import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ConfigError, requiredSections, sectionHashes } from "../config/index.js";
import { readConfigWithPin } from "./read-config.js";
import { readApplied, readPersonal } from "./state.js";
import type { Handler } from "./types.js";
import { CONFIG_FILE } from "./validate.js";
import { INSTALLED_VERSION, outdatedMessage } from "./version.js";

export type ReasonCode =
  | "config-missing"
  | "config-invalid"
  | "plugin-outdated"
  | "not-applied"
  | "required-changed"
  | "optional-changed"
  | "unresolved-conflict";

export interface Reason {
  code: ReasonCode;
  message: string;
  section?: string; // required-changed, optional-changed
  minimum?: string; // plugin-outdated, when the pin is why
  file?: string; // unresolved-conflict
  errors?: ConfigError[]; // config-invalid
}

export interface CheckResult {
  status: "ok" | "warn" | "blocked";
  installedVersion: string;
  reasons: Reason[];
  suppressed?: Reason[]; // reasons hidden by warn_on_config_update: false
  hint?: { nearestRoot?: string };
}

// Nearest ancestor holding a liftoff.yaml or a .git: a stat only, no git call. Init uses it so that a shell that
// cd'd into a subdirectory does not start a second config.
export function nearestRoot(root: string): string | undefined {
  for (let dir = dirname(root); dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, CONFIG_FILE)) || existsSync(join(dir, ".git"))) return dir;
  }
  return undefined;
}

const blocked = (reasons: Reason[], hint?: CheckResult["hint"]): CheckResult => ({
  status: "blocked",
  installedVersion: INSTALLED_VERSION,
  reasons,
  ...(hint && { hint }),
});

export function checkConfig(root: string): CheckResult {
  const read = readConfigWithPin(root);
  switch (read.kind) {
    case "missing": {
      const near = nearestRoot(root);
      return blocked([{ code: "config-missing", message: `${CONFIG_FILE} not found in ${root}` }], near === undefined ? undefined : { nearestRoot: near });
    }
    case "invalid":
      return blocked([{ code: "config-invalid", message: `${CONFIG_FILE} is invalid (${read.errors.length} problem${read.errors.length === 1 ? "" : "s"}); see errors`, errors: read.errors }]);
    case "outdated":
      return blocked([{ code: "plugin-outdated", message: outdatedMessage(read.minimum), ...(read.minimum !== undefined && { minimum: read.minimum }) }]);
  }

  // The pin is satisfied (readConfigWithPin checked it first). Next: has this config been applied here?
  const applied = readApplied(realpathSync(root));
  if (applied.kind === "missing") {
    return blocked([{ code: "not-applied", message: "this repo's config has not been applied here yet: run the LiftOff Init skill (it runs render)" }]);
  }
  if (applied.kind === "corrupt") {
    return blocked([{ code: "not-applied", message: ".liftoff/applied.json is unreadable: run the LiftOff Init skill to apply the config again and rewrite it" }]);
  }
  if (applied.kind === "newer") {
    return blocked([{ code: "not-applied", message: ".liftoff/applied.json was written by a newer LiftOff than the installed one: update the plugin, then run Init again" }]);
  }

  // Changes since the record. A change is *required* if the section is required in the old OR the new config
  // (so un-requiring a section, or removing a required one, still blocks until applied).
  const { record } = applied;
  const before = record.sectionHashes;
  const after = sectionHashes(read.config);
  const required = new Set([...record.requiredSections, ...requiredSections(read.config)]);
  const requiredChanges: Reason[] = [];
  const optionalChanges: Reason[] = [];
  for (const section of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (before[section] === after[section]) continue;
    const what = before[section] === undefined ? "was added" : after[section] === undefined ? "was removed" : "changed";
    if (required.has(section)) {
      requiredChanges.push({ code: "required-changed", section, message: `required section '${section}' ${what} since this repo's config was last applied: run the LiftOff Init skill to apply it` });
    } else {
      optionalChanges.push({ code: "optional-changed", section, message: `section '${section}' ${what} since this repo's config was last applied (not required): run the LiftOff Init skill to apply it, or ignore it` });
    }
  }

  // warn_on_config_update: false hides non-required changes (still returned, in `suppressed`); it never hides a conflict.
  const quiet = !readPersonal(realpathSync(root)).warnOnConfigUpdate;
  const conflicts: Reason[] = [...record.conflicts].sort().map((file) => ({
    code: "unresolved-conflict",
    file,
    message: `${file} was left as it was and differs from what LiftOff would generate: run the LiftOff Init skill to resolve it`,
  }));

  const reasons = [...requiredChanges, ...(quiet ? [] : optionalChanges), ...conflicts];
  const suppressed = quiet ? optionalChanges : [];
  const status = requiredChanges.length > 0 ? "blocked" : reasons.length > 0 ? "warn" : "ok";
  return { status, installedVersion: INSTALLED_VERSION, reasons, ...(suppressed.length > 0 && { suppressed }) };
}

export const checkConfigCommand: Handler = ({ root }) => {
  const result = checkConfig(root);
  return { exitCode: result.status === "blocked" ? 1 : 0, body: { ...result } };
};
