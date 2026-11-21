// Not part of `npm test`. Prepares a workspace for a real agent to run the skills against: a fake Jira that stays up,
// a repo that already ran Init and has the Jira entry wired (the machine is "connected"), and `bin/jira-tool`, a shell
// command that stands in for the MCP tools (a sub-agent has no MCP attached; the command starts the same generated
// MCP entry the way a host does). Prints one JSON line {jira, repo, bin}. Usage: node setup.mjs <dir> [jira-only|blank|brain|lessons]
// `brain`: the full fake Jira (PROJ-123..126, STR-1), a repo whose liftoff.yaml has `brain:` and the learned issue types,
// a bare `origin` with main pushed, and one ingested ticket (PROJ-124) so the wiki is not empty. PROJ-126 carries text
// that tries to instruct the agent. `lessons`: the same plus `brain.lessons: {}` and one personal lesson at count 1
// (a test-command correction made on PROJ-124), so one more correction on another ticket makes it ready.
import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { baseEnv, git, liftoff, startJira, write, FAKES, ROOT } from "../e2e/world.js";
import { config } from "../e2e/config.js";

const dir = process.argv[2]!;
const LEAD_TOKEN = "agent-run-PAT-do-not-leak";
const blank = process.argv[3] === "blank"; // the full fake Jira (PROJ-123..126, STR-1) and nothing else: no repo, a person starts from zero
const jiraOnly = process.argv[3] === "jira-only" || blank; // restart the fake Jira (same port, empty) without touching the workspace
const lessons = process.argv[3] === "lessons";
const brain = process.argv[3] === "brain" || lessons;
const jira = await startJira(dir, [LEAD_TOKEN], { fresh: !brain && !blank, ...(process.env.FAKE_JIRA_PORT && { port: Number(process.env.FAKE_JIRA_PORT) }) });
if (jiraOnly) { console.log(JSON.stringify({ jira: jira.url })); setInterval(() => writeFileSync(join(dir, "jira-state.json"), JSON.stringify({ requests: jira.requests.length, issues: jira.issues }, null, 2)), 1000); await new Promise(() => {}); }
const repo = join(dir, "app");
// Init'ed, with the tracker linked but no issue type learned yet (that is the lead flow's job)
const cfg = brain
  ? config(jira.url).replace('version: "0.2"', 'version: "0.4"') + (lessons ? "brain:\n  lessons: {}\n" : "brain: {}\n")
  : config(jira.url).replace(/  issueTypes:[\s\S]*?codeHost:/, "codeHost:").replace('version: "0.2"', 'version: "0.3"');
write(repo, "liftoff.yaml", cfg.replace("agents: { targets: [claude-code, copilot] }", "agents: { targets: [claude-code] }"));
write(repo, "AGENTS.md", "# app\nRun `sh check.sh` before every commit.\n");
write(repo, "backend/AGENTS.md", "# backend\n");
write(repo, "CONSTRAINTS.md", "# Constraints\n");
git(dir, "init", "-q", "-b", "main", repo);
if (liftoff(repo, ["render"]).status !== 0) throw new Error("render failed");
const info = liftoff(repo, ["connect-info"]).body;
write(repo, ".mcp.json", JSON.stringify({ mcpServers: { [info.mcp[0].server]: info.mcp[0].entry } }, null, 2) + "\n");
write(repo, ".liftoff/.gitignore", "*\n");
if (brain) {
  const ok = (r: { status: number | null; stderr: string }) => { if (r.status !== 0) throw new Error(`brain setup failed: ${r.stderr}`); };
  write(repo, "check.sh", "#!/bin/sh\ngrep -q . backend/login.txt\n");
  write(repo, ".gitlab/merge_request_templates/Default.md", "## What\n\n## Ticket\n\n## How to test\n");
  ok(liftoff(repo, ["brain-init", "--write"]));
  // one ticket already in the wiki, ingested the way the skills do it
  const issue = jira.issues.find((i) => i.key === "PROJ-124")!;
  write(repo, ".liftoff/tmp/PROJ-124.json", JSON.stringify(issue));
  const src = liftoff(repo, ["brain-source", "--kind", "ticket", "--file", ".liftoff/tmp/PROJ-124.json", "--write"]);
  ok(src);
  const raw = (src.body.path as string).replace(/^brain\//, "");
  write(repo, "brain/wiki/learnings/empty-cart.md", `---\ntitle: Empty cart\ntype: learning\nupdated: 2026-11-19\nsummary: The app must not crash on an empty cart.\nsources: [${raw}]\n---\n# Empty cart\n\nWhat the team expects when the cart is empty.\n\n> no crash on an empty cart; a message is shown\n> -- [PROJ-124](../../${raw})\n`);
  write(repo, "brain/log/2026-11.md", `- 2026-11-19 ingest ${raw}: wiki/learnings/empty-cart.md\n`);
  write(repo, "brain/hot.md", "# Hot\n\n- Now: nothing in progress\n- Changed last: empty cart behaviour (PROJ-124)\n");
  ok(liftoff(repo, ["brain-index", "--write"]));
  const check = liftoff(repo, ["brain-check"]);
  if (check.status !== 0) throw new Error(`the baseline brain is not ok: ${JSON.stringify(check.body.errors)}`);
  if (lessons) {
    write(repo, ".liftoff/tmp/lesson.json", JSON.stringify({ key: "api-test-command", rule: "Run the API tests with `make test-api`, not `npm test` at the root.", kind: "command", target: "agents-md", skill: "build", ticket: "PROJ-124", evidence: "no, in this repo the API tests run with make test-api" }));
    const added = liftoff(repo, ["lesson-add", "--file", ".liftoff/tmp/lesson.json", "--write"]);
    ok(added);
    if (added.body.count !== 1 || added.body.ready) throw new Error(`the baseline lesson should be at count 1: ${JSON.stringify(added.body)}`);
    const checked = liftoff(repo, ["brain-check"]);
    if (checked.status !== 0) throw new Error(`the baseline with a lesson is not ok: ${JSON.stringify(checked.body.errors)}`);
  }
}
git(repo, "add", "-A"); git(repo, "commit", "-qm", "init");
if (brain) { git(dir, "init", "-q", "--bare", "-b", "main", join(dir, "remote.git")); git(repo, "remote", "add", "origin", join(dir, "remote.git")); git(repo, "push", "-q", "-u", "origin", "main"); }

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
console.log(JSON.stringify({ jira: jira.url, repo, bin: join(dir, "bin/jira-tool"), plugin: join(ROOT, "plugin"), ...(brain && { lessons, origin: join(dir, "remote.git") }) }));
// stay up until killed; dump the Jira state on demand so a human or the harness can inspect it
setInterval(() => writeFileSync(join(dir, "jira-state.json"), JSON.stringify({ requests: jira.requests.length, issues: jira.issues }, null, 2)), 1000);
void FAKES;
