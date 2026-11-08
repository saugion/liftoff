// Not part of `npm test`. Prepares a workspace for a real agent to run the skills against: a fake Jira that stays up,
// a repo that already ran Init and has the Jira entry wired (the machine is "connected"), and `bin/jira-tool`, a shell
// command that stands in for the MCP tools (a sub-agent has no MCP attached; the command starts the same generated
// MCP entry the way a host does). Prints one JSON line {jira, repo, bin}. Usage: node setup.mjs <dir>
import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { baseEnv, git, liftoff, startJira, write, FAKES, ROOT } from "../e2e/world.js";
import { config } from "../e2e/config.js";

const dir = process.argv[2]!;
const LEAD_TOKEN = "agent-run-PAT-do-not-leak";
const jiraOnly = process.argv[3] === "jira-only"; // restart the fake Jira (same port, empty) without touching the workspace
const jira = await startJira(dir, [LEAD_TOKEN], { fresh: true, ...(process.env.FAKE_JIRA_PORT && { port: Number(process.env.FAKE_JIRA_PORT) }) });
if (jiraOnly) { console.log(JSON.stringify({ jira: jira.url })); setInterval(() => writeFileSync(join(dir, "jira-state.json"), JSON.stringify({ requests: jira.requests.length, issues: jira.issues }, null, 2)), 1000); await new Promise(() => {}); }
const repo = join(dir, "app");
// Init'ed, with the tracker linked but no issue type learned yet (that is the lead flow's job)
const cfg = config(jira.url).replace(/  issueTypes:[\s\S]*?codeHost:/, "codeHost:").replace('version: "0.2"', 'version: "0.3"');
write(repo, "liftoff.yaml", cfg.replace("agents: { targets: [claude-code, copilot] }", "agents: { targets: [claude-code] }"));
write(repo, "AGENTS.md", "# app\nRun `sh check.sh` before every commit.\n");
write(repo, "backend/AGENTS.md", "# backend\n");
write(repo, "CONSTRAINTS.md", "# Constraints\n");
git(dir, "init", "-q", "-b", "main", repo);
if (liftoff(repo, ["render"]).status !== 0) throw new Error("render failed");
const info = liftoff(repo, ["connect-info"]).body;
write(repo, ".mcp.json", JSON.stringify({ mcpServers: { [info.mcp[0].server]: info.mcp[0].entry } }, null, 2) + "\n");
write(repo, ".liftoff/.gitignore", "*\n");
git(repo, "add", "-A"); git(repo, "commit", "-qm", "init");

const env = baseEnv(dir, { LIFTOFF_JIRA_TOKEN: LEAD_TOKEN });
const shim = `import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const [tool, json = "{}"] = process.argv.slice(2);
const entry = JSON.parse(readFileSync(process.env.JIRA_TOOL_MCP, "utf8")).mcpServers["liftoff-jira"];
const p = spawn(entry.command, entry.args, { cwd: process.env.JIRA_TOOL_CWD, env: { ...JSON.parse(process.env.JIRA_TOOL_ENV), ...entry.env }, stdio: ["pipe", "pipe", "inherit"] });
const waiting = new Map(); let id = 0;
createInterface({ input: p.stdout }).on("line", (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
const req = (method, params) => new Promise((ok) => { const i = ++id; waiting.set(i, ok); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\\n"); });
await req("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "jira-tool", version: "0" } });
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\\n");
const r = tool === "--list" ? await req("tools/list", {}) : await req("tools/call", { name: tool, arguments: JSON.parse(json.startsWith("@") ? readFileSync(json.slice(1), "utf8") : json) });
p.kill();
if (r.error) { console.error(r.error.message); process.exit(1); }
if (tool === "--list") console.log(r.result.tools.map((t) => t.name).join("\\n"));
else { console.log(r.result.content[0].text); if (r.result.isError) process.exit(1); }
`;
write(dir, "bin/jira-tool.mjs", shim);
const wrapper = `#!/bin/sh
# Stand-in for the Jira MCP tools. Usage: jira-tool <tool_name> '<json arguments>'   |   jira-tool --list
export NODE_NO_WARNINGS=1 JIRA_TOOL_MCP=${JSON.stringify(join(repo, ".mcp.json"))} JIRA_TOOL_CWD=${JSON.stringify(repo)}
export JIRA_TOOL_ENV='${JSON.stringify(env).replace(/'/g, "'\\''")}'
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(dir, "bin/jira-tool.mjs"))} "$@"
`;
write(dir, "bin/jira-tool", wrapper);
chmodSync(join(dir, "bin/jira-tool"), 0o755);
writeFileSync(join(dir, "jira-state.json"), "{}");
console.log(JSON.stringify({ jira: jira.url, repo, bin: join(dir, "bin/jira-tool"), plugin: join(ROOT, "plugin") }));
// stay up until killed; dump the Jira state on demand so a human or the harness can inspect it
setInterval(() => writeFileSync(join(dir, "jira-state.json"), JSON.stringify({ requests: jira.requests.length, issues: jira.issues }, null, 2)), 1000);
void FAKES;
