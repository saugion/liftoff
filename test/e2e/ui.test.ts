import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startUi, type UiServer } from "../../ui/server.js";
import { tempDir } from "../helpers.js";

const YAML = `# team config, keep this comment
liftoff: 1
plugin:
  version: "0.4"
project:
  name: demo
  kind: existing
agents:
  targets: [claude-code]
tracker:
  kind: jira-dc
  url: https://jira.example.com
  project: DEMO
  server:
    version: 9.12.4
  issueTypes:
    - name: Bug
      template: "## Steps to reproduce"
`;

let root: string, ui: UiServer, base: string, token: string;
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(base + path, { method, headers: { "x-liftoff-token": token, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};

beforeAll(async () => {
  root = tempDir("liftoff-ui-");
  writeFileSync(join(root, "liftoff.yaml"), YAML);
  writeFileSync(join(root, "AGENTS.md"), "# demo\n");
  ui = await startUi({ root, page: readFileSync("ui/page.html", "utf8") });
  const u = new URL(ui.url);
  base = u.origin;
  token = u.searchParams.get("t")!;
});
afterAll(() => ui.close());

describe("access", () => {
  it("listens on 127.0.0.1 and serves the page only with the token, with a strict CSP", async () => {
    expect(ui.url.startsWith("http://127.0.0.1:")).toBe(true);
    expect((await fetch(base + "/")).status).toBe(403);
    const ok = await fetch(ui.url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await ok.text()).not.toContain("__TOKEN__");
  });

  it("refuses an API call without the token, and a foreign Host header (DNS rebinding)", async () => {
    expect((await fetch(base + "/api/state")).status).toBe(403);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: new URL(base).port, path: "/api/state", headers: { host: "evil.example.com", "x-liftoff-token": token } }, (res) => resolve(res.statusCode ?? 0));
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("refuses a write that is not JSON (a form post from another site)", async () => {
    const r = await fetch(base + "/api/validate", { method: "POST", headers: { "x-liftoff-token": token, "content-type": "text/plain" }, body: "{}" });
    expect(r.status).toBe(415);
  });
});

describe("state, validate, draft", () => {
  it("reads the saved config", async () => {
    const { body } = await call("GET", "/api/state");
    expect(body).toMatchObject({ exists: true, errors: [], config: { project: { name: "demo" } }, draft: null });
    expect(body.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("validates with the real validator and previews the exact yaml, nothing written", async () => {
    const bad = await call("POST", "/api/validate", { patch: { tracker: { server: { version: "nine" } } } });
    expect(bad.body.errors[0].path).toBe("/tracker/server/version");
    const good = await call("POST", "/api/validate", { patch: { project: { name: "renamed" } } });
    expect(good.body.errors).toEqual([]);
    expect(good.body.yaml).toContain("name: renamed");
    expect(good.body.yaml).toContain("# team config, keep this comment");
    expect(readFileSync(join(root, "liftoff.yaml"), "utf8")).toBe(YAML);
  });

  it("keeps a draft on disk, outside git, and gives it back", async () => {
    await call("PUT", "/api/draft", { form: { name: "x" }, step: 3, baseHash: "h" });
    expect(readFileSync(join(root, ".liftoff", ".gitignore"), "utf8")).toBe("*\n");
    const { body } = await call("GET", "/api/state");
    expect(body.draft).toMatchObject({ form: { name: "x" }, step: 3 });
  });
});

describe("apply", () => {
  it("is refused when the file changed since the page loaded", async () => {
    const r = await call("POST", "/api/apply", { patch: { project: { name: "z" } }, baseHash: "stale" });
    expect(r.status).toBe(409);
    expect(readFileSync(join(root, "liftoff.yaml"), "utf8")).toBe(YAML);
  });

  it("refuses an invalid result and writes nothing", async () => {
    const { body: s } = await call("GET", "/api/state");
    const r = await call("POST", "/api/apply", { patch: { project: { kind: "nope" } }, baseHash: s.hash });
    expect(r.status).toBe(422);
    expect(readFileSync(join(root, "liftoff.yaml"), "utf8")).toBe(YAML);
  });

  it("refuses a constraints file outside the project", async () => {
    const { body: s } = await call("GET", "/api/state");
    const r = await call("POST", "/api/apply", { patch: {}, baseHash: s.hash, constraints: { file: "../escape.md", text: "x" } });
    expect(r.status).toBe(422);
    expect(existsSync(join(root, "..", "escape.md"))).toBe(false);
  });

  it("writes the change, keeps comments and learned fields, writes the constraints file, renders, drops the draft", async () => {
    const { body: s } = await call("GET", "/api/state");
    const first = await call("POST", "/api/apply", { patch: { modules: { items: [{ id: "api", path: "services/api" }] } }, baseHash: s.hash });
    // the config is saved even when render cannot finish: the module folder has no AGENTS.md yet, and the answer says so
    expect(first.body.render).toMatchObject({ ok: false, errors: [{ code: "agents-md-missing", file: "services/api/AGENTS.md" }] });
    mkdirSync(join(root, "services", "api"), { recursive: true });
    writeFileSync(join(root, "services", "api", "AGENTS.md"), "# api\n");
    const { body: s2 } = await call("GET", "/api/state");
    const r = await call("POST", "/api/apply", {
      patch: { project: { name: "renamed" }, tracker: { issueTypes: [{ $was: "Bug", name: "Defect", branchType: "fix" }] } },
      baseHash: s2.hash,
      constraints: { file: "CONSTRAINTS.md", text: "# Constraints\n" },
    });
    expect(r.status).toBe(200);
    expect(r.body.render.ok).toBe(true);
    const text = readFileSync(join(root, "liftoff.yaml"), "utf8");
    expect(text).toContain("# team config, keep this comment");
    expect(text).toContain("name: renamed");
    expect(text).toContain("## Steps to reproduce");
    expect(text).toContain("name: Defect");
    expect(readFileSync(join(root, "CONSTRAINTS.md"), "utf8")).toBe("# Constraints\n");
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(root, ".liftoff", "ui-draft.json"))).toBe(false);
    expect((await call("GET", "/api/state")).body.hash).toBe(r.body.hash);
  });
});

describe("a project with no liftoff.yaml", () => {
  it("previews and creates one from a patch, stamped with the plugin version", async () => {
    const dir = tempDir("liftoff-ui-new-");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "AGENTS.md"), "# new\n");
    const u2 = await startUi({ root: dir, page: "x" });
    const o = new URL(u2.url);
    const hdr = { "x-liftoff-token": o.searchParams.get("t")!, "content-type": "application/json" };
    const patch = { project: { name: "fresh", kind: "new" }, agents: { targets: ["claude-code"] } };
    const prev = await (await fetch(o.origin + "/api/validate", { method: "POST", headers: hdr, body: JSON.stringify({ patch }) })).json() as any;
    expect(prev.errors).toEqual([]);
    expect(prev.yaml).toMatch(/plugin:\n {2}version: "\d+\.\d+"/);
    const res = await fetch(o.origin + "/api/apply", { method: "POST", headers: hdr, body: JSON.stringify({ patch, baseHash: "" }) });
    expect(res.status).toBe(200);
    expect(existsSync(join(dir, "liftoff.yaml"))).toBe(true);
    await u2.close();
  });
});
