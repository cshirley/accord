import { getJiraAuth } from "../auth.js";
import { defineTool } from "../framework.js";
import {
  DEFAULT_CLOUD_ID,
  DETAIL_FIELDS,
  type DetailedIssue,
  makeJiraRequest,
  mapDetailedIssue,
} from "../services/jira.client.js";

export default defineTool<{ issueKey: string; cloudId?: string }, DetailedIssue>({
  name: "atlassian-getJiraIssue",
  label: "Get Jira Issue",
  description: "Get full details of a Jira issue including description and comments",

  params: {
    issueKey: { type: "string", required: true, description: "Issue key (e.g., STEP-12345)" },
    cloudId: { type: "string", description: "Cloud ID (optional)" },
  },

  auth: { check: () => !!getJiraAuth(), service: "jira" },
  progress: (p) => `Getting issue ${p.issueKey}`,

  async execute(p) {
    const issue = await makeJiraRequest(`issue/${p.issueKey}`, { fields: DETAIL_FIELDS });
    return mapDetailedIssue(issue);
  },

  mcp: {
    server: "atlassian",
    tool: "getJiraIssue",
    mapParams: (p) => ({ cloudId: p.cloudId || DEFAULT_CLOUD_ID, issueIdOrKey: p.issueKey }),
    mapResult: (raw: any) => mapDetailedIssue(raw),
  },

  format(issue) {
    const lines = [
      `${issue.key} | ${issue.status} | ${issue.priority} | ${issue.type}`,
      `Project: ${issue.project}${issue.assignee ? ` | Assignee: ${issue.assignee}` : ""} | Updated: ${issue.updated}`,
      `Summary: ${issue.summary}`,
      ``,
      `Description:`,
      issue.description,
    ];
    if (issue.comments.length > 0) {
      lines.push("", `Comments (${issue.comments.length}):`);
      for (const c of issue.comments) {
        lines.push(`  [${c.created}] ${c.author}: ${c.body}`);
      }
    }
    return {
      text: lines.join("\n"),
      details: issue as unknown as Record<string, unknown>,
    };
  },
});
