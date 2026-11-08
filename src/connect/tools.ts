// The Jira tools LiftOff allows the MCP server to expose, with the toolset each lives in. A tool is exposed only
// if it passes both ENABLED_TOOLS and TOOLSETS, so both are derived from this one table.
// Deliberately absent: delete, move, assign, batch, links, worklog, attachments, Confluence.
const TOOLSET_OF = {
  jira_get_issue: "jira_issues",
  jira_search: "jira_issues",
  jira_get_project_issues: "jira_issues",
  jira_create_issue: "jira_issues",
  jira_update_issue: "jira_issues",
  jira_search_fields: "jira_fields",
  jira_get_field_options: "jira_fields",
  jira_add_comment: "jira_comments",
  jira_get_transitions: "jira_transitions",
  jira_transition_issue: "jira_transitions",
  jira_get_project_issue_types: "jira_projects",
  jira_get_create_fields: "jira_projects",
} as const;

export const JIRA_TOOLS = Object.keys(TOOLSET_OF) as (keyof typeof TOOLSET_OF)[];
export const TOOLSETS = [...new Set(Object.values(TOOLSET_OF))];
export const toolsetOf = (tool: keyof typeof TOOLSET_OF): string => TOOLSET_OF[tool];
