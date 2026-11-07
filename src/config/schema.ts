import { Ajv, type ErrorObject } from "ajv";
import schema from "../../schema/liftoff.schema.json" with { type: "json" };
import type { ConfigError } from "./types.js";

// Compiled once. The schema is imported as a JSON module so it is bundled (no runtime file read).
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

export const escapePointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

function toConfigError(e: ErrorObject): ConfigError {
  const { missingProperty, additionalProperty } = e.params as { missingProperty?: string; additionalProperty?: string };
  // Ajv reports missing/extra properties on the parent: point at the property itself.
  const prop = missingProperty ?? additionalProperty;
  const message = additionalProperty !== undefined ? `must NOT have additional property '${additionalProperty}'` : (e.message ?? "invalid");
  return { path: e.instancePath + (prop !== undefined ? "/" + escapePointer(prop) : ""), message };
}

export function schemaErrors(raw: unknown): ConfigError[] {
  return validate(raw) ? [] : (validate.errors ?? []).map(toConfigError);
}
