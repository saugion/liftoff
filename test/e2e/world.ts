// The end-to-end world: a real git repo with a bare remote, the shipped CLI bundle, a fake Jira (HTTPS, Bearer
// token, HTML renderedFields, a small workflow), fake uvx / glab / security on PATH, and a stdio MCP client.
// Everything is written under LIFTOFF_E2E_DIR when set (so a human can inspect it), else under the OS temp dir.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import https from "node:https";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { tempDir } from "../helpers.js";

export const ROOT = join(import.meta.dirname, "..", "..");
export const BUNDLE = join(ROOT, "plugin", "bin", "liftoff.mjs");
export const FAKES = join(import.meta.dirname, "fakes");
export const TOKEN = "e2e-PAT-3f9a7c1d-do-not-leak";

export function runDir(name: string): string {
  const base = process.env.LIFTOFF_E2E_DIR;
  if (!base) return tempDir(`liftoff-e2e-${name}-`);
  const dir = join(base, `${new Date().toISOString().replace(/[:.]/g, "-")}-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const PATH_WITH_FAKES = `${FAKES}:${dirname(process.execPath)}:/usr/bin:/bin`;
export const baseEnv = (home: string, extra: Record<string, string> = {}) => ({ PATH: PATH_WITH_FAKES, HOME: home, ...extra });

export function sh(cmd: string, cwd: string, env: Record<string, string>) {
  const r = spawnSync("sh", ["-c", cmd], { cwd, env, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function liftoff(cwd: string, args: string[]) {
  const r = spawnSync(process.execPath, [BUNDLE, ...args, "--root", cwd], { cwd, encoding: "utf8" });
  let body: Record<string, any> = {};
  try { body = JSON.parse(r.stdout); } catch { /* not JSON: the test fails on stderr */ }
  return { status: r.status, body, stderr: r.stderr };
}

export function git(cwd: string, ...args: string[]) {
  const env = { PATH: PATH_WITH_FAKES, HOME: cwd, GIT_AUTHOR_NAME: "Eng", GIT_AUTHOR_EMAIL: "eng@example.com", GIT_COMMITTER_NAME: "Eng", GIT_COMMITTER_EMAIL: "eng@example.com", GIT_CONFIG_NOSYSTEM: "1" };
  const r = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

export function write(root: string, rel: string, content: string) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

// Every file under a directory except .git internals, as [relative path, text].
export function textFiles(dir: string, rel = ""): [string, string][] {
  return readdirSync(join(dir, rel)).flatMap((n) => {
    if (n === ".git" || n === "remote.git") return [];
    const p = join(rel, n);
    return statSync(join(dir, p)).isDirectory() ? textFiles(dir, p) : [[p, readFileSync(join(dir, p), "utf8")] as [string, string]];
  });
}

// ---- fake Jira DC -----------------------------------------------------------------------------------------------
type Issue = { key: string; fields: Record<string, unknown>; renderedFields: { description: string } };
const issue = (key: string, type: string, summary: string, description: string, html: string, extra: Record<string, unknown> = {}): Issue => ({
  key,
  fields: { summary, issuetype: { name: type }, status: { name: "To Do" }, description, ...extra },
  renderedFields: { description: html },
});
export const ISSUES = (): Issue[] => [
  issue("PROJ-123", "Story", "Add login", "As a user I want to log in.\n\nh2. Acceptance criteria\n* valid credentials open the dashboard\n* a wrong password is refused\n\nh2. Notes\nsee design", "<p>As a user I want to log in.</p><h2>Acceptance criteria</h2><ul><li>valid credentials open the dashboard</li><li>a wrong password is refused</li></ul><h2>Notes</h2><p>see design</p>", { customfield_10016: 5 }),
  issue("PROJ-124", "Bug", "Crash on empty cart", "The app crashes when the cart is empty.", "<p>The app crashes when the cart is empty.</p>", { customfield_10201: "no crash on an empty cart; a message is shown" }),
  issue("PROJ-125", "Epic", "Payments", "", ""),
  issue("STR-1", "Epic", "Checkout MVP", "Ship a checkout in 4 weeks.", "<p>Ship a checkout in 4 weeks.</p>", { status: { name: "Backlog" } }),
];
const SPRINT_FLOW: Record<string, [string, string][]> = { "To Do": [["Start progress", "In Progress"]], "In Progress": [["Ready for review", "In Review"], ["Stop progress", "To Do"]], "In Review": [] };
// The Kanban stream project has its own workflow: other state and transition names.
const KANBAN_FLOW: Record<string, [string, string][]> = { Backlog: [["Work on it", "Doing"]], Doing: [["Check", "Review"], ["Back to backlog", "Backlog"]], Review: [] };
const flowOf = (key: string) => (key.startsWith("STR-") ? KANBAN_FLOW : SPRINT_FLOW);
const initialStatus = (project: string) => (project === "STR" ? "Backlog" : "To Do");

export interface FakeJira { url: string; requests: { method: string; path: string; auth: string | undefined }[]; issues: Issue[]; close(): Promise<void> }

export async function startJira(dir: string, token = TOKEN): Promise<FakeJira> {
  const key = join(dir, "jira-key.pem"), cert = join(dir, "jira-cert.pem");
  const r = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-subj", "/CN=localhost", "-days", "2"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("openssl failed: " + r.stderr);
  const requests: FakeJira["requests"] = [];
  const issues = ISSUES();
  const server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    const auth = req.headers.authorization;
    requests.push({ method: req.method!, path: req.url!, auth });
    const send = (code: number, body: unknown) => (res.writeHead(code, { "Content-Type": "application/json" }), res.end(JSON.stringify(body)));
    if (auth !== `Bearer ${token}`) return send(401, { errorMessages: ["unauthorized"] });
    const url = new URL(req.url!, "https://x");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (url.pathname === "/rest/api/2/search") {
        const project = /project\s*=\s*"?([A-Z0-9_]+)"?/.exec(url.searchParams.get("jql") ?? "")?.[1];
        const hits = issues.filter((i) => !project || i.key.startsWith(project + "-"));
        return send(200, { total: hits.length, issues: hits });
      }
      if (url.pathname === "/rest/api/2/issue" && req.method === "POST") {
        const f = JSON.parse(body).fields as Record<string, any>;
        const project = f.project?.key as string;
        const n = issues.filter((i) => i.key.startsWith(project + "-")).length + 1;
        const { project: _p, issuetype, ...rest } = f;
        const created = issue(`${project}-${n}`, issuetype.name, rest.summary, rest.description ?? "", `<p>${rest.description ?? ""}</p>`, { ...rest, status: { name: initialStatus(project) } });
        issues.push(created);
        return send(201, { id: String(1000 + n), key: created.key });
      }
      const m = /^\/rest\/api\/2\/issue\/([A-Z0-9_-]+)(\/transitions)?$/.exec(url.pathname);
      const found = m && issues.find((i) => i.key === m[1]);
      if (!found) return send(404, { errorMessages: ["Issue does not exist"] });
      if (req.method === "PUT" && !m![2]) { Object.assign(found.fields, JSON.parse(body).fields); return send(204, {}); }
      const status = (found.fields.status as { name: string }).name;
      const flow = flowOf(found.key);
      if (!m![2]) return send(200, found);
      if (req.method === "GET") return send(200, { transitions: (flow[status] ?? []).map(([name], i) => ({ id: String(i + 1), name })) });
      const want = JSON.parse(body).transition?.name as string;
      const hit = (flow[status] ?? []).find(([name]) => name.toLowerCase() === want?.toLowerCase());
      if (!hit) return send(400, { errorMessages: [`transition '${want}' is not available from '${status}'`] });
      found.fields.status = { name: hit[1] };
      send(204, {});
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return { url: `https://127.0.0.1:${port}`, requests, issues, close: () => new Promise((ok) => (server.closeAllConnections(), server.close(() => ok()))) };
}

// ---- stdio MCP client -------------------------------------------------------------------------------------------
export class McpClient {
  private id = 0;
  private waiting = new Map<number, (m: any) => void>();
  stderr = "";
  exited: Promise<number | null>;
  constructor(readonly proc: ChildProcess) {
    createInterface({ input: proc.stdout! }).on("line", (l) => { const m = JSON.parse(l); this.waiting.get(m.id)?.(m); });
    proc.stderr!.on("data", (d) => (this.stderr += d));
    this.exited = new Promise((ok) => proc.on("exit", (c) => ok(c)));
  }
  static start(entry: { command: string; args: string[]; env?: Record<string, string> }, cwd: string, env: Record<string, string>) {
    return new McpClient(spawn(entry.command, entry.args, { cwd, env: { ...env, ...entry.env }, stdio: ["pipe", "pipe", "pipe"] }));
  }
  request(method: string, params: object = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error(`MCP timeout on ${method}; stderr: ${this.stderr}`)), 20_000);
      this.waiting.set(id, (m) => (clearTimeout(t), ok(m)));
      this.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  async init() {
    const r = await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
    this.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return r;
  }
  async tools(): Promise<string[]> { return (await this.request("tools/list")).result.tools.map((t: any) => t.name).sort(); }
  async call(name: string, args: object = {}): Promise<{ isError: boolean; text: string; json: any }> {
    const r = (await this.request("tools/call", { name, arguments: args })).result;
    const text = r.content[0].text as string;
    let json: any; try { json = JSON.parse(text); } catch { /* an error message */ }
    return { isError: !!r.isError, text, json };
  }
  close() { this.proc.stdin!.end(); this.proc.kill(); }
}
