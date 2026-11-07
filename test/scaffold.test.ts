import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

// Inherited from config-schema. Finding: under NodeNext `import Ajv from "ajv"` does NOT type-check (not constructable); the named `import { Ajv } from "ajv"` does, at runtime and when bundled.
describe("Ajv under NodeNext", () => {
  it("type-checks (this file is part of `npm run typecheck`) and compiles a draft-07 schema", () => {
    const ajv = new Ajv({ allErrors: true, strict: true });
    const validate = ajv.compile({ type: "object", required: ["a"], additionalProperties: false, properties: { a: { type: "string" } } });
    expect(validate({ a: "x" })).toBe(true);
    expect(validate({ a: 1 })).toBe(false);
    expect(validate({ a: "x", b: 1 })).toBe(false);
  });

  it("bundles with esbuild into one ESM file that runs with no node_modules", async () => {
    const out = await build({
      stdin: { contents: 'import { Ajv } from "ajv"; console.log(typeof new Ajv().compile({type:"string"}));', resolveDir: process.cwd() },
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      logLevel: "silent",
    });
    const code = out.outputFiles[0]!.text;
    const r = spawnSync(process.execPath, ["--input-type=module"], { input: code, encoding: "utf8", cwd: "/" });
    expect(r.stderr).toBe("");
    expect(r.stdout.trim()).toBe("function");
  });
});
