import { appendFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../helpers.js";
import { CONFIG, repo } from "../plan/helpers.js";
import { CFG, call, check, healthy, page, put } from "./helpers.js";

const codes = (list: any[]) => list.map((f) => f.code);

describe("brain-check structure", () => {
  it("a fresh brain-init is ok with no findings", () => {
    const dir = repo(CFG);
    call(dir, "brain-init", "--write");
    const { exitCode, body } = check(dir);
    expect(exitCode).toBe(0);
    expect(body).toMatchObject({ ok: true, errors: [], warnings: [], stats: { pages: 0, raw: 0, logs: 0 }, bySource: {} });
  });

  it("the healthy fixture is ok, with stats and bySource", () => {
    const { dir, raw } = healthy();
    const { exitCode, body } = check(dir);
    expect(body.errors).toEqual([]);
    expect(body.warnings).toEqual([]);
    expect(exitCode).toBe(0);
    expect(body.stats).toEqual({ pages: 2, raw: 1, logs: 1 });
    expect(body.bySource).toEqual({ [`brain/${raw}`]: ["brain/wiki/learnings/other.md", "brain/wiki/learnings/reset.md"].sort() });
  });

  it("no brain section -> no-brain", () => {
    expect(check(repo(CONFIG.replace('"0.2"', '"0.4"'))).body.errors[0].code).toBe("no-brain");
  });

  // One mutation per code. Each must produce that code, on the right file and line, and nothing else.
  const mutations: [string, "errors" | "warnings", string, number | undefined, (dir: string, raw: string) => void][] = [
    ["brain-missing", "errors", "brain/raw", undefined, (d) => rmSync(join(d, "brain/raw"), { recursive: true })],
    ["symlink", "errors", "brain/wiki/escape", undefined, (d) => symlinkSync(tempDir(), join(d, "brain/wiki/escape"))],
    ["page-name", "errors", "brain/wiki/learnings/Bad_Name.md", undefined, (d) => put(d, "brain/wiki/learnings/Bad_Name.md", "x\n")],
    ["frontmatter", "errors", "brain/wiki/learnings/other.md", 1, (d, raw) => put(d, "brain/wiki/learnings/other.md", page("Other", [raw], "[r](reset.md)\n").replace("type: learning", "type: story"))],
    ["source-missing", "errors", "brain/wiki/learnings/other.md", 1, (d) => put(d, "brain/wiki/learnings/other.md", page("Other", ["raw/docs/nope.md"], "[r](reset.md)\n"))],
    ["source-unmarked", "errors", "brain/raw/docs/hand-made.md", undefined, (d) => put(d, "brain/raw/docs/hand-made.md", "typed by hand\n")],
    ["link-broken", "errors", "brain/wiki/learnings/reset.md", 9, (d, raw) => put(d, "brain/wiki/learnings/reset.md", page("Reset", [raw], "See [other](other.md) and [gone](gone.md).\n"))],
    ["index-stale", "errors", "brain/index.md", undefined, (d) => appendFileSync(join(d, "brain/index.md"), "\nextra\n")],
    ["hot-too-long", "errors", "brain/hot.md", undefined, (d) => put(d, "brain/hot.md", Array.from({ length: 9 }, (_, i) => `- line ${i}`).join("\n") + "\n")],
    ["orphan", "warnings", "brain/wiki/topics/lonely.md", undefined, (d, raw) => {
      put(d, "brain/wiki/topics/lonely.md", page("Lonely", [raw]).replace("learning", "topic"));
      call(d, "brain-index", "--write");
    }],
    ["duplicate-title", "warnings", "brain/wiki/learnings/reset.md", 1, (d, raw) => {
      put(d, "brain/wiki/learnings/other.md", page("RESET", [raw], "[r](reset.md)\n"));
      call(d, "brain-index", "--write");
    }],
    ["module-unknown", "warnings", "brain/wiki/learnings/other.md", 1, (d, raw) => {
      put(d, "brain/wiki/learnings/other.md", page("Other", [raw], "[r](reset.md)\n", "module: web\n"));
      call(d, "brain-index", "--write");
    }],
    ["log-format", "warnings", "brain/log/2026-11.md", 2, (d) => appendFileSync(join(d, "brain/log/2026-11.md"), "who knows what happened here\n")],
  ];
  it.each(mutations)("%s", (code, level, file, line, mutate) => {
    const { dir, raw } = healthy();
    mutate(dir, raw);
    const { exitCode, body } = check(dir);
    const hits = body[level].filter((f: any) => f.code === code);
    expect(hits.length, JSON.stringify(body)).toBeGreaterThan(0);
    expect(hits[0].file).toBe(file);
    if (line !== undefined) expect(hits[0].line).toBe(line);
    expect(hits[0].level).toBe(level === "errors" ? "error" : "warning");
    expect(exitCode).toBe(level === "errors" ? 1 : 0);
    // nothing else of the other level appears (warnings alone keep exit 0)
    if (level === "warnings") expect(body.errors).toEqual([]);
  });

  it("the raw-unreferenced mutation really leaves an uncited raw file", () => {
    const { dir } = healthy();
    put(dir, "spare.md", "spare text\n");
    call(dir, "brain-source", "--kind", "doc", "--file", "spare.md", "--write");
    const { body } = check(dir);
    expect(codes(body.warnings)).toEqual(["raw-unreferenced"]);
    expect(body.warnings[0].file).toMatch(/^brain\/raw\/docs\/spare-[0-9a-f]{8}\.md$/);
  });

  it("a link outside the brain, or a link in hot.md or README.md, is checked too", () => {
    const { dir } = healthy();
    put(dir, "brain/hot.md", "# Hot\n\n- [escape](../liftoff.yaml)\n- [reset](wiki/learnings/reset.md)\n");
    put(dir, "brain/README.md", "[nope](missing.md)\n");
    const { body } = check(dir);
    expect(body.errors.map((e: any) => [e.code, e.file, e.line])).toEqual([["link-broken", "brain/README.md", 1], ["link-broken", "brain/hot.md", 3]]);
  });

  it("links in code spans and external links are not checked; an anchor is stripped", () => {
    const { dir } = healthy();
    put(dir, "brain/hot.md", "# Hot\n\n- `[x](gone.md)` [web](https://example.com) [a](wiki/learnings/reset.md#top)\n");
    expect(check(dir).body.errors).toEqual([]);
  });

  it("a source that escapes the brain or is not under raw/ is source-missing", () => {
    const { dir, raw } = healthy();
    for (const bad of ["../liftoff.yaml", "wiki/learnings/reset.md", raw.replace("raw/", "raw/../")]) {
      put(dir, "brain/wiki/learnings/other.md", page("Other", [bad], "[r](reset.md)\n"));
      expect(codes(check(dir).body.errors), bad).toContain("source-missing");
    }
  });

  it("log lines: retract may name a removed file; any other op naming a missing file warns", () => {
    const { dir } = healthy();
    put(dir, "brain/log/2026-11.md", "- 2026-11-20 retract raw/docs/gone-aaaaaaaa.md: wiki/learnings/reset.md\n- 2026-11-20 ingest raw/docs/gone-aaaaaaaa.md\n");
    const { body } = check(dir);
    expect(body.warnings.map((w: any) => [w.code, w.line])).toEqual([["log-format", 2]]);
  });

  it("a batch log line lists every raw file before the colon; a missing one in the list still warns", () => {
    const { dir, raw } = healthy();
    put(dir, "brain/log/2026-11.md", `- 2026-11-20 ingest ${raw}, ${raw}: wiki/learnings/reset.md\n- 2026-11-20 ingest ${raw}, raw/docs/gone-aaaaaaaa.md: wiki/learnings/reset.md\n`);
    const { body } = check(dir);
    expect(body.warnings.map((w: any) => [w.code, w.line, /gone/.test(w.message)])).toEqual([["log-format", 2, true]]);
  });

  it("findings are sorted by file then line, so the output is stable", () => {
    const { dir } = healthy();
    put(dir, "brain/wiki/learnings/reset.md", page("Reset", ["raw/docs/a.md", "raw/docs/b.md"], "[o](other.md)\n"));
    const files = check(dir).body.errors.map((e: any) => e.file);
    expect(files).toEqual([...files].sort());
  });

  it("a symlinked brain folder is a single symlink error", () => {
    const dir = repo(CFG);
    symlinkSync(tempDir(), join(dir, "brain"));
    const { exitCode, body } = check(dir);
    expect([exitCode, codes(body.errors)]).toEqual([1, ["symlink"]]);
  });
});
