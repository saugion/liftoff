import { execFile } from "node:child_process";
import { request } from "node:https";
import { userInfo } from "node:os";

// The only part of the panel that talks to another machine, and only to the Jira address the user typed: a few
// read-only REST calls with the token as a Bearer header. The token is read from the keychain (or the environment)
// when it is needed, goes into the keychain through stdin (never an argument, so `ps` never shows it), and is never
// written to a file, the page or a log. Guarded by test/ui-guard.test.ts.
export const TOKEN_ENV = "LIFTOFF_JIRA_TOKEN";
const TOKEN_OK = /^[\x21\x23-\x5b\x5d-\x7e]{8,512}$/; // printable, no space, no double quote, no backslash
// What Node says when it does not know the server's certificate (a private authority, or a self-signed one).
const UNTRUSTED = new Set(["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_UNTRUSTED"]);
const OTHER_CERT = new Set(["ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "HOSTNAME_MISMATCH"]);

export type Reason = "bad-url" | "no-token" | "bad-token" | "no-access" | "no-project" | "untrusted-local" | "untrusted-cert" | "cert-problem" | "unreachable" | "error";
export type Result<T = object> = ({ ok: true } & T) | { ok: false; code: Reason; message: string };
const fail = (code: Reason, message: string): Result<never> => ({ ok: false, code, message });

// https only, no user:password, no query. The host and port the user typed, lowercased: also the keychain name.
export function parseUrl(text: unknown): URL | undefined {
  if (typeof text !== "string") return undefined;
  try {
    const u = new URL(text.trim());
    return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && u.hostname ? u : undefined;
  } catch {
    return undefined;
  }
}
export const service = (u: URL) => `liftoff-jira@${u.host}`;

// A Jira on this very computer (a test instance). Only for these may the certificate check be skipped from the page;
// for any other address the person is told to get the company certificate installed, or to ask the lead.
export const isLocal = (u: URL) => ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
// The page may ask to skip the check, but the server grants it only for a local address.
export const skipsCheck = (u: URL, asked: unknown) => asked === true && isLocal(u);

const run = (cmd: string, args: string[], input?: string): Promise<{ code: number; out: string }> =>
  new Promise((resolve) => {
    const p = execFile(cmd, args, { encoding: "utf8", timeout: 20_000 }, (err, stdout) => resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: String(stdout ?? "") }));
    if (input !== undefined) p.stdin?.end(input);
  });

// Whether the environment already holds a token. The pages are told only this, never the value.
export const tokenInEnv = () => Boolean(process.env[TOKEN_ENV]);

// The token already on this machine: the environment first, then the keychain. Nothing else.
export async function storedToken(u: URL): Promise<string | undefined> {
  const env = process.env[TOKEN_ENV];
  if (env) return env;
  const r = await run("security", ["find-generic-password", "-a", userInfo().username, "-s", service(u), "-w"]);
  return r.code === 0 && r.out.trim() ? r.out.replace(/\r?\n$/, "") : undefined;
}

export async function saveToken(u: URL, token: string): Promise<boolean> {
  if (!TOKEN_OK.test(token)) return false;
  // `security -i` takes its commands from stdin, so the secret is in no process argument
  const r = await run("security", ["-i"], `add-generic-password -U -a "${userInfo().username}" -s "${service(u)}" -w "${token}"\n`);
  return r.code === 0;
}

interface Reply { status: number; body: any }
function get(u: URL, path: string, token: string, insecure: boolean): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const cap = 5_000_000; // a Jira answer is small; more than this is not Jira
    const deadline = setTimeout(() => req.destroy(Object.assign(new Error("deadline"), { code: "ETIMEDOUT" })), 25_000); // the idle timeout below does not stop a server that drips
    const req = request({ hostname: u.hostname.replace(/^\[|\]$/g, ""), port: u.port || 443, path: u.pathname.replace(/\/$/, "") + path, method: "GET", timeout: 15_000, rejectUnauthorized: !insecure, headers: { authorization: `Bearer ${token}`, accept: "application/json" } }, (res) => {
      let text = "";
      res.on("data", (c) => {
        text += c;
        if (text.length > cap) req.destroy(Object.assign(new Error("too large"), { code: "ETOOBIG" }));
      });
      res.on("end", () => {
        clearTimeout(deadline);
        let body: unknown = null;
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    req.on("error", (e) => {
      clearTimeout(deadline);
      reject(e);
    });
    req.end();
  });
}

// One GET, with a failure told in the user's terms. `token` may come from the page (first time) or the keychain.
async function ask(u: URL, path: string, token: string | undefined, insecure: boolean): Promise<Result<{ reply: Reply }>> {
  if (!token) return fail("no-token", "No Jira token yet.");
  try {
    return { ok: true, reply: await get(u, path, token, insecure) };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (UNTRUSTED.has(code)) {
      return isLocal(u)
        ? fail("untrusted-local", "This Jira uses a security certificate this computer does not know. It runs on this computer, so it is probably a test Jira.")
        : fail("untrusted-cert", `${u.host} uses a security certificate this computer does not know. Ask your IT to install the company certificate on this computer (it is normally already there on a company laptop), or ask the technical lead.`);
    }
    if (OTHER_CERT.has(code)) return fail("cert-problem", `${u.host} presents a certificate that does not match its address or has expired. Ask whoever runs Jira.`);
    return fail("unreachable", `Cannot reach ${u.host}. Check the address and your network or VPN.`);
  }
}

const keyOk = (k: unknown): k is string => typeof k === "string" && /^[A-Z][A-Z0-9_]{0,19}$/.test(k);

// The reply of a Jira call, as a failure when the status says so.
function problem(status: number, what: string, fromEnv = false): Result<never> | undefined {
  if (status === 401 && fromEnv) return fail("bad-token", `Jira did not accept the token in ${TOKEN_ENV}. Change the variable, then start liftoff-ui again.`);
  if (status === 401) return fail("bad-token", "Jira did not accept this token. Create a new one and paste it again.");
  if (status === 403) return fail("no-access", "This token cannot see that. Ask for access, or use another token.");
  if (status === 404) return fail("no-project", what);
  if (status < 200 || status >= 300) return fail("error", `Jira answered with an error (${status}).`);
  return undefined;
}

type In = { url?: unknown; token?: unknown; insecure?: unknown };
const tokenOf = async (u: URL, input: In): Promise<{ typed?: string; token?: string; bad?: Result<never> }> => {
  const typed = typeof input.token === "string" && input.token !== "" ? input.token : undefined;
  if (typed !== undefined && !TOKEN_OK.test(typed)) return { bad: fail("bad-token", "That does not look like a token (no spaces, quotes or backslashes, at least 8 characters).") };
  return { ...(typed !== undefined && { typed }), token: typed ?? (await storedToken(u)) };
};

// The projects this token can see, which also checks the address, the certificate and the token. LiftOff never
// creates a Jira project: the person picks one that exists. A token typed here is kept in the keychain once it works.
export async function listProjects(input: In): Promise<Result<{ projects: { key: string; name: string }[]; saved: boolean }>> {
  const u = parseUrl(input.url);
  if (!u) return fail("bad-url", "Type the address of Jira starting with https://");
  const t = await tokenOf(u, input);
  if (t.bad) return t.bad;
  const r = await ask(u, "/rest/api/2/project", t.token, skipsCheck(u, input.insecure));
  if (!r.ok) return r;
  const bad = problem(r.reply.status, "Jira does not know this address as a Jira.", t.typed === undefined && tokenInEnv());
  if (bad) return bad;
  const projects = (Array.isArray(r.reply.body) ? r.reply.body : []).filter((p: any) => p && keyOk(p.key)).map((p: any) => ({ key: p.key as string, name: String(p.name ?? p.key) }));
  const saved = t.typed !== undefined ? await saveToken(u, t.typed) : false;
  return { ok: true, projects, saved };
}

// The ticket types of one project (the sub-task kinds left out): what the team can write templates for.
export async function projectTypes(input: In & { project?: unknown }): Promise<Result<{ issueTypes: string[]; saved: boolean }>> {
  const u = parseUrl(input.url);
  if (!u) return fail("bad-url", "Type the address of Jira starting with https://");
  if (!keyOk(input.project)) return fail("bad-url", "The project key is the short capital-letter code in front of your ticket numbers, like PROJ in PROJ-123.");
  const t = await tokenOf(u, input);
  if (t.bad) return t.bad;
  const r = await ask(u, `/rest/api/2/project/${input.project}`, t.token, skipsCheck(u, input.insecure));
  if (!r.ok) return r;
  const bad = problem(r.reply.status, `Jira has no project ${input.project} for this token. Check the key.`, t.typed === undefined && tokenInEnv());
  if (bad) return bad;
  const issueTypes: string[] = Array.isArray(r.reply.body?.issueTypes) ? r.reply.body.issueTypes.filter((x: any) => x && !x.subtask && typeof x.name === "string").map((x: any) => x.name as string) : [];
  const saved = t.typed !== undefined ? await saveToken(u, t.typed) : false;
  return { ok: true, issueTypes, saved };
}

// The headings of a real ticket, to start a template from it. Jira wiki (h2.) and Markdown (##) headings both count.
export async function sampleHeadings(input: In & { key?: unknown }): Promise<Result<{ headings: string[]; summary: string }>> {
  const u = parseUrl(input.url);
  if (!u || typeof input.key !== "string" || !/^[A-Z][A-Z0-9_]*-\d+$/.test(input.key)) return fail("bad-url", "Type a ticket key like PROJ-123.");
  const r = await ask(u, `/rest/api/2/issue/${input.key}?fields=summary,description`, await storedToken(u), skipsCheck(u, input.insecure));
  if (!r.ok) return r;
  const bad = problem(r.reply.status, `Jira has no ticket ${input.key}.`);
  if (bad) return bad;
  const text = String(r.reply.body?.fields?.description ?? "");
  const headings = [...text.matchAll(/^\s*(?:h[1-6]\.|#{1,6})\s+(.+?)\s*$/gm)].map((m) => m[1]!.replace(/[*_`]/g, "").trim()).filter(Boolean);
  return { ok: true, headings: [...new Set(headings)], summary: String(r.reply.body?.fields?.summary ?? "") };
}
