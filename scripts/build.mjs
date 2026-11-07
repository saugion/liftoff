import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const SKILL_SCRIPT = "plugin/skills/liftoff-init/scripts/liftoff.mjs";
const ENTRY_FRAGMENT = "plugin/skills/liftoff-init/assets/marketplace-entry.json";

// src/cli/version.ts imports package.json for its version. Embed the version only: not the scripts and the
// devDependencies, and not a stale artifact every time someone edits an unrelated line of package.json.
const packageVersionOnly = {
  name: "package-version-only",
  setup(b) {
    const file = resolve("package.json");
    b.onLoad({ filter: /package\.json$/ }, (args) => {
      if (args.path !== file) return undefined;
      return { contents: JSON.stringify({ version: JSON.parse(readFileSync(file, "utf8")).version }), loader: "json" };
    });
  },
};

// One self-contained ESM file: no node_modules needed at runtime (the plugin ships no install step).
async function bundle(outfile) {
  const result = await build({
    entryPoints: ["src/cli/bin.ts"],
    outfile,
    plugins: [packageVersionOnly],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    // CJS dependencies (yaml, ajv) call require() on node builtins; an ESM bundle needs a real require.
    banner: {
      js: '#!/usr/bin/env node\nimport { createRequire as __liftoffCreateRequire } from "node:module";\nconst require = __liftoffCreateRequire(import.meta.url);',
    },
    legalComments: "eof",
    metafile: true,
    logLevel: "warning",
  });
  chmodSync(outfile, 0o755);
  return result.metafile;
}

export async function buildBundle(outfile = "dist/liftoff.mjs") {
  await bundle(outfile);
  return outfile;
}

// Names of the npm packages that ended up inside the bundle, from esbuild's metafile. Sorted.
export function bundledPackages(metafile) {
  const names = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const at = input.lastIndexOf("node_modules/");
    if (at === -1) continue;
    const [first, second] = input.slice(at + "node_modules/".length).split("/");
    names.add(first.startsWith("@") ? `${first}/${second}` : first);
  }
  return [...names].sort();
}

// Redistributing a bundle means shipping the notices of what is in it (yaml: ISC, ajv and friends: MIT, BSD-3).
export function thirdPartyNotices(packages) {
  const sections = packages.map((name) => {
    const dir = join("node_modules", name);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const file = readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
    const text = file ? readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n").trim() : "(this package ships no license file)";
    return `## ${name}@${pkg.version} (${pkg.license})\n\n${text}\n`;
  });
  return `Third-party software bundled into scripts/liftoff.mjs.\n\n${sections.join("\n")}`;
}

// The fragment `liftoff-init` copies into a repo's .claude/settings.json. The ref is the release tag.
export function marketplaceEntry(version) {
  return {
    extraKnownMarketplaces: { liftoff: { source: { source: "github", repo: "saugion/liftoff", ref: `v${version}` } } },
    enabledPlugins: { "liftoff@liftoff": true },
  };
}

const json = (value) => JSON.stringify(value, null, 2) + "\n";
const write = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

// Everything that is generated into plugin/ (a plugin installed from git runs no build, so these are committed).
// Run from the repo root.
export async function buildPlugin() {
  if (!existsSync("package.json")) throw new Error("run the build from the repo root");
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const manifest = JSON.parse(readFileSync("plugin/.claude-plugin/plugin.json", "utf8"));
  if (manifest.version !== version) {
    throw new Error(`plugin.json version ${manifest.version} differs from package.json ${version}: bump both together`);
  }

  const metafile = await bundle("dist/liftoff.mjs");
  mkdirSync(dirname(SKILL_SCRIPT), { recursive: true });
  copyFileSync("dist/liftoff.mjs", SKILL_SCRIPT);
  chmodSync(SKILL_SCRIPT, 0o755);
  copyFileSync("LICENSE", "plugin/LICENSE");
  write("plugin/THIRD_PARTY_NOTICES", thirdPartyNotices(bundledPackages(metafile)));
  write(ENTRY_FRAGMENT, json(marketplaceEntry(version)));
  return { version, packages: bundledPackages(metafile) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version, packages } = await buildPlugin();
  console.log(`liftoff ${version}: ${SKILL_SCRIPT} (bundles ${packages.join(", ")})`);
}
