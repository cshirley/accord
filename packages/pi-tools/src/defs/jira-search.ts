import { defineTool } from "../framework.js";
import { getJiraAuth } from "../auth.js";
import {
  makeJiraRequest, mapIssue, DEFAULT_FIELDS, DEFAULT_CLOUD_ID,
  type JiraSearchResponse, type MappedIssue,
} from "../services/jira.client.js";

export default defineTool<
  { jql: string; maxResults?: number; fields?: string[]; cloudId?: string },
  MappedIssue[]
>({
  name: "atlassian-searchJiraIssuesUsingJql",
  label: "Search Jira Issues",
  description: "Search Jira issues using JQL query",

  params: {
    jql:        { type: "string", required: true, description: "JQL query string" },
    maxResults: { type: "number", default: 15, description: "Maximum results to return" },
    fields:     { type: "string[]", description: "Fields to include in response" },
    cloudId:    { type: "string", description: "Cloud ID (optional, uses configured instance)" },
  },

  auth: { check: () => !!getJiraAuth(), service: "jira" },
  progress: (p) => `Searching Jira: ${p.jql}`,

  async execute(p) {
    const resp = await makeJiraRequest("search/jql", {
      jql: p.jql,
      maxResults: p.maxResults || 15,
      fields: p.fields?.join(",") || DEFAULT_FIELDS,
    }) as JiraSearchResponse;
    return resp.issues.map(mapIssue);
  },

  mcp: {
    server: "atlassian",
    tool: "searchJiraIssuesUsingJql",
    mapParams: (p) => ({ cloudId: p.cloudId || DEFAULT_CLOUD_ID, jql: p.jql, maxResults: p.maxResults || 15 }),
    mapResult: (raw: any) => (raw.issues ?? []).map(mapIssue),
  },

  format(issues) {
    if (issues.length === 0) return { text: "No issues found", details: {} };
    const lines = issues.map((i) => `${i.key} | ${i.status} | ${i.updated} | ${i.summary}`);
    return {
      text: `${issues.length} issues\n${lines.join("\n")}`,
      details: { count: issues.length, issues },
    };
  },
});
