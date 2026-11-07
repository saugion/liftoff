import { escapePointer } from "./schema.js";
import type { ConfigError } from "./types.js";

// Guard against accidents, not a guarantee: say so in every message.
const NOTE = "Credentials never go in liftoff.yaml (this check catches accidents; it is not a guarantee).";

// Keys: lowercase, strip "_" and "-", then exact match. "tokenizer" and "authorEmail" pass.
const SECRET_KEYS = new Set(["token", "password", "passwd", "secret", "apikey", "privatekey", "auth", "pat"]);
const normalizeKey = (k: string) => k.toLowerCase().replace(/[_-]/g, "");

// Values: a URL with a password (https://user:pass@host), or a known token prefix followed by token-like
// characters (so "xoxo-app" or a bare "ghp_" in prose pass).
const URL_WITH_PASSWORD = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]*@/i;
// Slack tokens (xoxb-, xoxp-, ...) must contain a digit: "xoxo-tokenizer" is just a name.
const TOKEN = /\b(?:(?:ghp_|github_pat_|glpat-|lin_api_)[A-Za-z0-9_-]{8,}|xox[abeprs]-(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{8,})/;

export function secretGuard(raw: unknown): ConfigError[] {
  const errors: ConfigError[] = [];
  const walk = (value: unknown, pointer: string): void => {
    if (typeof value === "string") {
      if (TOKEN.test(value) || URL_WITH_PASSWORD.test(value)) {
        errors.push({ path: pointer, message: `value looks like a credential. ${NOTE}` });
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${pointer}/${i}`));
    } else if (value !== null && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        const child = `${pointer}/${escapePointer(key)}`;
        if (SECRET_KEYS.has(normalizeKey(key))) errors.push({ path: child, message: `key '${key}' looks like a credential. ${NOTE}` });
        walk(item, child);
      }
    }
  };
  walk(raw, "");
  return errors;
}
