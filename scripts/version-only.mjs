import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// src/cli/version.ts imports package.json for its version. Embed the version only: not the scripts and the
// devDependencies, and not a stale artifact every time someone edits an unrelated line of package.json.
export const packageVersionOnly = {
  name: "package-version-only",
  setup(b) {
    const file = resolve("package.json");
    b.onLoad({ filter: /package\.json$/ }, (args) => {
      if (args.path !== file) return undefined;
      return { contents: JSON.stringify({ version: JSON.parse(readFileSync(file, "utf8")).version }), loader: "json" };
    });
  },
};
