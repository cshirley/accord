# Enrichment: GitHub PRs

## URL trigger

Pattern: `https?://github\.com/[^/]+/[^/]+/pull/(\d+)`

Also triggered when the primary ticket (from any provider) references PR numbers like `PR #123` or `pull/123`.

## Keyword search (configured mode)

When enabled, search the current repo for recently merged PRs matching ticket keywords:

```bash
gh pr list --state merged --search "<keywords>" --limit 5 --json number,title,body,mergedAt
```

### Fetch instructions

For a specific PR:
```bash
gh pr view <number> --json title,body,comments,reviews,files,additions,deletions,changedFiles
```

### Fields to capture

| Field | Source |
|---|---|
| title | PR title |
| summary | PR body (first 500 words) |
| files_changed | `.files[].path` — list of changed files |
| review_comments | Key review comments (decisions, objections, approvals) |
| url | Full PR URL |
| merged_at | Merge timestamp |

### Context budget

- URL-triggered: title + body summary + file list (max 800 tokens)
- Keyword search: top 3 PRs, 300 tokens each (title + files only)

### TTL

`ttl_hours: 12` — PRs may receive new reviews/comments.

### Fallback

If `gh` CLI not installed or not authenticated:

```json
{ "source": "github-pr", "status": "unavailable", "reason": "gh CLI not available or not authenticated" }
```
