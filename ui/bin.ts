import { statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import page from "./page.html";
import { startUi } from "./server.js";

const { values } = parseArgs({ options: { root: { type: "string" }, port: { type: "string" }, help: { type: "boolean" } } });
const root = resolve(values.root ?? ".");
if (values.help || !statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  process.stderr.write("liftoff-ui [--root <project dir>] [--port <n>]\nA local control panel for liftoff.yaml. Listens on 127.0.0.1 only.\n");
  process.exit(values.help ? 0 : 2);
}
const ui = await startUi({ root, page, port: values.port ? Number(values.port) : undefined });
process.stdout.write(`LiftOff control panel for ${root}\nOpen: ${ui.url}\nPress Ctrl+C to stop. Your draft is kept.\n`);
