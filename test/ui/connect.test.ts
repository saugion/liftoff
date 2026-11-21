import { describe, expect, it } from "vitest";
import { isLocal, parseUrl, skipsCheck } from "../../ui/connect.js";

describe("which Jira may have its certificate check skipped from the page", () => {
  const u = (s: string) => parseUrl(s)!;
  it.each(["https://127.0.0.1:8443", "https://localhost", "https://localhost:8443/jira", "https://[::1]:8443"])("%s is on this computer", (s) => {
    expect(isLocal(u(s))).toBe(true);
    expect(skipsCheck(u(s), true)).toBe(true);
  });
  it.each(["https://jira.example.com", "https://10.0.0.5", "https://127.0.0.1.evil.example.com", "https://localhost.example.com", "https://192.168.1.10:8443"])("%s is not, whatever the page asks", (s) => {
    expect(isLocal(u(s))).toBe(false);
    expect(skipsCheck(u(s), true)).toBe(false);
  });
  it("is granted only when the page asked for it, with exactly true", () => {
    for (const asked of [false, undefined, "true", 1, null]) expect(skipsCheck(u("https://127.0.0.1:8443"), asked)).toBe(false);
  });
  it("only an https address with no credentials is an address", () => {
    for (const bad of ["http://jira.example.com", "https://user:pw@jira.example.com", "https://jira.example.com/?a=1", "jira.example.com", "", 5]) expect(parseUrl(bad as string)).toBeUndefined();
    expect(parseUrl(" https://Jira.Example.com/ ")?.host).toBe("jira.example.com");
  });
});
