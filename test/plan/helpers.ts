import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "../../src/cli/main.js";
import { tempDir } from "../helpers.js";

export const CONFIG = `liftoff: 1
plugin: { version: "0.2" }
project: { name: acme, kind: existing }
agents: { targets: [claude-code] }
tracker:
  kind: jira-dc
  url: https://jira.company.local
  project: PROJ
  server: { version: "0.23.1" }
  issueTypes:
    - name: Story
      branchType: feature
      readingMap:
        acceptanceCriteria: { heading: "Acceptance criteria" }
        fields:
          - { id: customfield_10016, label: Story points }
      transitions:
        start: { name: Start progress }
        review: { name: Ready for review }
    - name: Bug
      readingMap:
        acceptanceCriteria: { field: customfield_10201 }
codeHost:
  kind: gitlab
  host: gitlab.company.local
  conventions:
    targetBranch: main
    branchPattern: "{type}/{key}-{slug}"
    titlePattern: "{key}: {summary}"
    mrTemplate: .gitlab/merge_request_templates/Default.md
    labels: [backend]
    reviewers: [alice]
`;

export function repo(config = CONFIG, files: Record<string, string> = {}): string {
  const dir = tempDir();
  writeFileSync(join(dir, "liftoff.yaml"), config);
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}

export const cli = (args: string[]) => {
  const r = run(args, "/");
  return { exitCode: r.exitCode, body: JSON.parse(r.stdout) as Record<string, any> };
};
