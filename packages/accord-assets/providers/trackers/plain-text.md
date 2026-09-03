# Provider: Plain Text

## Fetch instructions

No external fetch is needed. The work item description was provided inline by the user or orchestrator via the `description` field in the brief.

Use the `description` field directly as the ticket body. There is no remote system to query.

### Fields to capture

| Field | Source |
|---|---|
| summary | First sentence or line of `description` |
| description | Full `description` text |
| labels | None |
| linked issues | Parse any `[A-Z]+(-[A-Z]+)*-\d+` patterns or `#\d+` references from the text |
| acceptance criteria | Look for "Acceptance Criteria", numbered lists, task lists, or Given/When/Then blocks |

### Fallback

If `description` is empty or missing, return:

```json
{ "status": "done", "context": "No description provided. Cannot gather context without a ticket source or inline description." }
```
