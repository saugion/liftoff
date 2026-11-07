import { chmodSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// One self-contained ESM file: no node_modules needed at runtime (the plugin ships no install step).
export async function buildBundle(outfile = "dist/liftoff.mjs") {
  await build({
    entryPoints: ["src/cli/bin.ts"],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    banner: { js: "#!/usr/bin/env node" },
    legalComments: "eof",
    logLevel: "warning",
  });
  chmodSync(outfile, 0o755);
  return outfile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await buildBundle());
}
