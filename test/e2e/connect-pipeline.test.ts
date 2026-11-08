// The Connect wiring end to end: the real CLI bundle produces the MCP entry, the entry is started the way an MCP
// host starts it (command, args, env), the launcher resolves the token, and a fake mcp-atlassian talks to a fake
// Jira over HTTPS. Checks what only a whole run can: the token reaches Jira, and appears nowhere else.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { type FakeJira, McpClient, TOKEN, baseEnv, git, liftoff, runDir, sh, startJira, textFiles, write } from "./world.js";

const TOOLS = ["jira_add_comment", "jira_create_issue", "jira_get_create_fields", "jira_get_field_options", "jira_get_issue", "jira_get_project_issue_types", "jira_get_project_issues",
  "jira_get_transitions", "jira_search", "jira_search_fields", "jira_transition_issue", "jira_update_issue"];
const WRITES = ["jira_add_comment", "jira_create_issue", "jira_transition_issue", "jira_update_issue"];

let jira: FakeJira;
let dir: string;
const clients: McpClient[] = [];
beforeAll(async () => { dir = runDir("connect-pipeline"); jira = await startJira(dir); });
afterAll(async () => { clients.forEach((c) => c.close()); await jira.close(); });

function repo(name: string, opts: { readOnly?: boolean } = {}) {
  const root = join(dir, name);
  write(root, "liftoff.yaml", config(jira.url, opts));
  git(dir, "init", "-q", "-b", "main", root);
  const info = liftoff(root, ["connect-info"]);
  expect(info.status, info.stderr + JSON.stringify(info.body)).toBe(0);
  return { root, info: info.body };
}
const start = (root: string, entry: any, env: Record<string, string>) => {
  const c = McpClient.start(entry, root, baseEnv(root, env));
  clients.push(c);
  return c;
};

describe("a token in the environment", () => {
  it("reaches Jira as a Bearer header, through both agents' entries, and the server exposes exactly the allowlist", async () => {
    const { root, info } = repo("env-token");
    expect(info.mcp.map((m: any) => m.agent)).toEqual(["claude-code", "copilot"]);
    for (const m of info.mcp) {
      write(root, m.file, JSON.stringify({ [m.serversKey]: { [m.server]: m.entry } }, null, 2));
      const entry = JSON.parse(readFileSync(join(root, m.file), "utf8"))[m.serversKey][m.server]; // as the host reads it back
      const c = start(root, entry, { LIFTOFF_JIRA_TOKEN: TOKEN });
      expect((await c.init()).result.serverInfo.name).toBe("fake-mcp-atlassian");
      expect(await c.tools()).toEqual(TOOLS);
      const got = await c.call("jira_get_issue", { issue_key: "PROJ-123" });
      expect(got.isError, got.text).toBe(false);
      expect(got.json.key).toBe("PROJ-123");
      expect(got.json.renderedFields.description).toContain("<h2>Acceptance criteria</h2>");
      // the process list shows the package and --env-file /dev/null, never the token
      const ps = spawnSync("ps", ["-ww", "-o", "command=", "-p", String(c.proc.pid)], { encoding: "utf8" }).stdout;
      expect(ps).toContain("mcp-atlassian@0.23.1 --env-file /dev/null");
      expect(ps).not.toContain(TOKEN);
    }
    expect(jira.requests.length).toBeGreaterThanOrEqual(2);
    expect(jira.requests.every((r) => r.auth === `Bearer ${TOKEN}`)).toBe(true);
  });
});

describe("a token in the keychain", () => {
  it("is found when the variable is unset, with the service named after the instance", async () => {
    const { root, info } = repo("keychain-token");
    const log = join(root, "keychain.log");
    const c = start(root, info.mcp[0].entry, { FAKE_KEYCHAIN_TOKEN: TOKEN, FAKE_KEYCHAIN_LOG: log });
    await c.init();
    expect((await c.call("jira_get_issue", { issue_key: "PROJ-124" })).json.key).toBe("PROJ-124");
    expect(readFileSync(log, "utf8")).toContain(`-s liftoff-jira@${new URL(jira.url).host}`);
  });
  it("the variable wins over the keychain", async () => {
    const { root, info } = repo("env-wins");
    const log = join(root, "keychain.log");
    const c = start(root, info.mcp[0].entry, { LIFTOFF_JIRA_TOKEN: TOKEN, FAKE_KEYCHAIN_TOKEN: "other", FAKE_KEYCHAIN_LOG: log });
    await c.init();
    expect((await c.call("jira_get_issue", { issue_key: "PROJ-124" })).isError).toBe(false);
    expect(existsSync(log)).toBe(false);
  });
});

describe("failures a user would meet", () => {
  it("a wrong token is a 401 the agent can read, and the rotation hint is the skill's job", async () => {
    const { root, info } = repo("wrong-token");
    const c = start(root, info.mcp[0].entry, { LIFTOFF_JIRA_TOKEN: "revoked-token" });
    await c.init();
    const r = await c.call("jira_get_issue", { issue_key: "PROJ-123" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/401/);
  });
  it("a project that does not exist is a 404", async () => {
    const { root, info } = repo("no-issue");
    const c = start(root, info.mcp[0].entry, { LIFTOFF_JIRA_TOKEN: TOKEN });
    await c.init();
    const r = await c.call("jira_get_issue", { issue_key: "NOPE-1" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/404/);
  });
  it("no token anywhere: the server exits 1 with the instruction on stderr, and never reaches Jira", async () => {
    const { root, info } = repo("no-token");
    const before = jira.requests.length;
    const c = start(root, info.mcp[0].entry, {});
    expect(await c.exited).toBe(1);
    expect(c.stderr).toMatch(/no Jira token found \(or the keychain is locked\); run the LiftOff Connect skill/);
    expect(jira.requests.length).toBe(before);
  });
  it("read-only: write tools are not exposed", async () => {
    const { root, info } = repo("read-only", { readOnly: true });
    expect(info.mcp[0].entry.env.READ_ONLY_MODE).toBe("true");
    const c = start(root, info.mcp[0].entry, { LIFTOFF_JIRA_TOKEN: TOKEN });
    await c.init();
    expect(await c.tools()).toEqual(TOOLS.filter((t) => !WRITES.includes(t)));
  });
  it("a tool outside the allowlist does not exist for the agent", async () => {
    const { root, info } = repo("allowlist");
    const c = start(root, info.mcp[0].entry, { LIFTOFF_JIRA_TOKEN: TOKEN });
    await c.init();
    expect((await c.request("tools/call", { name: "jira_delete_issue", arguments: { issue_key: "PROJ-123" } })).error.message).toMatch(/unknown tool/);
  });
});

describe("the preflight and the secrets", () => {
  it("preflight succeeds silently with a token and fails with the instruction without one", () => {
    const { root, info } = repo("preflight");
    const ok = sh(info.credential.preflight, root, baseEnv(root, { LIFTOFF_JIRA_TOKEN: TOKEN }));
    expect(ok).toMatchObject({ status: 0, stdout: "", stderr: "" });
    const bad = sh(info.credential.preflight, root, baseEnv(root));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/no Jira token found/);
  });
  it("after all of the above, the token is in no file the runs created", () => {
    for (const [path, text] of textFiles(dir)) expect(text.includes(TOKEN), path).toBe(false);
  });
});
