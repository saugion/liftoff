export const config = (jiraUrl: string, opts: { readOnly?: boolean; connectors?: boolean } = {}) => `liftoff: 1
plugin: { version: "${opts.connectors === false ? "0.1" : "0.2"}" }
project: { name: acme-billing, kind: existing }
agents: { targets: [claude-code, copilot] }
modules:
  items:
    - { id: backend, path: backend, description: Java backend }
constraints: { required: true, file: CONSTRAINTS.md }
${opts.connectors === false ? "" : `tracker:
  kind: jira-dc
  url: ${jiraUrl}
  project: PROJ
  server: { version: "0.23.1", sslVerify: false, readOnly: ${opts.readOnly ?? false} }
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
      branchType: bugfix
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
`}`;
