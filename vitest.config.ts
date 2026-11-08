import { defineConfig } from "vitest/config";

// Unit tests run with the network switched off (test/no-network.ts). The end-to-end tests start a fake Jira on
// localhost and real child processes, so they run in their own project without that guard.
export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["test/**/*.test.ts"], exclude: ["test/e2e/**"], setupFiles: ["test/no-network.ts"] } },
      { extends: true, test: { name: "e2e", include: ["test/e2e/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000 } },
    ],
  },
});
