import { describe, expect, it } from "vitest";
import { hostOf } from "../../ui/detect.js";

describe("the GitLab host out of what a person pastes", () => {
  it.each([
    ["gitlab.example.com", "gitlab.example.com"],
    ["https://gitlab.example.com", "gitlab.example.com"],
    ["https://GitLab.Example.com/group/app.git", "gitlab.example.com"],
    [" https://gitlab.example.com:8443/ ", "gitlab.example.com:8443"],
    ["https://user@gitlab.example.com/x", "gitlab.example.com"],
    ["git@gitlab.example.com:group/app.git", "gitlab.example.com"],
    ["ssh://git@gitlab.example.com:2222/group/app.git", "gitlab.example.com"],
  ])("%s", (pasted, host) => expect(hostOf(pasted)).toBe(host));
});
