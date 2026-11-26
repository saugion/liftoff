import { describe, expect, it } from "vitest";
import { cleanUrl, ignoreLine, workspaceDoc } from "../../ui/workspace.js";

describe("the clone address written for the team", () => {
  it.each([
    ["https://gitlab.example.com/team/api.git", "https://gitlab.example.com/team/api.git"],
    ["https://oauth2:glsecret@gitlab.example.com/team/api.git", "https://gitlab.example.com/team/api.git"],
    ["https://sometoken@gitlab.example.com:8443/team/api.git", "https://gitlab.example.com:8443/team/api.git"],
    ["https://gitlab.example.com/team/api.git?private_token=abc#x", "https://gitlab.example.com/team/api.git"],
    ["ssh://git:secret@gitlab.example.com:2222/team/api.git", "ssh://git@gitlab.example.com:2222/team/api.git"],
    ["git@gitlab.example.com:team/api.git", "git@gitlab.example.com:team/api.git"],
  ])("%s keeps no secret", (from, to) => expect(cleanUrl(from)).toBe(to));

  it.each(["/home/me/api.git", "file:///home/me/api.git", "ext::sh -c id", "--upload-pack=x", "https://h/a b", "https://h/$(id)", "https://h/a;id", "git@host:`id`", ""])(
    "%j is not written", (from) => expect(cleanUrl(from)).toBeUndefined());

  it("names the folder in each command, and lists the ones with nothing to clone from", () => {
    const doc = workspaceDoc([{ path: "api", url: "https://h/api.git" }, { path: "my app", url: "https://h/app.git" }, { path: "local" }]);
    expect(doc).toContain("git clone https://h/api.git api\n");
    expect(doc).toContain("git clone https://h/app.git 'my app'\n");
    expect(doc).toContain("- `local`");
  });

  it("writes no command for a folder name a shell would read as something else", () => {
    const doc = workspaceDoc([{ path: "it's", url: "https://h/x.git" }]);
    expect(doc).not.toContain("git clone https://h/x.git");
    expect(doc).toContain("- `it's`: https://h/x.git");
  });

  it("ignores exactly that folder at the top, whatever its name holds", () => {
    expect(ignoreLine("api")).toBe("/api/");
    expect(ignoreLine("a[1]*")).toBe("/a\\[1\\]\\*/");
  });
});
