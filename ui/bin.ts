import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import page from "./page.html";
import wizard from "./wizard.html";
import { startUi } from "./server.js";

const { values } = parseArgs({ options: { root: { type: "string" }, port: { type: "string" }, help: { type: "boolean" } } });
const root = resolve(values.root ?? ".");
if (values.help || !statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  process.stderr.write("liftoff-ui [--root <project dir>] [--port <n>]\nLiftOff's local setup guide and control panel. Listens on 127.0.0.1 only.\n");
  process.exit(values.help ? 0 : 2);
}
// The templates of the Init skill: next to this file in the installed plugin (bin/), in the repo checkout (dist/).
const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = [join(here, "..", "skills", "liftoff-init", "assets"), join(here, "..", "plugin", "skills", "liftoff-init", "assets")].find((d) => existsSync(d));
const ui = await startUi({ root, page, wizard, ...(assetsDir && { assetsDir }), port: values.port ? Number(values.port) : undefined });
process.stdout.write(`LiftOff setup for ${root}\nOpen: ${ui.url}\nPress Ctrl+C to stop. Your draft is kept.\n`);
