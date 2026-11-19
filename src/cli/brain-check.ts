import { checkBrain } from "../brain/check.js";
import { brainPaths } from "../brain/paths.js";
import { NO_BRAIN, brainFail } from "./brain-init.js";
import { resolveReal } from "./fsutil.js";
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
  });
  const ok = result.errors.length === 0;
  return { exitCode: ok ? 0 : 1, body: { ok, ...result } };
};
