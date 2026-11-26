import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateConfig } from "../../src/config/index.js";
import { brainExtras, claudeSettings, mcpFiles, type ByHand } from "../../ui/scaffold.js";
import { tempDir } from "../helpers.js";

// A settings file LiftOff cannot read (comments, a trailing comma) belongs to a person: it is never written over.
const ASSETS = join("plugin", "skills", "liftoff-init", "assets");
const THEIRS = '// my settings\n{\n  "permissions": { "deny": ["Read(./secrets/**)"] },\n}\n';
const proposals = { claudeSettings: { permissions: { deny: ["Edit(/brain/raw/**)"] } }, vscodeSettings: { "files.readonlyInclude": { "brain/raw/**": true } }, gitattributes: "brain/log merge=union", agentsMd: "x" };
const put = (root: string, rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const get = (root: string, rel: string) => readFileSync(join(root, rel), "utf8");
const config = () => {
  const r = validateConfig({
    liftoff: 1, plugin: { version: "0.6.0" }, project: { name: "x", kind: "new" }, agents: { targets: ["claude-code", "copilot"] },
    tracker: { kind: "jira-dc", url: "https://jira.example.com", project: "PROJ", server: { version: "0.23.1", sslVerify: true, readOnly: false }, issueTypes: [{ name: "Story", template: "## Context\n", readingMap: { acceptanceCriteria: { heading: "Context" } } }] },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};

describe("a settings file that cannot be read", () => {
  it("is left as it is by every writer, and what is missing is returned", () => {
    const root = tempDir("liftoff-settings-");
    const files = [".claude/settings.json", ".mcp.json", ".vscode/mcp.json", ".vscode/settings.json"];
    for (const f of files) put(root, f, THEIRS);
    const byHand: ByHand[] = [];
    expect(claudeSettings(root, ASSETS, byHand)).toBeUndefined();
    expect(mcpFiles(root, config(), byHand)).toEqual([]);
    expect(brainExtras(root, proposals, byHand)).toEqual([".gitattributes"]);
    for (const f of files) expect(get(root, f)).toBe(THEIRS);
    expect(byHand.map((b) => b.file)).toEqual([".claude/settings.json", ".mcp.json", ".vscode/mcp.json", ".claude/settings.json", ".vscode/settings.json"]);
    expect(JSON.stringify(byHand[0]!.add)).toContain("liftoff@liftoff");
    expect(JSON.stringify(byHand[1]!.add)).toContain('"mcpServers":{"liftoff-jira"');
    expect(byHand[4]!.add).toEqual(proposals.vscodeSettings);
  });

  it.each(["[]", '"text"', "{ nope"])("%j is not a settings object either", (text) => {
    const root = tempDir("liftoff-settings-");
    put(root, ".claude/settings.json", text);
    const byHand: ByHand[] = [];
    claudeSettings(root, ASSETS, byHand);
    expect(get(root, ".claude/settings.json")).toBe(text);
    expect(byHand).toHaveLength(1);
  });

  it("an empty file is filled, and a byte order mark does not make one unreadable", () => {
    const root = tempDir("liftoff-settings-");
    put(root, ".claude/settings.json", "\n");
    put(root, ".mcp.json", '﻿{ "mcpServers": { "mine": { "command": "x" } } }');
    const byHand: ByHand[] = [];
    expect(claudeSettings(root, ASSETS, byHand)).toBe(".claude/settings.json");
    expect(mcpFiles(root, config(), byHand)).toContain(".mcp.json");
    expect(Object.keys(JSON.parse(get(root, ".mcp.json")).mcpServers)).toEqual(["mine", "liftoff-jira"]);
    expect(byHand).toEqual([]);
  });
});
