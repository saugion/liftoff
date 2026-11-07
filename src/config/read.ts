import { readFileSync } from "node:fs";
import { parseDocument, type YAMLError } from "yaml";
import { normalize } from "./hash.js";
import { schemaErrors } from "./schema.js";
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

export function validateConfig(raw: unknown): Result<Config> {
  const errors = schemaErrors(raw);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: normalize(raw as RawConfig) };
}

// Text in, result out. One YAML document only; duplicate keys and syntax errors are errors.
export function parseConfig(text: string): Result<Config> {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return { ok: false, errors: doc.errors.map(yamlError) };
  if (doc.contents === null) return fail("file is empty");
  return validateConfig(doc.toJS());
}

export function readConfig(file: string): Result<Config> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (e) {
    return fail(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); // also strips a BOM
  } catch {
    return fail("file is not valid UTF-8");
  }
  return parseConfig(text);
}
