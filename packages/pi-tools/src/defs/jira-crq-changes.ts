import { getJiraAuth } from "../auth.js";
import { defineTool } from "../framework.js";
import { type CrqChangeManifest, getCrqLinkedIssues } from "../services/jira.client.js";

export default defineTool<{ crqKey: string }, CrqChangeManifest>({
  name: "atlassian-getCrqLinkedIssues",
  label: "Get CRQ Linked Changes",
  description:
    "Get the changes in a Jira CRQ (change request) — collected from both Jira issue links and the rich-text 'changes' field (smart-link cards + git-log block, for service-release CRQs with no issue links). Each change carries key, summary, status, a release-ready `statusDone` flag, type, and assignee (display name + email). Also derives the service name and GitHub repo (`emed-labs/<service>`) from the CRQ summary. Sibling CRQ links are excluded. Use as step 1 of a release notification, then resolve PR number/labels per ticket from GitHub and the Slack handle from the assignee email.",

  params: {
    crqKey: { type: "string", required: true, description: "CRQ key (e.g., CRQ-5326)" },
  },

  auth: { check: () => !!getJiraAuth(), service: "jira" },
  progress: (p) => `Getting linked changes for ${p.crqKey}`,

  async execute(p) {
    return getCrqLinkedIssues(p.crqKey);
  },

  format(m) {
    const header = [
      `${m.key} | ${m.status} | ${m.summary}`,
      `owner: ${m.owner || "(unassigned)"}  service: ${m.service || "(unknown)"}  repo: ${m.repo || "(unknown)"}`,
      m.rollbackPlan ? `rollback: ${m.rollbackPlan.slice(0, 160)}` : "rollback: (none)",
      `${m.issues.length} linked change(s):`,
    ];
    const lines = m.issues.map(
      (i) =>
        `${i.statusDone ? "✅" : "·"} ${i.key} | ${i.status} | ${i.summary}${
          i.assignee ? ` (${i.assignee})` : ""
        }`,
    );
    return {
      text: [...header, ...lines].join("\n"),
      details: m as unknown as Record<string, unknown>,
    };
  },
});
