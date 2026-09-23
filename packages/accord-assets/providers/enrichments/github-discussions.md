# Enrichment: GitHub Discussions

## URL trigger

Pattern: `https?://github\.com/[^/]+/[^/]+/discussions/(\d+)`

## Keyword search (configured mode)

When enabled, search the current repo for discussions matching ticket keywords:

```bash
gh api graphql -f query='{ search(query: "repo:<owner>/<repo> <keywords>", type: DISCUSSION, first: 5) { nodes { ... on Discussion { number title body url answer { body } comments(first: 5) { nodes { body } } } } } }'
```

### Fields to capture

| Field | Source |
|---|---|
| title | Discussion title |
| summary | Discussion body (first 500 words) |
| answer | Accepted answer body (if exists) |
| key_comments | Most-upvoted or author-highlighted comments |
| url | Full discussion URL |
| category | Discussion category |

### Context budget

- URL-triggered: title + body + answer (max 800 tokens)
- Keyword search: top 3 discussions, 300 tokens each (title + answer only)

### TTL

`ttl_hours: 24` — Discussions are relatively stable once an answer is accepted.

### Fallback

If `gh` CLI not installed, repo has no discussions, or API error:

```json
{ "source": "github-discussions", "status": "unavailable", "reason": "GitHub Discussions not available for this repo" }
```
