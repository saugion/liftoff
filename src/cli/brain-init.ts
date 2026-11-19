import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { brainPaths, symlinkProblem } from "../brain/paths.js";
import { proposals, scaffoldFiles } from "../brain/scaffold.js";
import { atomicWrite, resolveReal } from "./fsutil.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import { GITIGNORE_PATH, ensureSelfIgnore } from "./state.js";
import type { Handler, Outcome } from "./types.js";

export const brainFail = (code: "no-brain" | "brain-invalid", message: string, extra: object = {}): Outcome => ({
  exitCode: 1,
  body: { ok: false, errors: [{ code, message, ...extra }] },
});

export const NO_BRAIN = "liftoff.yaml has no brain section: the lead enables the brain in liftoff.yaml (Brain skill, Setup)";

// Plans the brain's folders and files; with --write creates what is missing. Never overwrites, never deletes.
export const brainInit: Handler = ({ root, write }) => {
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  const { brain, agents } = read.config;
  if (!brain) return brainFail("no-brain", NO_BRAIN);

  const realRoot = resolveReal(root);
  const paths = brainPaths(brain.dir);
  const link = symlinkProblem(realRoot, paths);
  if (link) return brainFail("brain-invalid", `${link} is or contains a symlink: the brain must be plain folders inside the repo`, { file: link });

  const ignoreText = existsSync(join(realRoot, GITIGNORE_PATH)) ? readFileSync(join(realRoot, GITIGNORE_PATH), "utf8") : undefined;
  const needsIgnore = ignoreText === undefined || !ignoreText.split(/\r?\n/).some((l) => l.trim() === "*");
  const files = [
    { path: GITIGNORE_PATH, exists: !needsIgnore, content: "*\n" },
    ...scaffoldFiles(paths).map((f) => ({ ...f, exists: existsSync(join(realRoot, f.path)) })),
  ];
  const planned = files.filter((f) => !f.exists);
  if (write) {
    if (needsIgnore) ensureSelfIgnore(realRoot);
    for (const f of planned) if (f.path !== GITIGNORE_PATH) atomicWrite(join(realRoot, f.path), f.content);
  }
  return {
    exitCode: 0,
    body: {
      ok: true,
      written: write === true,
      files: files.map((f) => ({ path: f.path, action: f.exists ? "exists" : write ? "created" : "create" })),
      paths,
      proposals: proposals(agents.targets, paths),
    },
  };
};
