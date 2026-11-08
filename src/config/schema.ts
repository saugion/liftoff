import { Ajv, type ErrorObject } from "ajv";
import schema from "../../schema/liftoff.schema.json" with { type: "json" };
import type { ConfigError } from "./types.js";

// Compiled once. The schema is imported as a JSON module so it is bundled (no runtime file read).
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

export const escapePointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

function toConfigError(e: ErrorObject): ConfigError {
  const { missingProperty, additionalProperty, propertyName } = e.params as { missingProperty?: string; additionalProperty?: string; propertyName?: string };
  // Ajv reports missing/extra properties on the parent: point at the property itself.
  const prop = missingProperty ?? additionalProperty ?? propertyName;
  const message = additionalProperty !== undefined ? `must NOT have additional property '${additionalProperty}'` : (e.message ?? "invalid");
  return { path: e.instancePath + (prop !== undefined ? "/" + escapePointer(prop) : ""), message };
}

// Ajv wraps the real error of an anyOf / if-then / propertyNames in noise of its own: keep only the real one.
const noise = (e: ErrorObject): boolean =>
  e.keyword === "if" || e.keyword === "anyOf" || e.schemaPath.includes("/anyOf/0/") || (e.keyword === "pattern" && e.schemaPath.includes("/propertyNames/"));

export function schemaErrors(raw: unknown): ConfigError[] {
  return validate(raw) ? [] : (validate.errors ?? []).filter((e) => !noise(e)).map(toConfigError);
}
