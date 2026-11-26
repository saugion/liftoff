import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { applyRender } from "../src/cli/apply.js";
import { atomicWrite, isInside, resolveReal } from "../src/cli/fsutil.js";
import { ensureSelfIgnore } from "../src/cli/state.js";
import { CONFIG_FILE } from "../src/cli/validate.js";
import { INSTALLED_VERSION } from "../src/cli/version.js";
import { validateConfig, type Config } from "../src/config/index.js";
import defaults from "../src/connect/defaults.json" with { type: "json" };
import { isLocal, listProjects, parseUrl, projectTypes, sampleHeadings, skipsCheck, tokenInEnv } from "./connect.js";
import { detect, hostOf } from "./detect.js";
import { applyPatch } from "./merge.js";
import { createConfigRepo, previewSave, recordWritten, save, type Stage } from "./persist.js";
import { choiceFile, workspaceState } from "./workspace.js";
import { brainInit } from "../src/cli/brain-init.js";
import { brainExtras, claudeSettings, mcpFiles, refreshRoot, scaffold, stacksIn, toCreate, type ByHand, type ModuleInfo, type ScaffoldInput, type Scaffolded } from "./scaffold.js";
import { checkConfig } from "../src/cli/check.js";

export const DRAFT_FILE = ".liftoff/ui-draft.json";
const MAX_BODY = 1_000_000;
const MAX_TEXT = 200_000;
const DEFAULT_CONSTRAINTS = "CONSTRAINTS.md";

const read = (file: string): string | undefined => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const seed = () => `liftoff: 1\nplugin:\n  version: "${INSTALLED_VERSION.split(".").slice(0, 2).join(".")}"\n`;

export interface UiServer {
  url: string;
  close: () => Promise<void>;
  server: Server;
}

// A local control panel for liftoff.yaml. It only ever listens on 127.0.0.1, answers only requests that carry the
// session token and a local Host header, and writes through the same validator the CLI uses.
export async function startUi(opts: { root: string; page: string; wizard?: string; assetsDir?: string; port?: number }): Promise<UiServer> {
  const root = realpathSync(opts.root);
  const configFile = join(root, CONFIG_FILE);
  const draftFile = join(root, DRAFT_FILE);
  const token = randomBytes(24).toString("hex");
  let port = 0;

  // The text liftoff.yaml would have after the patch, and what the validator says about it. Nothing is written.
  function preview(patch: unknown) {
    const text = read(configFile) ?? seed();
    const doc = parseDocument(text);
    if (doc.errors.length > 0) return { errors: [{ path: "", message: doc.errors[0]!.message.split("\n")[0]! }], yaml: text };
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return { errors: [{ path: "", message: "patch must be an object" }], yaml: text };
    applyPatch(doc, withHost(patch as Record<string, any>));
    const result = validateConfig(doc.toJS());
    return { errors: result.ok ? [] : result.errors, yaml: doc.toString(), creates: creates(doc.toJS()) };
  }

  // A pasted address becomes the host the config holds, whichever page sent it.
  const withHost = (patch: Record<string, any>) =>
    typeof patch.codeHost?.host === "string" && patch.codeHost.host.trim() !== "" ? { ...patch, codeHost: { ...patch.codeHost, host: hostOf(patch.codeHost.host) } } : patch;

  // The files a setup would have to create for this config. It may be half typed, so nothing is assumed about it.
  function creates(config: unknown): string[] {
    const c = config as { modules?: { items?: unknown }; constraints?: { file?: unknown } } | null;
    const items = Array.isArray(c?.modules?.items) ? (c.modules.items as ({ path?: unknown } | null)[]) : [];
    const paths = items.flatMap((m) => (typeof m?.path === "string" && m.path !== "" && inside(m.path) ? [m.path] : []));
    const file = typeof c?.constraints?.file === "string" && inside(c.constraints.file) ? c.constraints.file : DEFAULT_CONSTRAINTS;
    return toCreate(root, paths, file);
  }

  // A module folder that cannot be one: a link that leaves the project, or a file where the folder should be.
  const badFolder = (modules: { path?: string }[]) =>
    modules.find((m) => {
      if (!m.path) return false;
      const abs = resolveReal(join(root, m.path));
      if (!isInside(resolveReal(root), abs)) return true;
      try {
        return !statSync(abs).isDirectory();
      } catch {
        return false; // does not exist yet: it is created
      }
    });
  const folderError = (path: string | undefined) => [422, { ok: false, code: "input-invalid", message: `the folder '${path}' is not a folder inside the project` }] as const;

  // A file named by the config, inside the project and not through a symlink that leaves it.
  function inside(rel: unknown): string | undefined {
    if (typeof rel !== "string" || rel === "") return undefined;
    const abs = resolveReal(join(root, rel));
    return isInside(root, abs) ? abs : undefined;
  }

  function state() {
    const text = read(configFile);
    const doc = text === undefined ? undefined : parseDocument(text);
    const config = doc && doc.errors.length === 0 ? (doc.toJS() as Record<string, unknown> | null) ?? {} : null;
    const parsed = text === undefined ? undefined : validateConfig(config);
    const file = (config?.constraints as { file?: string } | undefined)?.file ?? DEFAULT_CONSTRAINTS;
    const abs = inside(file);
    let draft: unknown = null;
    try {
      draft = JSON.parse(read(draftFile) ?? "null");
    } catch {
      draft = null;
    }
    return {
      ok: true, root, file: CONFIG_FILE, exists: text !== undefined, hash: text === undefined ? "" : sha(text), version: INSTALLED_VERSION, config,
      errors: doc && doc.errors.length > 0 ? [{ path: "", message: doc.errors[0]!.message.split("\n")[0] }] : parsed && !parsed.ok ? parsed.errors : [],
      constraints: { file, text: abs === undefined ? null : read(abs) ?? null }, draft,
    };
  }

  function apply(body: Record<string, unknown>) {
    const text = read(configFile);
    if ((text === undefined ? "" : sha(text)) !== body.baseHash) return [409, { ok: false, code: "changed-on-disk", message: `${CONFIG_FILE} changed since this page loaded. Reload to see it.` }] as const;
    const { errors, yaml } = preview(body.patch);
    if (errors.length > 0) return [422, { ok: false, code: "config-invalid", errors }] as const;
    const before = text === undefined ? null : (parseDocument(text).toJS() as Record<string, any> | null);
    const next = validateConfig(parseDocument(yaml).toJS());
    const bad = next.ok ? badFolder(next.value.modules?.items ?? []) : undefined;
    if (bad) return folderError(bad.path);
    const c = body.constraints as { file?: unknown; text?: unknown } | null | undefined;
    let constraintsPath: string | undefined;
    if (c) {
      constraintsPath = inside(c.file);
      if (!constraintsPath || typeof c.text !== "string" || c.text.length > MAX_TEXT) return [422, { ok: false, code: "constraints-invalid", message: "the constraints file must be inside the project, and under 200 KB" }] as const;
    }
    const written: string[] = [];
    if (yaml !== text) {
      atomicWrite(configFile, yaml);
      written.push(CONFIG_FILE);
    }
    if (constraintsPath && c && typeof c.text === "string" && read(constraintsPath) !== c.text && c.text.trim() !== "") {
      atomicWrite(constraintsPath, c.text);
      written.push(c.file as string);
    }
    try {
      unlinkSync(draftFile);
    } catch {
      // no draft
    }
    const done = (render: unknown, byHand: ByHand[] = []) => {
      if (written.length > 0) {
        ensureSelfIgnore(root);
        recordWritten(root, [...new Set(written)]);
      }
      return [200, { ok: true, hash: sha(yaml), written: [...new Set(written)], byHand, render }] as const;
    };
    if (!assets() || !next.ok) return done(applyRender(root, { overwrite: [] }));
    // The same files as the guide. Unlike the guide, a failure here keeps the config: the person is told, and can apply again.
    try {
      const config = next.value;
      const d = detect(root);
      const stacks = stacksIn(root);
      const modules = (config.modules?.items ?? []).map((m): ModuleInfo => {
        const path = m.path.replace(/^\.\/|\/+$/g, "");
        const found = d.modules.find((x) => x.path === path);
        return { id: m.id, path, stack: stacks.get(path) ?? (found ? [...found.languages, ...found.frameworks].join(", ") : ""), ...(found?.build && { build: found.build }), ...(found?.test && { test: found.test }), ...(found?.lint && { lint: found.lint }) };
      });
      // only what this apply changed is rewritten in the root AGENTS.md
      const after = parseDocument(yaml).toJS() as Record<string, unknown>; // file against file: the validator may fill in defaults
      const differs = (key: "modules" | "agents") => before !== null && JSON.stringify(before[key]) !== JSON.stringify(after[key]);
      const refresh = [...(differs("modules") ? ["modules", "commands"] : []), ...(differs("agents") ? ["agents"] : [])];
      const out = around(config, projectFiles(config, { name: config.project?.name ?? d.name, purpose: "", modules, commands: d.commands, refresh, newBrain: config.brain !== undefined && before?.brain === undefined }));
      written.push(...out.written);
      return done(out.render, out.byHand);
    } catch (e) {
      return done({ ok: false, errors: [{ message: e instanceof Error ? e.message : "the files could not be written" }] });
    }
  }

  // The files around a config, written the same way by the guide and by the control panel: the AGENTS.md files and the
  // quality bar from the templates (a file with content is never replaced), and the project brain when it was just asked for.
  function projectFiles(config: Config, o: Pick<ScaffoldInput, "name" | "purpose" | "modules" | "commands"> & { refresh?: string[]; newBrain?: boolean }): Scaffolded {
    const input: ScaffoldInput = { name: o.name, purpose: o.purpose, modules: o.modules, commands: o.commands, constraintsFile: config.constraints?.file ?? DEFAULT_CONSTRAINTS, targets: config.agents.targets };
    const out = scaffold(root, assets()!, input);
    if (o.refresh && o.refresh.length > 0 && refreshRoot(root, input, o.refresh)) out.written.push("AGENTS.md");
    if (o.newBrain) {
      const made = brainInit({ root, write: true } as never);
      if (made.exitCode !== 0) throw new Error(`the project brain could not be set up: ${JSON.stringify((made.body as { errors?: { message: string }[] }).errors?.[0]?.message ?? "see liftoff brain-init")}`);
      const body = made.body as { files: { path: string; action: string }[]; proposals: Parameters<typeof brainExtras>[1] };
      out.written.push(...body.files.filter((f) => f.action === "created" && !f.path.startsWith(".liftoff/")).map((f) => f.path), ...brainExtras(root, body.proposals, (out.byHand ??= [])));
    }
    out.kept = out.kept.filter((f) => !out.written.includes(f));
    return out;
  }

  // Then what the agents read: the plugin switch, the Jira server entry and the rendered files.
  function around(config: Config, out: Scaffolded) {
    const byHand: ByHand[] = [...(out.byHand ?? [])];
    const settings = assets() ? claudeSettings(root, assets()!, byHand) : undefined;
    const mcp = mcpFiles(root, config, byHand);
    const render = applyRender(root, { overwrite: [] });
    const rendered = render.ok ? render.files.filter((f) => f.action === "created" || f.action === "refreshed").map((f) => f.path) : [];
    return { written: [...new Set([...out.written, ...(settings ? [settings] : []), ...mcp, ...rendered])], kept: out.kept, byHand, render };
  }


  // ---- guided setup: the product owner first, then the technical lead --------------------------------------------
  const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v.trim() : undefined);
  const list = (v: unknown, max = 50): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "" && x.length <= 100).map((x) => x.trim()).slice(0, max) : []);
  const stageOf = (config: Record<string, any> | null, exists: boolean): "po" | "tl" | "done" => (!exists ? "po" : config?.project?.setup === "po" ? "tl" : "done");
  const assets = () => opts.assetsDir;
  const cfgInsecure = () => {
    try {
      return (parseDocument(read(configFile) ?? "").toJS() as Record<string, any> | null)?.tracker?.server?.sslVerify === false;
    } catch {
      return false;
    }
  };
  const defaultTemplates = () => {
    const dir = assets() && join(assets()!, "..", "..", "liftoff-connect", "assets", "defaults");
    return Object.fromEntries(["task", "story", "bug", "epic"].map((n) => [n, (dir && read(join(dir, `${n}.md`))) || "## Context\n\n## Acceptance criteria\n\n## Notes\n"]));
  };

  async function setupState() {
    const base = state();
    const config = base.config as Record<string, any> | null;
    const saved = await previewSave(root, "po");
    return { unsaved: saved.git ? saved.files : [], ok: true, root, exists: base.exists, hash: base.hash, stage: stageOf(config, base.exists), config, errors: base.errors, detected: detect(root), templates: defaultTemplates(), serverVersion: defaults.jiraServerVersion, tokenInEnv: tokenInEnv(), workspace: workspaceState(root) };
  }

  // What the control panel needs on top of the file: what the folder holds, the default templates, what is not there yet
  // and what the guide or the panel wrote that was not saved.
  async function panelState() {
    const base = state();
    const unapplied = base.exists && checkConfig(root).reasons.some((r) => r.code === "not-applied" || r.code === "required-changed");
    const missing = base.exists && base.config ? creates(base.config) : [];
    return { ...base, detected: detect(root), templates: defaultTemplates(), serverVersion: defaults.jiraServerVersion, creates: missing, needsApply: unapplied || missing.length > 0, tokenInEnv: tokenInEnv(), workspace: workspaceState(root) };
  }

  // Writes liftoff.yaml from a patch (same merge and validator as the panel), then the files around it. If anything after
  // the config fails, the config goes back to what it was: a half-written setup must not leave the guide switched off.
  function writeSetup(patch: Record<string, unknown>, files: (config: Config) => { written: string[]; kept: string[] }) {
    const before = read(configFile);
    const { errors, yaml } = preview(patch);
    if (errors.length > 0) return [422, { ok: false, code: "config-invalid", errors }] as const;
    const undo = () => (before === undefined ? unlinkSync(configFile) : atomicWrite(configFile, before));
    try {
      if (yaml !== before) atomicWrite(configFile, yaml);
      const checked = validateConfig(parseDocument(yaml).toJS());
      if (!checked.ok) {
        undo();
        return [422, { ok: false, code: "config-invalid", errors: checked.errors }] as const;
      }
      const out = around(checked.value, files(checked.value));
      const rendered = out.render;
      if (!rendered.ok) {
        undo();
        return [422, { ok: false, code: "render-failed", message: (rendered.errors ?? []).map((e: { message: string }) => e.message).join("; ") || "the agent files could not be written" }] as const;
      }
      const written = [...new Set([CONFIG_FILE, ...out.written])];
      ensureSelfIgnore(root); // the list of what the guide wrote is personal: never committed
      recordWritten(root, written);
      return [200, { ok: true, written, kept: out.kept, byHand: out.byHand, render: rendered }] as const;
    } catch (e) {
      try {
        undo();
      } catch {
        // nothing more to do
      }
      return [422, { ok: false, code: "write-failed", message: e instanceof Error ? e.message : "the files could not be written" }] as const;
    }
  }

  // The ticket types a person chose or made up, as the page sends them. A name of their own may differ from the Jira type it is created as.
  const parseTypes = (raw: unknown) =>
    (Array.isArray(raw) ? raw : []).slice(0, 40).map((t: any) => ({
      name: str(t?.name, 80), jiraType: str(t?.jiraType, 80), template: str(t?.template, 5_000), ac: str(t?.ac, 80) ?? "Acceptance criteria",
      branch: ["feature", "bugfix", "chore"].includes(t?.branch) ? (t.branch as string) : "feature", commit: typeof t?.commit === "string" && /^[a-z]+$/.test(t.commit) ? (t.commit as string) : undefined,
    }));
  const typeEntry = (t: ReturnType<typeof parseTypes>[number]) => ({
    // null clears a jiraType that was set and is now the name itself; a re-run never touches what Connect learned (no `fields` here)
    name: t.name, jiraType: t.jiraType && t.jiraType.toLowerCase() !== t.name!.toLowerCase() ? t.jiraType : null, branchType: t.branch, commitType: t.commit,
    template: t.template!.endsWith("\n") ? t.template! : t.template + "\n", readingMap: { acceptanceCriteria: { heading: t.ac } },
  });

  function poSetup(input: Record<string, unknown>) {
    if (!assets()) return [500, { ok: false, code: "internal", message: "the panel was started without its templates" }] as const;
    const name = str(input.name, 100), url = parseUrl(input.url), project = str(input.project, 20);
    if (!name || !url || !project || !/^[A-Z][A-Z0-9_]*$/.test(project)) return [422, { ok: false, code: "input-invalid", message: "name, Jira address and project key are needed" }] as const;
    const types = parseTypes(input.types);
    if (types.length === 0 || types.some((t) => !t.name || !t.template)) return [422, { ok: false, code: "input-invalid", message: "choose at least one ticket type, each with a template" }] as const;
    const d = detect(root);
    const fresh = read(configFile) === undefined;
    const patch = {
      project: { name, kind: fresh ? d.kind : undefined, setup: "po" },
      ...(fresh && { agents: { targets: ["claude-code"] }, constraints: { required: true, file: DEFAULT_CONSTRAINTS }, build: { required: true, git: "assisted" } }),
      tracker: {
        kind: "jira-dc", url: url.origin + url.pathname.replace(/\/$/, ""), project,
        server: { version: defaults.jiraServerVersion, sslVerify: !(skipsCheck(url, input.insecure) || (cfgInsecure() && isLocal(url))), readOnly: false },
        issueTypes: types.map(typeEntry),
      },
    };
    return writeSetup(patch, (config) =>
      projectFiles(config, { name, purpose: typeof input.purpose === "string" ? input.purpose.slice(0, 500) : "", modules: (config.modules?.items ?? []).map((m) => ({ id: m.id, path: m.path, stack: "" })), commands: d.commands }));
  }

  function tlSetup(input: Record<string, unknown>) {
    if (!assets()) return [500, { ok: false, code: "internal", message: "the panel was started without its templates" }] as const;
    const targets = list(input.targets).filter((t) => t === "claude-code" || t === "copilot");
    const modules = (Array.isArray(input.modules) ? input.modules : []).slice(0, 30).map((m: any) => ({ id: str(m?.id, 60), path: str(m?.path, 200), description: typeof m?.description === "string" ? m.description.slice(0, 200) : "", languages: list(m?.languages, 10), frameworks: list(m?.frameworks, 10), build: str(m?.build, 200), test: str(m?.test, 200), lint: str(m?.lint, 200) }));
    const bad = badFolder(modules);
    if (bad) return folderError(bad.path);
    if (targets.length === 0 || modules.some((m) => !m.id || !m.path || m.path.startsWith("/") || m.path.includes(".."))) return [422, { ok: false, code: "input-invalid", message: "choose at least one agent, and give every module a name and a folder inside the project" }] as const;
    const existing: string[] = ((state().config as any)?.tracker?.issueTypes ?? []).map((x: { name: string }) => x.name);
    const added = parseTypes(input.types);
    if (added.some((x) => !x.name || !x.template) || new Set([...existing, ...added.map((x) => x.name!)].map((n) => n.toLowerCase())).size !== existing.length + added.length) {
      return [422, { ok: false, code: "input-invalid", message: "each new ticket type needs its own name and a template" }] as const;
    }
    const hadBrain = (state().config as Record<string, any> | null)?.brain !== undefined;
    const wantsBrain = input.brain === "on" || input.brain === "lessons";
    const wantsLessons = input.brain === "lessons";
    const git = input.git === "manual" ? "manual" : "assisted";
    const host = typeof input.host === "string" && input.host.trim() !== "" ? input.host.trim().toLowerCase() : undefined;
    const conv = (input.conventions ?? {}) as Record<string, unknown>;
    const patch = {
      project: { setup: "done" },
      agents: { targets },
      // the stack is told once, per module; the project's own list is what the modules add up to (a single application tells it directly)
      stack: modules.length > 0 ? { languages: [...new Set(modules.flatMap((m) => m.languages))], frameworks: [...new Set(modules.flatMap((m) => m.frameworks))] } : { languages: list(input.languages), frameworks: list(input.frameworks) },
      modules: { items: modules.map((m) => ({ id: m.id, path: m.path, ...(m.description && { description: m.description }) })) },
      build: { git },
      // the project brain is the lead's decision, made on its own page: asked for, it is switched on (and lessons with it, if wanted); never switched off here
      ...(wantsBrain && !hadBrain && { brain: wantsLessons ? { lessons: {} } : {} }),
      // the types the team already has stay as they are (a patch item with only a name changes nothing); the new ones are added
      ...(added.length > 0 && { tracker: { issueTypes: [...existing.map((name) => ({ name })), ...added.map(typeEntry)] } }),
      ...(host && { codeHost: { kind: "gitlab", host, conventions: { targetBranch: str(conv.targetBranch, 100), branchPattern: str(conv.branchPattern, 200), titlePattern: str(conv.titlePattern, 200), labels: list(conv.labels), reviewers: list(conv.reviewers) } } }),
    };
    const d = detect(root);
    const name = String((state().config as any)?.project?.name ?? d.name);
    return writeSetup(patch, (config) => {
      const info: ModuleInfo[] = modules.map((m) => ({ id: m.id!, path: m.path!, stack: [...m.languages, ...m.frameworks].join(", "), ...(m.build && { build: m.build }), ...(m.test && { test: m.test }), ...(m.lint && { lint: m.lint }) }));
      // what the lead typed for the quality bar goes first, so the template never takes its place
      const c = typeof input.constraintsText === "string" && input.constraintsText.length <= MAX_TEXT ? input.constraintsText : undefined;
      const file = config.constraints?.file ?? DEFAULT_CONSTRAINTS;
      const abs = inside(file);
      const typed = c !== undefined && c.trim() !== "" && abs !== undefined && read(abs) !== c;
      if (typed) atomicWrite(abs, c);
      const out = projectFiles(config, { name, purpose: "", modules: info, commands: d.commands, refresh: ["modules", "commands", "agents"], newBrain: wantsBrain && !hadBrain });
      if (typed) out.written.push(file);
      return { ...out, kept: out.kept.filter((f) => f !== file || !typed) };
    });
  }

  async function body(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) return undefined;
      chunks.push(chunk as Buffer);
    }
    try {
      const v: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }

  const send = (res: ServerResponse, code: number, data: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(JSON.stringify(data));
  };

  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "";
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { ok: false, message: "forbidden host" });
      const url = new URL(req.url ?? "/", `http://${host}`);

      if (req.method === "GET" && url.pathname === "/") {
        if (!same(url.searchParams.get("t") ?? "", token)) return send(res, 403, { ok: false, message: "open the address liftoff-ui printed" });
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
          "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        });
        const st = state();
        const view = url.searchParams.get("view");
        const unsaved = (await previewSave(root, "po")).files.length > 0; // written by the guide, not saved: offer the save again, whatever the stage
        const wizard = opts.wizard !== undefined && view !== "panel" && (view === "wizard" || unsaved || stageOf(st.config as Record<string, any> | null, st.exists) !== "done");
        return void res.end((wizard ? opts.wizard! : opts.page).replaceAll("__TOKEN__", token));
      }

      if (!url.pathname.startsWith("/api/")) return send(res, 404, { ok: false, message: "not found" });
      if (!same(String(req.headers["x-liftoff-token"] ?? ""), token)) return send(res, 403, { ok: false, message: "bad token" });
      const route = `${req.method} ${url.pathname}`;
      if (route === "GET /api/state") return send(res, 200, await panelState());
      if (route === "GET /api/setup") return send(res, 200, await setupState());
      if (req.method !== "POST" && req.method !== "PUT" && req.method !== "DELETE") return send(res, 405, { ok: false, message: "method not allowed" });
      if (req.method !== "DELETE" && !String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { ok: false, message: "send JSON" });
      const input = req.method === "DELETE" ? {} : await body(req);
      if (!input) return send(res, 400, { ok: false, message: "invalid or too large JSON body" });

      if (route.startsWith("POST /api/jira/")) {
        // the page may ask to skip the certificate check; the server grants it only for a Jira on this computer
        const asked = { ...input, insecure: input.insecure === true || cfgInsecure() };
        if (route === "POST /api/jira/projects") return send(res, 200, await listProjects(asked));
        if (route === "POST /api/jira/types") return send(res, 200, await projectTypes(asked));
        if (route === "POST /api/jira/sample") return send(res, 200, await sampleHeadings(asked));
      }
      if (route === "POST /api/setup/po" || route === "POST /api/setup/tl") {
        const [code, data] = route.endsWith("/po") ? poSetup(input) : tlSetup(input);
        return send(res, code, data);
      }
      if (route === "POST /api/save/preview" || route === "POST /api/save") {
        const stage: Stage = input.stage === "tl" ? "tl" : "po";
        if (route.endsWith("/preview")) return send(res, 200, { ok: true, ...(await previewSave(root, stage)) });
        return send(res, 200, await save(root, stage, input.files));
      }
      if (route === "POST /api/workspace/init") {
        // the setup already there goes into the first save; files that may hold a person's own keys only when LiftOff wrote them
        const config = state().config as { constraints?: { file?: string }; brain?: { dir?: string } } | null;
        const file = config?.constraints?.file ?? DEFAULT_CONSTRAINTS;
        const existing = [CONFIG_FILE, "AGENTS.md", "CLAUDE.md", file].filter((f) => {
          const abs = inside(f);
          return abs !== undefined && read(abs) !== undefined;
        });
        const brain = config?.brain?.dir ?? "brain";
        const made = await createConfigRepo(root, existing, { constraints: inside(file) ? file : DEFAULT_CONSTRAINTS, brain: inside(brain) ? brain : "brain" });
        return send(res, 200, made.ok ? { ...made, workspace: workspaceState(root) } : made);
      }
      if (route === "POST /api/workspace/skip") {
        ensureSelfIgnore(root); // the choice is personal: never committed
        atomicWrite(choiceFile(root), JSON.stringify({ skipped: true }) + "\n");
        return send(res, 200, { ok: true, workspace: workspaceState(root) });
      }
      if (route === "POST /api/validate") return send(res, 200, { ok: true, ...preview(input.patch) });
      if (route === "POST /api/apply") {
        const [code, data] = apply(input);
        return send(res, code, data);
      }
      if (route === "PUT /api/draft") {
        const text = JSON.stringify({ v: 1, savedAt: new Date().toISOString(), ...input });
        if (text.length > 256_000) return send(res, 413, { ok: false, message: "draft too large" });
        ensureSelfIgnore(root); // the draft is personal: never committed
        atomicWrite(draftFile, text + "\n");
        return send(res, 200, { ok: true });
      }
      if (route === "DELETE /api/draft") {
        try {
          unlinkSync(draftFile);
        } catch {
          // already gone
        }
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { ok: false, message: "not found" });
    } catch (e) {
      return send(res, 500, { ok: false, code: "internal", message: e instanceof Error ? e.message : "internal error" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", resolve); // never 0.0.0.0: this page can write to the project
  });
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}/?t=${token}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
