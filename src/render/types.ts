import type { Agent } from "../config/index.js";

export interface RenderedFile {
  path: string; // relative to the repo root, forward slashes, normalized
  content: string; // LF, first line is the marker, ends with a single "\n"
  agent: Agent;
}

export interface RenderOptions {
  generatorVersion: string; // the installed plugin/CLI version, written into the marker
}
