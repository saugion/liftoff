import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The certificate check is skipped for a Jira on this computer and for no other: tested at the call that makes the request
// (the real https module and the real keychain are replaced, so nothing here goes out or is stored).
const calls: { hostname: string; rejectUnauthorized: boolean }[] = [];
vi.mock("node:https", () => ({
  request: (opts: { hostname: string; rejectUnauthorized: boolean }, cb: (res: EventEmitter & { statusCode: number }) => void) => {
    calls.push({ hostname: opts.hostname, rejectUnauthorized: opts.rejectUnauthorized });
    const req = Object.assign(new EventEmitter(), { end() { const res = Object.assign(new EventEmitter(), { statusCode: 200 }); cb(res); res.emit("data", "[]"); res.emit("end"); }, destroy() {} });
    return req;
  },
}));
vi.mock("node:child_process", () => ({ execFile: (_c: string, _a: string[], _o: unknown, done: (e: null, out: string) => void) => { done(null, ""); return { stdin: { end() {} } }; } }));

const { listProjects } = await import("../../ui/connect.js");
beforeEach(() => void (calls.length = 0));

describe("listProjects and the certificate check", () => {
  it.each(["https://127.0.0.1:8443", "https://localhost", "https://[::1]:8443"])("%s: the page asked to skip it and may", async (url) => {
    await listProjects({ url, token: "abcdefgh12345", insecure: true });
    expect(calls[0]!.rejectUnauthorized).toBe(false);
  });
  it.each(["https://jira.example.com", "https://10.0.0.5", "https://127.0.0.1.evil.example.com", "https://localhost.example.com"])("%s: the page asked and is refused, the check stays on", async (url) => {
    await listProjects({ url, token: "abcdefgh12345", insecure: true });
    expect(calls[0]!.rejectUnauthorized).toBe(true);
  });
  it("without the ask, even a local Jira is checked", async () => {
    await listProjects({ url: "https://127.0.0.1:8443", token: "abcdefgh12345" });
    expect(calls[0]!.rejectUnauthorized).toBe(true);
  });
  it("an IPv6 address reaches the request without its brackets (they are part of the URL, not of the host name)", async () => {
    await listProjects({ url: "https://[::1]:8443", token: "abcdefgh12345", insecure: true });
    expect(calls[0]!.hostname).toBe("::1");
  });
});
