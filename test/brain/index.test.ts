import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { INDEX_MARKER, buildIndex } from "../../src/brain/index.js";
import { run } from "../../src/cli/main.js";
import { makeRepo } from "../cli/repo.js";
import { tempDir } from "../helpers.js";

const page = (title: string, type: string, summary = `About ${title}.`) =>
  `---\ntitle: ${title}\ntype: ${type}\nupdated: 2026-11-19\nsummary: ${summary}\nsources: [raw/tickets/X-1-aaaaaaaa.md]\n---\n# ${title}\n`;

describe("buildIndex", () => {
  it("an empty wiki is the marker, a heading and 'No pages yet'", () => {
    expect(buildIndex([])).toEqual({ content: `${INDEX_MARKER}\n\n# Index\n\n_No pages yet._\n`, skipped: [] });
  });

  it("four types, in the fixed order, each sorted by title then path", () => {
    const { content, skipped } = buildIndex([
      { path: "topics/zeta.md", text: page("Zeta", "topic") },
      { path: "learnings/b.md", text: page("beta", "learning") },
      { path: "modules/api.md", text: page("API", "module", "The HTTP API.") },
      { path: "learnings/a.md", text: page("Alpha", "learning") },
      { path: "decisions/d.md", text: page("Use Postgres", "decision") },
      { path: "learnings/a2.md", text: page("Alpha", "learning") },
    ]);
    expect(skipped).toEqual([]);
    expect(content).toBe(
      [
        INDEX_MARKER, "", "# Index", "",
        "## Modules", "", "- [API](wiki/modules/api.md) - The HTTP API.", "",
        "## Decisions", "", "- [Use Postgres](wiki/decisions/d.md) - About Use Postgres.", "",
        "## Learnings", "", "- [Alpha](wiki/learnings/a.md) - About Alpha.", "- [Alpha](wiki/learnings/a2.md) - About Alpha.", "- [beta](wiki/learnings/b.md) - About beta.", "",
        "## Topics", "", "- [Zeta](wiki/topics/zeta.md) - About Zeta.", "",
      ].join("\n"),
    );
  });

  it("a type without pages has no heading", () => {
    expect(buildIndex([{ path: "topics/t.md", text: page("T", "topic") }]).content).not.toContain("## Modules");
  });

  it("a broken page is skipped and reported, the rest is indexed", () => {
    const { content, skipped } = buildIndex([
      { path: "topics/ok.md", text: page("Ok", "topic") },
      { path: "topics/bad.md", text: "# no front matter\n" },
    ]);
    expect(content).toContain("[Ok](wiki/topics/ok.md)");
    expect(content).not.toContain("bad.md");
    expect(skipped).toEqual([{ path: "topics/bad.md", errors: [expect.stringContaining("no front matter")] }]);
  });

  it("the same pages in a different order give the same bytes", () => {
    const pages = ["a", "b", "c", "d"].map((n, i) => ({ path: `topics/${n}.md`, text: page(`T${i % 2}`, "topic") }));
    expect(buildIndex([...pages].reverse()).content).toBe(buildIndex(pages).content);
  });

  it("brackets in a title cannot break the link", () => {
    expect(buildIndex([{ path: "topics/t.md", text: page('"A [b] c"', "topic") }]).content).toContain("[A \\[b\\] c](wiki/topics/t.md)");
  });
});

const repo = () => makeRepo({ targets: "[claude-code]", modules: [], pluginVersion: "0.4", extra: "brain: {}\n" });
const idx = (dir: string, ...extra: string[]) => {
  const r = run(["brain-index", "--root", dir, ...extra], "/");
  return { exitCode: r.exitCode, body: JSON.parse(r.stdout) as Record<string, any> };
};
const init = (dir: string) => run(["brain-init", "--root", dir, "--write"], "/");
const put = (dir: string, rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

describe("brain-index command", () => {
  it("a fresh scaffold is not stale: changed false", () => {
    const dir = repo();
    init(dir);
    expect(idx(dir).body).toMatchObject({ ok: true, changed: false, skipped: [] });
  });

  it("dry run reports the change and writes nothing; --write writes; a second --write is a no-op", () => {
    const dir = repo();
    init(dir);
    put(dir, "brain/wiki/topics/t.md", page("T", "topic"));
    const dry = idx(dir);
    expect(dry.body).toMatchObject({ changed: true, written: false });
    expect(readFileSync(join(dir, "brain/index.md"), "utf8")).toContain("_No pages yet._");
    const w = idx(dir, "--write");
    expect(w.body).toMatchObject({ changed: true, written: true });
    expect(readFileSync(join(dir, "brain/index.md"), "utf8")).toBe(dry.body.content);
    expect(idx(dir, "--write").body).toMatchObject({ changed: false, written: false });
  });

  it("lists a broken page in skipped and still exits 0", () => {
    const dir = repo();
    init(dir);
    put(dir, "brain/wiki/topics/bad.md", "oops\n");
    const { exitCode, body } = idx(dir);
    expect(exitCode).toBe(0);
    expect(body.skipped).toEqual([expect.objectContaining({ path: "topics/bad.md" })]);
  });

  it("ignores non-markdown files such as .gitkeep", () => {
    const dir = repo();
    init(dir);
    expect(idx(dir).body.skipped).toEqual([]);
  });

  it("no brain section -> no-brain; no wiki folder -> brain-invalid; symlink -> brain-invalid", () => {
    const none = makeRepo({ targets: "[claude-code]", modules: [], pluginVersion: "0.4" });
    expect(idx(none).body.errors[0].code).toBe("no-brain");
    const bare = repo();
    expect(idx(bare).body.errors[0]).toMatchObject({ code: "brain-invalid", file: "brain/wiki" });
    const linked = repo();
    init(linked);
    symlinkSync(tempDir(), join(linked, "brain/wiki/escape"));
    expect(idx(linked).body.errors[0]).toMatchObject({ code: "brain-invalid", file: "brain/wiki/escape" });
  });

  it("--write on brain-init and brain-index is accepted; elsewhere it is usage", () => {
    expect(run(["validate", "--root", repo(), "--write"], "/").exitCode).toBe(2);
  });
});
