import { getJiraAuth } from "../auth.js";
import { defineTool } from "../framework.js";
import { getIssueWithFields, type IssueWithFields } from "../services/jira.client.js";

export default defineTool<{ issueKey: string; fields: string[] }, IssueWithFields>({
  name: "atlassian-getJiraIssueFields",
  label: "Get Jira Issue Fields",
  description:
    "Get specific fields of a Jira issue (e.g. a CRQ change request), including custom fields. Pass field names or IDs; names are resolved to custom field IDs automatically. Returns each field flattened to text plus the raw value.",

  params: {
    issueKey: { type: "string", required: true, description: "Issue key (e.g., CRQ-12345)" },
    fields: {
      type: "string[]",
      required: true,
      description:
        "Field names or IDs to retrieve (e.g. ['Change start date','Risk Level','customfield_10100'])",
    },
  },

  auth: { check: () => !!getJiraAuth(), service: "jira" },
  progress: (p) => `Getting fields for ${p.issueKey}`,

  async execute(p) {
    return getIssueWithFields(p.issueKey, p.fields);
  },

  format(issue) {
    const lines = [
      `${issue.key} | ${issue.status}`,
      `Summary: ${issue.summary}`,
      "",
      ...issue.fields.map((fld) => `${fld.name}: ${fld.value || "(empty)"}`),
    ];
    return {
      text: lines.join("\n"),
      details: issue as unknown as Record<string, unknown>,
    };
  },
});
