import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const skill = (n: string) => readFileSync(join("plugin", "skills", n, "SKILL.md"), "utf8").replace(/\s+/g, " ");

describe("what a teammate is told after Init, and how the Jira token is kept", () => {
  it("Init sends a teammate to Connect, and does not tell them to fix Jira first", () => {
    const init = skill("liftoff-init");
    for (const x of ["Next: connect to Jira", "*connect me to Jira*", "Connect is what connects it"]) expect(init, x).toContain(x);
  });
  it("the token lives in an environment variable or the Keychain, nowhere else, and Connect never takes it", () => {
    const connect = skill("liftoff-connect");
    for (const x of ["an environment variable or the Keychain", "`LIFTOFF_JIRA_TOKEN` environment variable", "restarts the agent", "You never see the token", "that is a different problem"]) expect(connect, x).toContain(x);
    expect(connect).not.toMatch(/openssl|add-trusted-cert|NODE_EXTRA_CA_CERTS|\.liftoff\/ca/);
  });
  it("Connect knows the three homes of GitHub Copilot", () => {
    const connect = skill("liftoff-connect");
    for (const x of ["`.vscode/mcp.json`", "Copilot command line", "IntelliJ", "paste"]) expect(connect, x).toContain(x);
  });
});
