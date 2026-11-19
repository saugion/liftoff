import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import { cleanText, headerLine, sha256Hex, sourceFile, ticketBody } from "../../src/brain/source.js";
import { CONFIG, repo } from "../plan/helpers.js";
import { tempDir } from "../helpers.js";

const BRAIN_CONFIG = CONFIG.replace('version: "0.2"', 'version: "0.4"') + "brain: {}\n";
const ISSUE = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    key: "PROJ-123",
    fields: {
      summary: "Reset password by email",
      issuetype: { name: "Story" },
      status: { name: "In Progress" },
      description: "As a user I can reset my password.\n\n## Acceptance criteria\n- The link expires after 30 minutes.\n- One active token per user.",
      comment: { comments: [{ body: "SECRET-COMMENT do not copy" }] },
      assignee: { displayName: "Some Person" },
      customfield_10016: 5,
      ...over,
    },
  });

const setup = (config = BRAIN_CONFIG, files: Record<string, string> = {}) => {
  const dir = repo(config, files);
  expect(run(["brain-init", "--root", dir, "--write"], "/").exitCode).toBe(0);
  return dir;
};
const src = (dir: string, ...args: string[]) => {
  const r = run(["brain-source", "--root", dir, ...args], "/");
  return { exitCode: r.exitCode, body: JSON.parse(r.stdout) as Record<string, any> };
};
const put = (dir: string, rel: string, text: string | Buffer) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
  return rel;
};
const rawFiles = (dir: string) => readdirSync(join(dir, "brain/raw"), { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name !== ".gitkeep").map((e) => e.name);

describe("source helpers", () => {
  it("the header carries the kind, id, origin and the body hash; the name carries 8 hex of it", () => {
    const f = sourceFile("ticket", "PROJ-1", "https://j/browse/PROJ-1", "body\n");
    expect(f.rel).toBe(`raw/tickets/PROJ-1-${sha256Hex("body\n").slice(0, 8)}.md`);
    expect(f.content).toBe(`${headerLine("ticket", "PROJ-1", "https://j/browse/PROJ-1", sha256Hex("body\n"))}\nbody\n`);
    expect(f.content.split("\n")[0]).toMatch(/^<!-- liftoff brain source; kind: ticket; id: PROJ-1; from: https:\/\/j\/browse\/PROJ-1; body-sha256:[0-9a-f]{64} -->$/);
  });
  it("an origin cannot close the header comment early", () => {
    expect(headerLine("doc", "x", "a --> b\nc", "0")).not.toMatch(/-->.*-->/);
  });
  it("ticketBody leaves out empty sections", () => {
    expect(ticketBody({ key: "P-1", summary: "S", issueType: "Bug", description: "", criteria: "" })).toBe("# P-1 S\n\nType: Bug\n");
  });
  it("cleanText: LF-normalizes, strips a BOM, refuses NUL, bad UTF-8 and over 256 KB", () => {
    expect(cleanText(Buffer.from("﻿a\r\nb\rc"))).toEqual({ body: "a\nb\nc" });
    expect(cleanText(Buffer.from([0x61, 0, 0x62]))).toHaveProperty("error");
    expect(cleanText(Buffer.from([0xff, 0xfe, 0x41]))).toHaveProperty("error");
    expect(cleanText(Buffer.alloc(256 * 1024 + 1, "a"))).toHaveProperty("error");
    expect(cleanText(Buffer.alloc(256 * 1024, "a"))).toHaveProperty("body");
  });
});

describe("brain-source ticket", () => {
  it("copies summary, description and acceptance criteria; no status, comments, people or custom fields", () => {
    const dir = setup(BRAIN_CONFIG, { "t.json": ISSUE() });
    const { exitCode, body } = src(dir, "--kind", "ticket", "--file", "t.json", "--write");
    expect(exitCode).toBe(0);
    expect(body).toMatchObject({ ok: true, action: "created", written: true });
    expect(body.path).toMatch(/^brain\/raw\/tickets\/PROJ-123-[0-9a-f]{8}\.md$/);
    const text = readFileSync(join(dir, body.path), "utf8");
    expect(text.split("\n")[0]).toContain("from: https://jira.company.local/browse/PROJ-123");
    expect(text).toContain("# PROJ-123 Reset password by email");
    expect(text).toContain("Type: Story");
    expect(text).toContain("## Description");
    expect(text).toContain("## Acceptance criteria\n\n- The link expires after 30 minutes.");
    for (const leak of ["SECRET-COMMENT", "Some Person", "In Progress", "customfield"]) expect(text).not.toContain(leak);
  });

  it("the acceptance criteria come through the reading map (a custom field for Bug)", () => {
    const dir = setup(BRAIN_CONFIG, { "t.json": ISSUE({ issuetype: { name: "Bug" }, customfield_10201: "Must not crash on empty input", description: "d" }) });
    const { body } = src(dir, "--kind", "ticket", "--file", "t.json", "--write");
    expect(readFileSync(join(dir, body.path), "utf8")).toContain("## Acceptance criteria\n\nMust not crash on empty input");
  });

  it("the same ticket twice is one file; a changed description is a second file", () => {
    const dir = setup(BRAIN_CONFIG, { "t.json": ISSUE(), "t2.json": ISSUE({ description: "changed" }) });
    expect(src(dir, "--kind", "ticket", "--file", "t.json", "--write").body.action).toBe("created");
    expect(src(dir, "--kind", "ticket", "--file", "t.json", "--write").body).toMatchObject({ action: "exists", written: false });
    expect(rawFiles(dir)).toHaveLength(1);
    src(dir, "--kind", "ticket", "--file", "t2.json", "--write");
    expect(rawFiles(dir)).toHaveLength(2);
  });

  it("the output carries the header line and a preview of the stored body, with or without --write", () => {
    const dir = setup(BRAIN_CONFIG, { "t.json": ISSUE() });
    const dry = src(dir, "--kind", "ticket", "--file", "t.json").body;
    expect(dry.header).toMatch(/^<!-- liftoff brain source; kind: ticket; id: PROJ-123; from: https:\/\/jira\.company\.local\/browse\/PROJ-123; body-sha256:[0-9a-f]{64} -->$/);
    expect(dry.preview).toContain("# PROJ-123 Reset password by email");
    expect(dry.preview).toContain("The link expires after 30 minutes.");
    expect(dry.previewTruncated).toBe(false);
    expect(dry.preview).not.toContain("SECRET-COMMENT");
    expect(src(dir, "--kind", "ticket", "--file", "t.json", "--write").body.header).toBe(dry.header);
  });
  it("a long source is previewed in its first 40 lines and says it was cut", () => {
    const dir = setup(BRAIN_CONFIG, { "long.md": Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n") + "\n" });
    const r = src(dir, "--kind", "doc", "--file", "long.md").body;
    expect(r.preview.split("\n")).toHaveLength(40);
    expect(r.previewTruncated).toBe(true);
  });

  it("a dry run writes nothing and says `create`", () => {
    const dir = setup(BRAIN_CONFIG, { "t.json": ISSUE() });
    expect(src(dir, "--kind", "ticket", "--file", "t.json").body).toMatchObject({ action: "create", written: false });
    expect(rawFiles(dir)).toEqual([]);
  });

  it("no tracker -> no-tracker; a key from an unknown project, or bad JSON -> source-invalid", () => {
    const noTracker = setup("liftoff: 1\nplugin: { version: \"0.4\" }\nproject: { name: a, kind: new }\nagents: { targets: [claude-code] }\nbrain: {}\n", { "t.json": ISSUE() });
    expect(src(noTracker, "--kind", "ticket", "--file", "t.json").body.errors[0].code).toBe("no-tracker");
    const dir = setup(BRAIN_CONFIG, { "t.json": ISSUE().replace("PROJ-123", "OTHER-1"), "bad.json": "{nope" });
    expect(src(dir, "--kind", "ticket", "--file", "t.json").body.errors[0].code).toBe("source-invalid");
    expect(src(dir, "--kind", "ticket", "--file", "bad.json").body.errors[0].code).toBe("source-invalid");
  });

  it("a credential in the description is refused: source-secret, nothing written", () => {
    const dir = setup(BRAIN_CONFIG, { "t.json": ISSUE({ description: "use glpat-abcdefghij1234567890 to log in" }) });
    const { exitCode, body } = src(dir, "--kind", "ticket", "--file", "t.json", "--write");
    expect(exitCode).toBe(1);
    expect(body.errors[0].code).toBe("source-secret");
    expect(body.errors[0].message).toContain("not a guarantee");
    expect(rawFiles(dir)).toEqual([]);
  });
});

describe("brain-source plan, mr, doc", () => {
  it("a plan: verbatim copy, id from the plan's front matter, CRLF stored as LF", () => {
    const dir = setup(BRAIN_CONFIG, { ".liftoff/plans/PROJ-123.md": "---\r\nticket: PROJ-123\r\nstatus: approved\r\n---\r\n# Plan\r\n- [ ] one\r\n" });
    const { body } = src(dir, "--kind", "plan", "--file", ".liftoff/plans/PROJ-123.md", "--write");
    expect(body.path).toMatch(/^brain\/raw\/plans\/PROJ-123-[0-9a-f]{8}\.md$/);
    const text = readFileSync(join(dir, body.path), "utf8");
    expect(text).not.toContain("\r");
    expect(text).toContain("# Plan\n- [ ] one\n");
  });

  it("an MR description: id from --key, or from the file name", () => {
    const dir = setup(BRAIN_CONFIG, { ".liftoff/plans/PROJ-9.mr.md": "## Summary\nDid the thing\n", "m.md": "text\n" });
    expect(src(dir, "--kind", "mr", "--file", ".liftoff/plans/PROJ-9.mr.md", "--write").body.path).toMatch(/mrs\/PROJ-9-/);
    expect(src(dir, "--kind", "mr", "--file", "m.md", "--key", "PROJ-5", "--write").body.path).toMatch(/mrs\/PROJ-5-/);
    expect(src(dir, "--kind", "mr", "--file", "m.md").body.errors[0].code).toBe("source-invalid");
  });

  it("a doc: id is the file name's slug", () => {
    const dir = setup(BRAIN_CONFIG, { "docs/Release Notes.md": "# Notes\n" });
    expect(src(dir, "--kind", "doc", "--file", "docs/Release Notes.md", "--write").body.path).toMatch(/docs\/release-notes-[0-9a-f]{8}\.md$/);
  });

  it("a doc under the brain, under .liftoff, or outside the repo -> source-invalid", () => {
    const outside = tempDir();
    writeFileSync(join(outside, "x.md"), "hi\n");
    const dir = setup(BRAIN_CONFIG, { "brain/wiki/p.md": "x\n", ".liftoff/n.md": "x\n" });
    for (const f of ["brain/wiki/p.md", ".liftoff/n.md", join(outside, "x.md")]) {
      expect(src(dir, "--kind", "doc", "--file", f, "--write").body.errors[0].code, f).toBe("source-invalid");
    }
    expect(rawFiles(dir)).toEqual([]);
  });

  it("a symlink that points outside the repo is refused", () => {
    const outside = tempDir();
    writeFileSync(join(outside, "x.md"), "hi\n");
    const dir = setup();
    symlinkSync(join(outside, "x.md"), join(dir, "link.md"));
    expect(src(dir, "--kind", "doc", "--file", "link.md").body.errors[0].code).toBe("source-invalid");
  });

  it("a 300 KB file, a binary file and a token are refused, nothing written", () => {
    const dir = setup(BRAIN_CONFIG, { "big.md": "a".repeat(300 * 1024), "token.md": "key: ghp_abcdefghijklmnopqrstu\n" });
    put(dir, "bin.md", Buffer.from([0x68, 0, 0x69]));
    for (const [f, code] of [["big.md", "source-invalid"], ["bin.md", "source-invalid"], ["token.md", "source-secret"]]) {
      const { exitCode, body } = src(dir, "--kind", "doc", "--file", f!, "--write");
      expect([exitCode, body.errors[0].code], f).toEqual([1, code]);
    }
    expect(rawFiles(dir)).toEqual([]);
  });

  it("an existing raw file with the same name but other content is never overwritten", () => {
    const dir = setup(BRAIN_CONFIG, { "d.md": "one\n" });
    const first = src(dir, "--kind", "doc", "--file", "d.md", "--write").body.path;
    writeFileSync(join(dir, first), "tampered\n");
    const again = src(dir, "--kind", "doc", "--file", "d.md", "--write");
    expect(again.exitCode).toBe(1);
    expect(readFileSync(join(dir, first), "utf8")).toBe("tampered\n");
  });
});

describe("brain-source usage and guards", () => {
  it("--kind or --file missing, or an unknown kind -> usage, exit 2", () => {
    const dir = setup();
    for (const args of [["--file", "x"], ["--kind", "doc"], ["--kind", "video", "--file", "x"]]) {
      const r = src(dir, ...args);
      expect([r.exitCode, r.body.errors[0].code], args.join(" ")).toEqual([2, "usage"]);
    }
  });
  it("no brain -> no-brain; brain not initialised -> brain-invalid", () => {
    expect(src(repo(CONFIG.replace('"0.2"', '"0.4"'), { "d.md": "x\n" }), "--kind", "doc", "--file", "d.md").body.errors[0].code).toBe("no-brain");
    expect(src(repo(BRAIN_CONFIG, { "d.md": "x\n" }), "--kind", "doc", "--file", "d.md").body.errors[0].code).toBe("brain-invalid");
  });
  it("--write is accepted by brain-source", () => {
    const dir = setup(BRAIN_CONFIG, { "d.md": "x\n" });
    expect(src(dir, "--kind", "doc", "--file", "d.md", "--write").exitCode).toBe(0);
  });
});
