import { lookup } from "node:dns";
import { get } from "node:https";
import { connect } from "node:net";
import { describe, expect, it } from "vitest";

describe("no-network setup", () => {
  it("blocks named imports of net, dns and https", () => {
    expect(() => connect(80, "127.0.0.1")).toThrow(/network disabled/);
    expect(() => lookup("example.com", () => {})).toThrow(/network disabled/);
    expect(() => get("https://example.com")).toThrow(/network disabled/);
  });

  it("blocks fetch", async () => {
    await expect(fetch("http://127.0.0.1:9")).rejects.toThrow(/network disabled/);
  });
});
