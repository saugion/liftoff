import { withMarker } from "./marker.js";
import type { RenderedFile } from "./types.js";

export const COPILOT_PATH = ".github/copilot-instructions.md";

// A pointer, not a copy: stack, modules and rules live in AGENTS.md, copies would drift. Only the quality-bar
// path comes from the config. Some Copilot surfaces read only this file, so the sentence has to be self-explanatory.
export const copilotBody = (constraintsFile: string): string =>
  `Project instructions live in \`AGENTS.md\` at the repository root. Follow it and \`${constraintsFile}\`.\n`;

export const copilotFile = (constraintsFile: string, generatorVersion: string): RenderedFile => ({
  path: COPILOT_PATH,
  agent: "copilot",
  content: withMarker(generatorVersion, copilotBody(constraintsFile)),
});
