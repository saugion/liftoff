import { readFileSync } from "node:fs";
import { parseDocument, type YAMLError } from "yaml";
import { normalize } from "./hash.js";
import { schemaErrors } from "./schema.js";
import { secretGuard } from "./secrets.js";
import type { Config, ConfigError, RawConfig, Result } from "./types.js";

const fail = (message: string): Result<never> => ({ ok: false, errors: [{ path: "", message }] });

// First line of a yaml error, without the trailing ":" that introduces its code snippet.
const yamlError = (e: YAMLError): ConfigError => {
  const error: ConfigError = { path: "", message: (e.message.split("\n")[0] ?? e.message).replace(/:\s*$/, "") };
  const start = e.linePos?.[0];
  if (start) {
    error.line = start.line;
    error.col = start.col;
  }
  return error;
};

export const SUPPORTED_FORMAT = 1;

// A config written for a newer format: one error, no unknown-key noise.
function tooNew(raw: unknown): ConfigError | undefined {
  const format = raw !== null && typeof raw === "object" ? (raw as { liftoff?: unknown }).liftoff : undefined;
  if (typeof format === "number" && Number.isInteger(format) && format > SUPPORTED_FORMAT) {
    return { path: "/liftoff", message: `config format ${format} needs a newer LiftOff, update the plugin` };
  }
  return undefined;
}

// draft-07 can't say "unique across items": check ids in code, pointing at the later duplicate.
function duplicateIds(config: RawConfig): ConfigError[] {
  const seen = new Map<string, number>();
  const errors: ConfigError[] = [];
  (config.modules?.items ?? []).forEach((item, i) => {
    const first = seen.get(item.id);
    if (first === undefined) seen.set(item.id, i);
    else errors.push({ path: `/modules/items/${i}/id`, message: `duplicate module id '${item.id}' (first used at /modules/items/${first}/id)` });
  });
  return errors;
}

export function validateConfig(raw: unknown): Result<Config> {
  const newer = tooNew(raw);
  if (newer) return { ok: false, errors: [newer] };

  // A secret-looking key is also an unknown key for the schema: keep only the more useful secret message.
  const secrets = secretGuard(raw);
  const secretPaths = new Set(secrets.map((e) => e.path));
  const errors = [...schemaErrors(raw).filter((e) => !secretPaths.has(e.path)), ...secrets];
  if (errors.length === 0) errors.push(...duplicateIds(raw as RawConfig));
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: normalize(raw as RawConfig) };
}

// Text in, result out. One YAML document only; duplicate keys and syntax errors are errors.
export function parseConfig(text: string): Result<Config> {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return { ok: false, errors: doc.errors.map(yamlError) };
  if (doc.contents === null) return fail("file is empty");
  return validateConfig(doc.toJS());
}

function readText(file: string): Result<string> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (e) {
    return fail(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return { ok: true, value: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }; // also strips a BOM
  } catch {
    return fail("file is not valid UTF-8");
  }
}

export function readConfig(file: string): Result<Config> {
  const text = readText(file);
  return text.ok ? parseConfig(text.value) : text;
}

// What the compat and pin checks need, read without the schema: a config written for a newer LiftOff may have
// keys this version rejects, and that must not hide the real problem ("update the plugin").
export interface Peek {
  formatVersion?: number; // `liftoff:`, when it is an integer
  pluginVersion?: string; // `plugin.version`, when it is a string
}

export function peekText(text: string): Peek {
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || doc.contents === null) return {}; // the full read reports these
  const raw: unknown = doc.toJS();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const { liftoff, plugin } = raw as { liftoff?: unknown; plugin?: unknown };
  const peek: Peek = {};
  if (typeof liftoff === "number" && Number.isInteger(liftoff)) peek.formatVersion = liftoff;
  const version = plugin !== null && typeof plugin === "object" ? (plugin as { version?: unknown }).version : undefined;
  if (typeof version === "string") peek.pluginVersion = version;
  return peek;
}

export function peekConfig(file: string): Peek {
  const text = readText(file);
  return text.ok ? peekText(text.value) : {};
}
