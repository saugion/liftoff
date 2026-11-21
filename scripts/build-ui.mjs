import { chmodSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { packageVersionOnly } from "./version-only.mjs";

// The control panel is its own bundle: the CLI (src/, dist/liftoff.mjs) stays free of any network module, and
// test/ui-guard.test.ts holds this one to "node:http, on 127.0.0.1, nothing else".
export async function buildUi(outfile = "dist/liftoff-ui.mjs") {
  await build({
    entryPoints: ["ui/bin.ts"],
    outfile,
    plugins: [packageVersionOnly],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    loader: { ".html": "text" },
    banner: { js: '#!/usr/bin/env node\nimport { createRequire as __liftoffCreateRequire } from "node:module";\nconst require = __liftoffCreateRequire(import.meta.url);' },
    logLevel: "warning",
  });
  chmodSync(outfile, 0o755);
  return outfile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(await buildUi());
