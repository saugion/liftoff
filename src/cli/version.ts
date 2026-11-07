import pkg from "../../package.json" with { type: "json" };

// The installed plugin version is this CLI's own version (the CLI ships inside the plugin).
export const INSTALLED_VERSION: string = pkg.version;

// What a skill shows when the installed plugin is older than the repo's pin: say how to update, per host.
export const outdatedMessage = (minimum?: string): string =>
  (minimum === undefined
    ? `this repo's config is for a newer LiftOff (installed ${INSTALLED_VERSION}). `
    : `this repo needs LiftOff ${minimum} or newer (installed ${INSTALLED_VERSION}). `) +
  "Claude Code: run /reload-plugins, or /plugin marketplace update liftoff. VS Code: update or reload the plugin.";

// "x.y" or "x.y.z", missing patch = 0. Anything else (pre-release tags, junk) is unparseable.
export function parseVersion(v: string): [number, number, number] | undefined {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : undefined;
}

// Negative, zero or positive like a comparator; undefined when either side is unparseable.
export function compareVersions(a: string, b: string): number | undefined {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  if (!x || !y) return undefined;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}
