# Provider: Jira

## Fetch instructions

Use `atlassian-getJiraIssue` (pi-tools), or the Atlassian MCP `getJiraIssue` tool (`mcp__atlassian__getJiraIssue`, `mcp__claude_ai_Atlassian__getJiraIssue`, or `mcp_pi-agent_atlassian-getJiraIssue` in Cursor). Pass `cloudId`: `babylonpartners.atlassian.net` and `issueIdOrKey` / `issueKey` for the work item id.

### Fields to capture

| Field | Source |
|---|---|
| summary | `fields.summary` |
| description | `fields.description` (may be Atlassian Document Format — extract plain text) |
| labels | `fields.labels` |
| parent epic | `fields.parent.key` or `fields.customfield_10014` (epic link) |
| linked issues | `fields.issuelinks[].inwardIssue.key` / `outwardIssue.key` |
| acceptance criteria | Embedded in description (look for "Acceptance Criteria", "ACs", or "Given/When/Then" blocks) |
| status | `fields.status.name` |
| priority | `fields.priority.name` |

### Fallback

If the MCP call fails or no ticket exists, return:

```json
{ "status": "done", "context": "No ticket found for <work_item_id>. Proceeding with user-provided description only." }
```
