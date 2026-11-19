import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, realpathSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { applyRender } from "../src/cli/apply.js";
import { atomicWrite, isInside, resolveReal } from "../src/cli/fsutil.js";
import { ensureSelfIgnore } from "../src/cli/state.js";
import { CONFIG_FILE } from "../src/cli/validate.js";
import { INSTALLED_VERSION } from "../src/cli/version.js";
import { validateConfig } from "../src/config/index.js";
import { applyPatch } from "./merge.js";

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
export async function startUi(opts: { root: string; page: string; port?: number }): Promise<UiServer> {
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
    applyPatch(doc, patch as Record<string, unknown>);
    const result = validateConfig(doc.toJS());
    return { errors: result.ok ? [] : result.errors, yaml: doc.toString() };
  }

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
    const c = body.constraints as { file?: unknown; text?: unknown } | null | undefined;
    let constraintsPath: string | undefined;
    if (c) {
      constraintsPath = inside(c.file);
      if (!constraintsPath || typeof c.text !== "string" || c.text.length > MAX_TEXT) return [422, { ok: false, code: "constraints-invalid", message: "the constraints file must be inside the project, and under 200 KB" }] as const;
    }
    if (yaml !== text) atomicWrite(configFile, yaml);
    if (constraintsPath && c && typeof c.text === "string" && read(constraintsPath) !== c.text && c.text.trim() !== "") atomicWrite(constraintsPath, c.text);
    try {
      unlinkSync(draftFile);
    } catch {
      // no draft
    }
    return [200, { ok: true, hash: sha(yaml), render: applyRender(root, { overwrite: [] }) }] as const;
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
        return void res.end(opts.page.replaceAll("__TOKEN__", token));
      }

      if (!url.pathname.startsWith("/api/")) return send(res, 404, { ok: false, message: "not found" });
      if (!same(String(req.headers["x-liftoff-token"] ?? ""), token)) return send(res, 403, { ok: false, message: "bad token" });
      const route = `${req.method} ${url.pathname}`;
      if (route === "GET /api/state") return send(res, 200, state());
      if (req.method !== "POST" && req.method !== "PUT" && req.method !== "DELETE") return send(res, 405, { ok: false, message: "method not allowed" });
      if (req.method !== "DELETE" && !String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { ok: false, message: "send JSON" });
      const input = req.method === "DELETE" ? {} : await body(req);
      if (!input) return send(res, 400, { ok: false, message: "invalid or too large JSON body" });

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
