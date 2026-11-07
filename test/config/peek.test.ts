import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { peekConfig, peekText } from "../../src/config/index.js";
import { tempDir } from "../helpers.js";

describe("peekText: what compat and pin checks need, without the schema", () => {
  it("reads liftoff and plugin.version even when the rest is for a newer LiftOff", () => {
    const text = 'liftoff: 2\nplugin:\n  version: "9.1"\nbrand-new: [1, 2]\nproject: { shiny: true }\n';
    expect(peekText(text)).toEqual({ formatVersion: 2, pluginVersion: "9.1" });
  });

  it("a normal config", () => {
    expect(peekText('liftoff: 1\nplugin:\n  version: "0.1"\n')).toEqual({ formatVersion: 1, pluginVersion: "0.1" });
  });

  it.each([
    ["liftoff is not an integer", "liftoff: 1.5\nplugin:\n  version: '1.0'\n", { pluginVersion: "1.0" }],
    ["liftoff is a string", "liftoff: '2'\n", {}],
    ["plugin.version is a number (unquoted)", "liftoff: 1\nplugin:\n  version: 1.4\n", { formatVersion: 1 }],
    ["plugin is not a mapping", "liftoff: 1\nplugin: 3\n", { formatVersion: 1 }],
    ["plugin is null", "liftoff: 1\nplugin:\n", { formatVersion: 1 }],
  ])("%s: only what is usable is returned", (_name, text, expected) => {
    expect(peekText(text)).toEqual(expected);
  });

  it.each([
    ["a YAML syntax error", "liftoff: [unclosed\n"],
    ["a duplicate key", "liftoff: 2\nliftoff: 2\n"],
    ["two documents", "---\nliftoff: 2\n---\nliftoff: 2\n"],
    ["an empty file", ""],
    ["a comment only", "# nothing\n"],
    ["a scalar root", "42\n"],
    ["a list root", "- liftoff\n"],
  ])("%s: nothing is guessed, the full read reports it", (_name, text) => {
    expect(peekText(text)).toEqual({});
  });
});

describe("peekConfig", () => {
  it("reads a file, ignoring a BOM and CRLF", () => {
    const file = join(tempDir(), "liftoff.yaml");
    writeFileSync(file, '﻿liftoff: 2\r\nplugin:\r\n  version: "3.0"\r\n');
    expect(peekConfig(file)).toEqual({ formatVersion: 2, pluginVersion: "3.0" });
  });

  it("a missing, unreadable or non-UTF-8 file gives nothing, not a throw", () => {
    const dir = tempDir();
    expect(peekConfig(join(dir, "nope.yaml"))).toEqual({});
    const bad = join(dir, "bad.yaml");
    writeFileSync(bad, Buffer.from([0xff, 0xfe, 0x00]));
    expect(peekConfig(bad)).toEqual({});
    expect(peekConfig(dir)).toEqual({});
  });
});
