# Provider: GitLab

## Fetch instructions

Use the GitLab MCP tool if available, or fall back to the `glab` CLI:

```bash
glab issue view <number>
```

Or via the API if `GITLAB_TOKEN` and `GITLAB_PROJECT` are set:

```bash
curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://gitlab.com/api/v4/projects/$GITLAB_PROJECT/issues/<number>"
```

### Fields to capture

| Field | Source |
|---|---|
| summary | `.title` |
| description | `.description` (GitLab Flavoured Markdown) |
| labels | `.labels[]` |
| linked issues | Parse `#<number>` references and related issues from description; also check `.references.related` |
| acceptance criteria | Embedded in description — look for "Acceptance Criteria", task lists, or Given/When/Then |
| milestone | `.milestone.title` |
| weight | `.weight` |
| epic | `.epic.title` |

### ID format

The `work_item_id` may be:
- `PROJ-123` → extract `123` as the issue number
- `#123` → use `123` directly
- A full GitLab URL → parse the number from the path

### Fallback

If `glab` is not installed, no API token is set, or the issue doesn't exist, return:

```json
{ "status": "done", "context": "GitLab issue <number> not found or glab CLI unavailable. Proceeding with user-provided description only." }
```
