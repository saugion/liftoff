import { type Agent, type Config, type StreamsConfig, connectors } from "../config/index.js";
import { keychainCommands, launcher, preflight, TOKEN_ENV } from "./launcher.js";
import { shQuote } from "./shell.js";
import { JIRA_TOOLS, TOOLSETS } from "./tools.js";

const FILES: Record<Agent, { file: string; serversKey: string; extra: object }> = {
  "claude-code": { file: ".mcp.json", serversKey: "mcpServers", extra: {} },
  copilot: { file: ".vscode/mcp.json", serversKey: "servers", extra: { type: "stdio" } },
};

// Everything a skill needs to connect a machine, as data. Pure: no command is run, nothing is read or written.
export function buildInfo(config: Config, installedVersion: string) {
  const { tracker, codeHost } = connectors(config);

  const mcp = tracker
    ? [...config.agents.targets].sort().map((agent) => ({
        agent,
        file: FILES[agent].file,
        serversKey: FILES[agent].serversKey,
        server: "liftoff-jira",
        entry: {
          ...FILES[agent].extra,
          command: "sh",
          args: ["-c", launcher(tracker)],
          env: {
            JIRA_URL: tracker.url,
            JIRA_SSL_VERIFY: String(tracker.server.sslVerify),
            READ_ONLY_MODE: String(tracker.server.readOnly),
            ENABLED_TOOLS: JIRA_TOOLS.join(","),
            TOOLSETS: TOOLSETS.join(","),
          },
        },
      }))
    : [];

  const credential = tracker && {
    envVar: TOKEN_ENV,
    envCheck: `[ -n "$(printenv ${TOKEN_ENV})" ]`,
    keychain: keychainCommands(tracker),
    preflight: preflight(tracker),
    createToken:
      "In Jira: your profile, Personal Access Tokens, Create token (an admin may have to enable personal access tokens).",
  };

  const prerequisites = [
    ...(tracker ? [{ id: "uv", why: "runs the Jira MCP server", check: "uvx --version", install: "brew install uv" }] : []),
    ...(codeHost ? [{ id: "glab", why: "GitLab access", check: "glab --version", install: "brew install glab" }] : []),
  ];

  const gitlab = codeHost && {
    host: codeHost.host,
    login: `glab auth login --hostname ${shQuote(codeHost.host)}`,
    status: `glab auth status --hostname ${shQuote(codeHost.host)} -F json`,
  };

  return {
    ok: true as const,
    installedVersion,
    agents: config.agents.targets,
    tracker: tracker ?? null,
    codeHost: codeHost ?? null,
    modules: (config.modules?.items ?? []).map((m) => ({ id: m.id, path: m.path })),
    streams: tracker && config.streams && "items" in config.streams ? (config.streams as StreamsConfig).items : [],
    mcp,
    credential: credential ?? null,
    prerequisites,
    gitlab: gitlab ?? null,
  };
}
