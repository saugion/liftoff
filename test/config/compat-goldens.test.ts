import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configHash, readConfig, sectionHashes } from "../../src/config/index.js";

const DIR = join(import.meta.dirname, "..", "fixtures", "config", "valid");
const GOLDEN = join(import.meta.dirname, "..", "fixtures", "config", "v1-hashes.json");

const actual = () =>
  Object.fromEntries(
    readdirSync(DIR)
      .filter((f) => f.endsWith(".yaml") && !f.startsWith("connect-"))
      .sort()
      .map((f) => {
        const r = readConfig(join(DIR, f));
        if (!r.ok) throw new Error(`${f}: ${JSON.stringify(r.errors)}`);
        return [f, { sections: sectionHashes(r.value), config: configHash(r.value) }];
      }),
  );

describe("v1 hashes stay stable", () => {
  if (process.env.UPDATE_GOLDEN) writeFileSync(GOLDEN, JSON.stringify(actual(), null, 2) + "\n");
  it("every v1 fixture keeps the hashes recorded with v0.1.0 code", () => {
    expect(actual()).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
  });
});
