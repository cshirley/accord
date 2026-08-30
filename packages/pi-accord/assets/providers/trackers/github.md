# Provider: GitHub

## Fetch instructions

Use `bash` to run the GitHub CLI:

```bash
gh issue view <number> --json title,body,labels,milestone,assignees,projectItems,comments
```

If the ID looks like a PR (or the issue command fails), try:

```bash
gh pr view <number> --json title,body,labels,comments,reviewRequests
```

### Fields to capture

| Field | Source |
|---|---|
| summary | `.title` |
| description | `.body` (GitHub Flavoured Markdown) |
| labels | `.labels[].name` |
| linked issues | Parse `#<number>` references and `Fixes #`, `Closes #`, `Relates to #` from body |
| acceptance criteria | Look for `## Acceptance Criteria`, `- [ ]` task lists, or `Given/When/Then` blocks in body |
| milestone | `.milestone.title` |
| comments | `.comments[]` — scan for additional context or requirement clarifications |

### ID format

The `work_item_id` may be:
- `REPO-123` → extract `123` as the issue/PR number
- `#123` → use `123` directly
- A full URL → parse the number from the path

### Fallback

If `gh` is not installed or the issue doesn't exist, return:

```json
{ "status": "done", "context": "GitHub issue <number> not found or gh CLI unavailable. Proceeding with user-provided description only." }
```
