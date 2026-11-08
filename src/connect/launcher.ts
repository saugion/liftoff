import type { TrackerConfig } from "../config/index.js";
import { shQuote } from "./shell.js";

export const TOKEN_ENV = "LIFTOFF_JIRA_TOKEN";

// hostname[:port], lowercased (normalization already did), path dropped: one keychain item per instance.
export const keychainService = (tracker: TrackerConfig): string => `liftoff-jira@${/^https:\/\/([^/]+)/.exec(tracker.url)![1]}`;

const keychainRead = (service: string) => `security find-generic-password -a "$(id -un)" -s ${shQuote(service)}`;

// Resolves the token inside the server's own process: it appears in no argument, committed file or log. The token
// variable is read with printenv, never written after a `$`, so no MCP host can expand it. The last line is the one
// the preflight replaces. `--env-file /dev/null` stops the server from loading a stray .env over our settings.
function lines(tracker: TrackerConfig, last: string): string[] {
  const service = keychainService(tracker);
  return [
    `command -v uvx >/dev/null || { echo "liftoff: uvx not found (brew install uv)" >&2; exit 1; }`,
    `T="$(printenv ${TOKEN_ENV})"`,
    `[ -n "$T" ] || T="$(${keychainRead(service)} -w 2>/dev/null)"`,
    `[ -n "$T" ] || { echo "liftoff: no Jira token found (or the keychain is locked); run the LiftOff Connect skill" >&2; exit 1; }`,
    last,
  ];
}

const pkg = (tracker: TrackerConfig) => `mcp-atlassian@${tracker.server.version}`;

export const launcher = (tracker: TrackerConfig): string =>
  lines(tracker, `JIRA_PERSONAL_TOKEN="$T" exec uvx ${pkg(tracker)} --env-file /dev/null`).join("; ");

export const preflight = (tracker: TrackerConfig): string =>
  `sh -c ${shQuote(lines(tracker, `exec uvx ${pkg(tracker)} --version >/dev/null`).join("; "))}`;

export const keychainCommands = (tracker: TrackerConfig) => {
  const service = keychainService(tracker);
  const base = (verb: string) => `security ${verb} -a "$(id -un)" -s ${shQuote(service)}`;
  return {
    service,
    check: `${keychainRead(service)} >/dev/null 2>&1`,
    add: `${base("add-generic-password -U")} -w`,
    remove: base("delete-generic-password"),
  };
};
