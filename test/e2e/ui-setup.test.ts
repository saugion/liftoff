import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateConfig } from "../../src/config/index.js";
import { startUi, type UiServer } from "../../ui/server.js";
import { FAKES, git, liftoff, startJira, runDir, write, ROOT, textFiles, type FakeJira } from "./world.js";

// The guided setup, end to end: a product owner who knows nothing technical, then the technical lead. A real git
// repo with a bare remote, the fake Jira over HTTPS with a certificate nobody trusts, the fake keychain.
const TOKEN = "setup-PAT-9b1d7e42-do-not-leak";
const ASSETS = join(ROOT, "plugin", "skills", "liftoff-init", "assets");
let dir: string, root: string, remote: string, jira: FakeJira, ui: UiServer, base: string, token: string, keychain: string;
const saved = { PATH: process.env.PATH, FAKE_KEYCHAIN_FILE: process.env.FAKE_KEYCHAIN_FILE, LIFTOFF_JIRA_TOKEN: process.env.LIFTOFF_JIRA_TOKEN };

const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { "x-liftoff-token": token, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
const yaml = () => parse(readFileSync(join(root, "liftoff.yaml"), "utf8"));

beforeAll(async () => {
  dir = runDir("ui-setup");
  keychain = join(dir, "keychain");
  process.env.PATH = `${FAKES}:${process.env.PATH}`; // the fake `security` (the real one would touch the developer's keychain)
  process.env.FAKE_KEYCHAIN_FILE = keychain;
  delete process.env.LIFTOFF_JIRA_TOKEN;
  jira = await startJira(dir, [TOKEN], { fresh: false });
  remote = join(dir, "remote.git");
  git(dir, "init", "-q", "--bare", "-b", "main", remote);
  root = join(dir, "my-app");
  git(dir, "init", "-q", "-b", "main", root);
  git(root, "config", "user.email", "po@example.com");
  git(root, "config", "user.name", "Po");
  git(root, "remote", "add", "origin", remote);
  write(root, "README.md", "# my app\n");
  write(root, "backend/package.json", JSON.stringify({ name: "api", scripts: { build: "tsc", test: "vitest" }, devDependencies: { typescript: "5", } }));
  write(root, "frontend/package.json", JSON.stringify({ name: "web", dependencies: { react: "19" } }));
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  git(root, "push", "-q", "-u", "origin", "main");
  write(root, "notes-not-mine.txt", "a colleague's work in progress\n"); // must never be swept into the setup commit
  ui = await startUi({ root, page: "<p>PANEL __TOKEN__</p>", wizard: "<p>WIZARD __TOKEN__</p>", assetsDir: ASSETS });
  const u = new URL(ui.url);
  base = u.origin;
  token = u.searchParams.get("t")!;
});
afterAll(async () => {
  Object.assign(process.env, saved);
  for (const k of ["FAKE_KEYCHAIN_FILE", "LIFTOFF_JIRA_TOKEN"] as const) if (saved[k] === undefined) delete process.env[k];
  await ui.close();
  await jira.close();
});

describe("which page opens", () => {
  it("a project with no liftoff.yaml opens the guided setup, and the full panel stays one link away", async () => {
    expect(await (await fetch(ui.url)).text()).toContain("WIZARD");
    expect(await (await fetch(ui.url + "&view=panel")).text()).toContain("PANEL");
  });
  it("starts at the product owner's part and describes the project from the files", async () => {
    const { body } = await call("GET", "/api/setup");
    expect(body).toMatchObject({ ok: true, stage: "po", exists: false });
    expect(body.detected.modules.map((m: any) => m.id)).toEqual(["backend", "frontend"]);
    expect(body.detected.modules[0]).toMatchObject({ languages: ["TypeScript"], build: "npm run build", test: "npm test" });
    expect(body.detected.git).toMatchObject({ isRepo: true, branch: "main", defaultBranch: "main", originUrl: remote });
    expect(Object.keys(body.templates)).toEqual(["task", "story", "bug", "epic"]);
  });
});

describe("connecting to Jira", () => {
  it("a certificate this computer does not know, on a Jira on this computer, is offered a one-click skip, and nothing is stored", async () => {
    const r = await call("POST", "/api/jira/projects", { url: jira.url, token: TOKEN });
    expect(r.body).toMatchObject({ ok: false, code: "untrusted-local" });
    expect(existsSync(keychain) && readFileSync(keychain, "utf8")).toBeFalsy();
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);
    expect(existsSync(join(root, ".liftoff", "ca"))).toBe(false); // no certificate file is ever written
  });
  it("skipping the check lists the projects the token sees, and keeps the token in the keychain", async () => {
    const r = await call("POST", "/api/jira/projects", { url: jira.url, token: TOKEN, insecure: true });
    expect(r.body).toMatchObject({ ok: true, saved: true });
    expect(r.body.projects).toEqual([{ key: "PROJ", name: "Product" }, { key: "STR", name: "Streams" }]);
    expect(readFileSync(keychain, "utf8").trim()).toBe(TOKEN);
  });
  it("later calls use the keychain, so the page never needs the token again", async () => {
    const t = await call("POST", "/api/jira/types", { url: jira.url, project: "PROJ", insecure: true });
    expect(t.body).toMatchObject({ ok: true, saved: false });
    expect(t.body.issueTypes).toEqual(expect.arrayContaining(["Story", "Task", "Bug", "Epic"]));
    const s = await call("POST", "/api/jira/sample", { url: jira.url, key: "PROJ-123", insecure: true });
    expect(s.body).toMatchObject({ ok: true, headings: ["Acceptance criteria", "Notes"] });
  });
  it("the environment variable works just like the keychain (and wins)", async () => {
    writeFileSync(keychain, "");
    process.env.LIFTOFF_JIRA_TOKEN = TOKEN;
    try {
      expect((await call("POST", "/api/jira/projects", { url: jira.url, insecure: true })).body).toMatchObject({ ok: true });
    } finally {
      delete process.env.LIFTOFF_JIRA_TOKEN;
    }
    expect((await call("POST", "/api/jira/projects", { url: jira.url, token: TOKEN, insecure: true })).body).toMatchObject({ ok: true, saved: true }); // keychain back for the rest
  });
  // that the skip is granted only for a Jira on this computer is tested where it is decided: test/ui/connect-tls.test.ts
  it.each([
    ["a wrong token", { url: "", project: "PROJ", token: "not-the-token-0000" }, "/api/jira/projects", "bad-token"],
    ["an unknown project", { url: "", project: "NOPE", token: TOKEN }, "/api/jira/types", "no-project"],
    ["an address that is not https", { url: "http://jira.example.com", project: "PROJ", token: TOKEN }, "/api/jira/projects", "bad-url"],
    ["a project key that is not a key", { url: "", project: "proj; rm", token: TOKEN }, "/api/jira/types", "bad-url"],
    ["a token with a quote in it", { url: "", project: "PROJ", token: 'abc"def-1234' }, "/api/jira/projects", "bad-token"],
  ])("%s is told in plain words", async (_, input, path, code) => {
    const r = await call("POST", path, { ...input, url: input.url || jira.url, insecure: true });
    expect(r.body).toMatchObject({ ok: false, code });
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);
  });
});

describe("the product owner's part", () => {
  const types = [
    { name: "Story", template: "## Why\n\n## Acceptance criteria\n\n## Out of scope\n", ac: "Acceptance criteria", branch: "feature", commit: "feat" },
    { name: "Bug", template: "## Steps to reproduce\n\n## Expected\n", ac: "Expected", branch: "bugfix", commit: "fix" },
    { name: "e2e", jiraType: "Task", template: "## Scenarios\n\n## Data\n", ac: "Scenarios", branch: "chore", commit: "test" }, // the team's own name for a kind of Jira Task
  ];
  it("refuses what is not enough, writing nothing", async () => {
    const r = await call("POST", "/api/setup/po", { name: "My App", url: jira.url, project: "PROJ", types: [] });
    expect(r.status).toBe(422);
    expect(existsSync(join(root, "liftoff.yaml"))).toBe(false);
  });
  it("writes a valid liftoff.yaml with the tickets, and every file Init used to write", async () => {
    const r = await call("POST", "/api/setup/po", { name: "My App", purpose: "Lets people book rooms.", url: jira.url, project: "PROJ", insecure: true, types });
    expect(r.status).toBe(200);
    expect(validateConfig(yaml())).toMatchObject({ ok: true });
    const c = yaml();
    expect(c).toMatchObject({ project: { name: "My App", kind: "existing", setup: "po" }, agents: { targets: ["claude-code"] }, build: { git: "assisted" }, tracker: { url: jira.url, project: "PROJ", server: { sslVerify: false } } });
    expect(c.tracker.issueTypes.map((t: any) => t.name)).toEqual(["Story", "Bug", "e2e"]);
    expect(c.tracker.issueTypes[2]).toMatchObject({ jiraType: "Task", commitType: "test", readingMap: { acceptanceCriteria: { heading: "Scenarios" } } });
    expect(c.tracker.issueTypes[0].jiraType).toBeUndefined(); // a type that is its own Jira type says nothing
    expect(c.tracker.issueTypes[1]).toMatchObject({ branchType: "bugfix", commitType: "fix", readingMap: { acceptanceCriteria: { heading: "Expected" } } });
    expect(c.tracker.issueTypes[0]).toMatchObject({ commitType: "feat" });
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("Lets people book rooms.");
    expect(existsSync(join(root, "CONSTRAINTS.md"))).toBe(true);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true); // rendered
    expect(JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8")).enabledPlugins).toEqual({ "liftoff@liftoff": true });
    const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers["liftoff-jira"];
    expect(mcp.env.JIRA_URL).toBe(jira.url);
    expect(mcp.env.JIRA_SSL_VERIFY).toBe("false"); // the person skipped the check for this local test Jira
    expect(mcp.args[1]).not.toContain("SSL_CERT_FILE"); // and no certificate file is involved
    expect(r.body.written).toEqual(expect.arrayContaining(["liftoff.yaml", "AGENTS.md", "CONSTRAINTS.md", ".mcp.json", ".claude/settings.json"]));
  });
  it("leaves a team's own AGENTS.md alone (a second run changes nothing it did not write)", async () => {
    const generated = readFileSync(join(root, "AGENTS.md"), "utf8");
    write(root, "AGENTS.md", "# our own rules\n");
    const r = await call("POST", "/api/setup/po", { name: "My App", url: jira.url, project: "PROJ", insecure: true, types });
    expect(r.body.kept).toContain("AGENTS.md");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("# our own rules\n");
    write(root, "AGENTS.md", generated); // back to the generated one for the technical lead's part
  });
  it("no file the setup wrote holds the token", () => {
    for (const [file, text] of textFiles(root)) expect({ file, leak: text.includes(TOKEN) }).toMatchObject({ leak: false });
  });
  it("has now handed over to the technical lead", async () => {
    const s = (await call("GET", "/api/setup")).body;
    expect(s.stage).toBe("tl");
    expect(s.unsaved).toEqual(expect.arrayContaining(["liftoff.yaml", "AGENTS.md"])); // written, not saved: the page offers the save again when reopened
    expect(s.unsaved).not.toContain("notes-not-mine.txt");
    expect(await (await fetch(ui.url)).text()).toContain("WIZARD"); // still the guide, now at its second part
  });
});

describe("saving to the team", () => {
  it("lists only the setup files, never a colleague's work in progress, and the branch it would use", async () => {
    const p = (await call("POST", "/api/save/preview", { stage: "po" })).body;
    expect(p).toMatchObject({ ok: true, git: true, branch: "liftoff/setup-po", identity: true });
    expect(p.files).toEqual(expect.arrayContaining(["liftoff.yaml", "AGENTS.md", ".mcp.json", ".claude/settings.json", "CLAUDE.md", "CONSTRAINTS.md"]));
    expect(p.files).not.toContain("notes-not-mine.txt");
    expect(p.files.some((f: string) => f.startsWith(".liftoff"))).toBe(false);
  });
  it("commits nothing when the list the person saw is not the list now", async () => {
    const r = await call("POST", "/api/save", { stage: "po", files: ["liftoff.yaml"] });
    expect(r.body).toMatchObject({ ok: false, code: "changed" });
    expect(git(root, "branch", "--list", "liftoff/*")).toBe("");
  });
  it("saves to a new branch and pushes it, leaving main and the other work alone", async () => {
    const files = (await call("POST", "/api/save/preview", { stage: "po" })).body.files;
    const r = await call("POST", "/api/save", { stage: "po", files });
    expect(r.body).toMatchObject({ ok: true, branch: "liftoff/setup-po", pushed: true });
    expect(git(remote, "branch", "--list")).toContain("liftoff/setup-po");
    expect(git(remote, "rev-parse", "main")).toBe(git(root, "rev-parse", "main")); // main is where it was
    expect(git(root, "show", "--stat", "--format=%s", "liftoff/setup-po")).toContain("chore: LiftOff setup");
    expect(git(root, "show", "--name-only", "--format=", "liftoff/setup-po")).not.toContain("notes-not-mine.txt");
    expect(git(root, "status", "--porcelain")).toContain("notes-not-mine.txt"); // still there, untouched
  });
});

describe("the technical lead's part", () => {
  it("confirms the modules, assistants and GitLab, and the setup is complete", async () => {
    git(root, "checkout", "-q", "liftoff/setup-po"); // the lead pulls the product owner's branch
    // Connect has learned a field for Story by now: adding types must not lose it
    const learned = parse(readFileSync(join(root, "liftoff.yaml"), "utf8"));
    learned.tracker.issueTypes[0].createFields = { customfield_10042: "kept" };
    writeFileSync(join(root, "liftoff.yaml"), stringify(learned));
    expect((await call("GET", "/api/setup")).body.detected.git).toMatchObject({ branch: "liftoff/setup-po", defaultBranch: "main" }); // merge requests still go to main
    const r = await call("POST", "/api/setup/tl", {
      modules: [{ id: "backend", path: "backend", languages: ["Java"], frameworks: ["Spring Boot"], build: "mvn verify", test: "mvn test", lint: "" }, { id: "frontend", path: "frontend", languages: ["TypeScript"], frameworks: ["React"], build: "", test: "", lint: "" }],
      languages: ["Cobol"], frameworks: ["Ignored"], targets: ["claude-code", "copilot"], git: "manual", host: "GitLab.Example.com",
      conventions: { targetBranch: "main", branchPattern: "{type}/{key}-{slug}", titlePattern: "{commitType}({key}): {summary}", labels: ["backend"], reviewers: [] }, constraintsText: "# Constraints\n\nOur bar.\n",
      types: [{ name: "support prio", jiraType: "Task", template: "## Context\n\n## Acceptance criteria\n", ac: "Acceptance criteria", branch: "chore", commit: "chore" }],
    });
    expect(r.status).toBe(200);
    expect(validateConfig(yaml())).toMatchObject({ ok: true });
    expect(yaml()).toMatchObject({ project: { setup: "done" }, build: { git: "manual" }, agents: { targets: ["claude-code", "copilot"] }, codeHost: { host: "gitlab.example.com", conventions: { titlePattern: "{commitType}({key}): {summary}" } }, modules: { items: [{ id: "backend" }, { id: "frontend" }] } });
    expect(readFileSync(join(root, "backend", "AGENTS.md"), "utf8")).toContain("mvn verify");
    // the project's stack is what its parts add up to, told once: the global lists the page might still send are not used
    expect(yaml().stack).toEqual({ languages: ["Java", "TypeScript"], frameworks: ["Spring Boot", "React"] });
    // the root AGENTS.md, written by the product owner before the modules were known, now lists them; a team's own text around it stays
    const root_md = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(root_md).toContain("| backend | `backend` | Java, Spring Boot |");
    expect(root_md).not.toContain("Single application: no modules.");
    expect(root_md).toContain("<!-- liftoff:modules -->");
    expect(readFileSync(join(root, "CONSTRAINTS.md"), "utf8")).toBe("# Constraints\n\nOur bar.\n");
    // the lead added a type of the team's own; the three that existed, with what Connect learned, are untouched
    expect(yaml().tracker.issueTypes.map((x: any) => x.name)).toEqual(["Story", "Bug", "e2e", "support prio"]);
    expect(yaml().tracker.issueTypes[0].createFields).toEqual({ customfield_10042: "kept" });
    expect(yaml().tracker.issueTypes[2]).toMatchObject({ jiraType: "Task", template: "## Scenarios\n\n## Data\n" });
    expect(yaml().tracker.issueTypes[3]).toMatchObject({ jiraType: "Task", commitType: "chore" });
    expect(existsSync(join(root, ".vscode", "mcp.json"))).toBe(true); // Copilot was added
    const after = (await call("GET", "/api/setup")).body;
    expect(after.stage).toBe("done");
    expect(after.unsaved).toEqual(expect.arrayContaining(["liftoff.yaml", "backend/AGENTS.md"])); // written, not saved
    expect(await (await fetch(ui.url)).text()).toContain("WIZARD"); // so the page offers the save again, whatever the stage
  });
  it("refreshing the root file never touches what a team wrote, even when the modules change again", async () => {
    const mine = readFileSync(join(root, "AGENTS.md"), "utf8").replace("## Rules that always apply", "## Rules that always apply\n\n- Our own rule, written by hand.");
    write(root, "AGENTS.md", mine);
    const r = await call("POST", "/api/setup/tl", { modules: [{ id: "backend", path: "backend", languages: ["Kotlin"], frameworks: [], build: "", test: "", lint: "" }], targets: ["claude-code", "copilot"], git: "manual" });
    expect(r.status).toBe(200);
    const after = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(after).toContain("- Our own rule, written by hand.");
    expect(after).toContain("| backend | `backend` | Kotlin |");
    expect(after).not.toContain("| frontend |"); // the marked block was refreshed
    await call("POST", "/api/setup/tl", { modules: [{ id: "backend", path: "backend", languages: ["Java"], frameworks: ["Spring Boot"], build: "mvn verify", test: "mvn test", lint: "" }, { id: "frontend", path: "frontend", languages: ["TypeScript"], frameworks: ["React"], build: "", test: "", lint: "" }], targets: ["claude-code", "copilot"], git: "manual", host: "gitlab.example.com" });
  });
  it("the project brain: off unless the lead says yes, and a yes makes the folders and the four shared settings", async () => {
    const base = { modules: [{ id: "backend", path: "backend", languages: ["Java"], frameworks: [], build: "", test: "", lint: "" }], targets: ["claude-code", "copilot"], git: "manual" };
    const no = await call("POST", "/api/setup/tl", { ...base, brain: "off" });
    expect(no.status).toBe(200);
    expect(yaml().brain).toBeUndefined();
    expect(existsSync(join(root, "brain"))).toBe(false);
    const yes = await call("POST", "/api/setup/tl", { ...base, brain: "lessons" });
    expect(yes.status).toBe(200);
    expect(yaml().brain).toEqual({ lessons: {} });
    expect(yes.body.written).toEqual(expect.arrayContaining(["brain/README.md", "brain/hot.md", "AGENTS.md", ".claude/settings.json", ".vscode/settings.json", ".gitattributes"]));
    expect(JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8")).permissions.deny).toContain("Edit(/brain/raw/**)");
    expect(JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8")).enabledPlugins).toBeTruthy(); // what was there stays
    expect(readFileSync(join(root, ".gitattributes"), "utf8")).toContain("brain/log/*.md merge=union");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("## Project brain");
    expect(liftoff(root, ["brain-check"]).status).toBe(0); // the brain the guide made is a healthy one
    // asking again changes nothing, and "off" later does not switch it off (that is the Brain skill's job)
    const again = await call("POST", "/api/setup/tl", { ...base, brain: "on" });
    expect(again.status).toBe(200);
    expect((readFileSync(join(root, "AGENTS.md"), "utf8").match(/<!-- liftoff:brain -->/g) ?? []).length).toBe(1);
    await call("POST", "/api/setup/tl", { ...base, brain: "off" });
    expect(yaml().brain).toEqual({ lessons: {} });
  });
  it("saves on its own branch", async () => {
    const files = (await call("POST", "/api/save/preview", { stage: "tl" })).body.files;
    expect(files).toEqual(expect.arrayContaining(["liftoff.yaml", "backend/AGENTS.md", "backend/CLAUDE.md", ".vscode/mcp.json", ".github/copilot-instructions.md"]));
    const r = await call("POST", "/api/save", { stage: "tl", files });
    expect(r.body).toMatchObject({ ok: true, branch: "liftoff/setup-tl", pushed: true });
    expect((await call("GET", "/api/setup")).body.unsaved).toEqual([]);
    expect(await (await fetch(ui.url)).text()).toContain("PANEL"); // saved: now the usual panel
    expect(git(remote, "branch", "--list")).toContain("liftoff/setup-tl");
  });
  it("refuses a new type whose name is taken (Jira treats names alike whatever the case) or that has no template", async () => {
    for (const types of [[{ name: "STORY", jiraType: "Task", template: "## A\n", ac: "A" }], [{ name: "fresh one", jiraType: "Task" }]]) {
      const r = await call("POST", "/api/setup/tl", { modules: [], targets: ["claude-code"], types });
      expect(r.status).toBe(422);
    }
  });
  it("refuses a module folder that leaves the project", async () => {
    const r = await call("POST", "/api/setup/tl", { modules: [{ id: "x", path: "../outside" }], targets: ["claude-code"] });
    expect(r.status).toBe(422);
  });
});

describe("changing the ticket types after the setup (what the control panel sends)", () => {
  it("edits a template, adds a type of its own, and keeps what Connect learned", async () => {
    const st = (await call("GET", "/api/state")).body;
    const names = st.config.tracker.issueTypes.map((x: any) => x.name);
    const keep = names.map((name: string) => ({ $was: name, name }));
    keep[0] = { $was: "Story", name: "Story", template: "## Why\n\n## Acceptance criteria\n\n## Risks\n" };
    const spike = { name: "spike", jiraType: "Task", commitType: "chore", branchType: "chore", template: "## Question\n\n## Findings\n", readingMap: { acceptanceCriteria: { heading: "Findings" } } };
    const r = await call("POST", "/api/apply", { patch: { tracker: { issueTypes: [...keep, spike] } }, baseHash: st.hash });
    expect(r.status).toBe(200);
    const c = yaml();
    expect(c.tracker.issueTypes.map((x: any) => x.name)).toEqual([...names, "spike"]);
    expect(c.tracker.issueTypes[0].template).toContain("## Risks");
    expect(c.tracker.issueTypes[0].createFields).toEqual({ customfield_10042: "kept" }); // learned by Connect, never in the patch
    expect(c.tracker.issueTypes[names.length]).toMatchObject({ jiraType: "Task", commitType: "chore" });
    expect(validateConfig(c)).toMatchObject({ ok: true });
  });
  it("taking a type out of the list removes that one only", async () => {
    const st = (await call("GET", "/api/state")).body;
    const names: string[] = st.config.tracker.issueTypes.map((x: any) => x.name);
    const r = await call("POST", "/api/apply", { patch: { tracker: { issueTypes: names.filter((n) => n !== "spike").map((name) => ({ $was: name, name })) } }, baseHash: st.hash });
    expect(r.status).toBe(200);
    expect(yaml().tracker.issueTypes.map((x: any) => x.name)).toEqual(names.filter((n) => n !== "spike"));
  });
  it("two types that would share a Jira label are refused with a message", async () => {
    const r = await call("POST", "/api/validate", { patch: { tracker: { issueTypes: [{ $was: "e2e", name: "e2e" }, { name: "E2E!", jiraType: "Task" }] } } });
    expect(JSON.stringify(r.body.errors)).toContain("liftoff-e2e");
  });
});

describe("a project that is not under git", () => {
  it("says so in the preview, so the page can explain it", async () => {
    const plain = join(dir, "plain");
    write(plain, "README.md", "x\n");
    const u2 = await startUi({ root: plain, page: "p", wizard: "w", assetsDir: ASSETS });
    const t = new URL(u2.url);
    const r = await fetch(t.origin + "/api/save/preview", { method: "POST", headers: { "x-liftoff-token": t.searchParams.get("t")!, "content-type": "application/json" }, body: JSON.stringify({ stage: "po" }) });
    expect(((await r.json()) as any).git).toBe(false);
    await u2.close();
  });
});
