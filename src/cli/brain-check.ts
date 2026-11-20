import { checkBrain } from "../brain/check.js";
import { brainPaths } from "../brain/paths.js";
import { handbookPaths } from "../handbook/paths.js";
import { INSTALLED_VERSION } from "./version.js";
import { NO_BRAIN, brainFail } from "./brain-init.js";
import { resolveReal } from "./fsutil.js";
import { today } from "./lesson-add.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import type { Handler } from "./types.js";

// Read-only health check of the brain. Exit 1 when there is an error; warnings alone keep exit 0.
export const brainCheck: Handler = ({ root }) => {
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  const { brain, modules } = read.config;
  if (!brain) return brainFail("no-brain", NO_BRAIN);
  const result = checkBrain({
    realRoot: resolveReal(root),
    paths: brainPaths(brain.dir),
    hotMaxLines: brain.hotMaxLines,
    moduleIds: (modules?.items ?? []).map((m) => m.id),
    ...(brain.lessons && {
      lessons: {
        files: [
          { path: "AGENTS.md", kind: "agents" as const },
          ...(modules?.items ?? []).map((m) => ({ path: `${m.path.replace(/\/+$/, "")}/AGENTS.md`, kind: "agents" as const })),
          { path: read.config.constraints?.file ?? "CONSTRAINTS.md", kind: "constraints" as const },
        ],
        maxRules: brain.lessons.maxRules,
        reviewAfterDays: brain.lessons.reviewAfterDays,
        today: today(),
      },
    }),
    ...(brain.handbook && {
      handbook: {
        paths: handbookPaths(brain.dir),
        maxPages: brain.handbook.maxPages,
        reviewAfterDays: brain.handbook.reviewAfterDays,
        installedVersion: INSTALLED_VERSION,
        moduleIds: (modules?.items ?? []).map((m) => m.id),
        today: today(),
        context: brain.handbook.context,
        instructionFiles: ["CLAUDE.md", "AGENTS.md", ...(modules?.items ?? []).map((m) => `${m.path.replace(/\/+$/, "")}/AGENTS.md`), read.config.constraints?.file ?? "CONSTRAINTS.md"],
      },
    }),
  });
  const ok = result.errors.length === 0;
  return { exitCode: ok ? 0 : 1, body: { ok, ...result } };
};
