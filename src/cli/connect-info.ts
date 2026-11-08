import { buildInfo } from "../connect/info.js";
import { readConfigWithPin, readFailure } from "./read-config.js";
import type { Handler } from "./types.js";
import { INSTALLED_VERSION } from "./version.js";

// Pure and read-only: the config in, the commands and MCP entries a skill needs out. Never runs anything.
export const connectInfo: Handler = ({ root }) => {
  const read = readConfigWithPin(root);
  if (read.kind !== "ok") return { exitCode: 1, body: { ok: false, errors: readFailure(root, read) } };
  return { exitCode: 0, body: buildInfo(read.config, INSTALLED_VERSION) };
};
