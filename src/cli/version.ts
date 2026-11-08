import pkg from "../../package.json" with { type: "json" };

// The installed plugin version is this CLI's own version (the CLI ships inside the plugin).
export const INSTALLED_VERSION: string = pkg.version;

// What a skill shows when the installed plugin is older than the repo's pin: say how to update, per host.
export const outdatedMessage = (minimum?: string): string =>
  (minimum === undefined
    ? `this repo's config is for a newer LiftOff (installed ${INSTALLED_VERSION}). `
    : `this repo needs LiftOff ${minimum} or newer (installed ${INSTALLED_VERSION}). `) +
  "Claude Code: run /reload-plugins, or /plugin marketplace update liftoff. VS Code: update or reload the plugin.";

export { compareVersions, parseVersion } from "../config/version.js";
