import { getJiraAuth } from "../auth.js";
import { defineTool } from "../framework.js";
import { type JiraField, loadJiraFields } from "../services/jira.client.js";

export default defineTool<{ query?: string }, JiraField[]>({
  name: "atlassian-listJiraFields",
  label: "List Jira Fields",
  description:
    "List Jira fields (system and custom) with their IDs. Optional case-insensitive substring filter on the field name — use to discover custom field IDs (e.g. CRQ change-window fields) deterministically before calling atlassian-getJiraIssueFields.",

  params: {
    query: { type: "string", description: "Optional case-insensitive name filter" },
  },

  auth: { check: () => !!getJiraAuth(), service: "jira" },
  progress: "Listing Jira fields...",

  async execute(p) {
    const fields = await loadJiraFields();
    const q = p.query?.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter((f) => f.name.toLowerCase().includes(q));
  },

  format(fields) {
    if (fields.length === 0) return { text: "No matching fields", details: { fields } };
    const shown = fields.slice(0, 50);
    const lines = shown.map((f) => `${f.id} | ${f.name}${f.custom ? " (custom)" : ""}`);
    return {
      text: `${fields.length} field(s)${fields.length > 50 ? " (showing 50)" : ""}\n${lines.join("\n")}`,
      details: { fields },
    };
  },
});
