import { withMarker } from "./marker.js";
import type { RenderedFile } from "./types.js";

// Marker and the import, nothing else: Copilot cloud agent and CLI read CLAUDE.md too, so it must hold
// no Claude-only rules. Always rendered, because Claude Code reads AGENTS.md alone only when no CLAUDE.md exists.
export const CLAUDE_BODY = "@AGENTS.md\n";

export const claudeFile = (path: string, generatorVersion: string): RenderedFile => ({
  path,
  agent: "claude-code",
  content: withMarker(generatorVersion, CLAUDE_BODY),
});
