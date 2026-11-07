import { run } from "./main.js";

const result = run(process.argv.slice(2), process.cwd());
process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
