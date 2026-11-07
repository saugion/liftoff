import pkg from "../../package.json" with { type: "json" };

// The installed plugin version is this CLI's own version (the CLI ships inside the plugin).
export const INSTALLED_VERSION: string = pkg.version;
