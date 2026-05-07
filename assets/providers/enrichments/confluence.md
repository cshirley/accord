# Enrichment: Confluence

## URL trigger

Pattern: `https?://[^/]*\.atlassian\.net/wiki/` or `https?://[^/]*/confluence/`

## Keyword search (configured mode)

When `space` is configured, search Confluence for pages matching ticket title/keywords within that space. Optionally filter by `labels`.

### Fetch instructions

Use the Atlassian MCP tool if available (`mcp__claude_ai_Atlassian__searchConfluence` or `mcp__atlassian__confluence_search`), or fall back to the REST API:

```bash
# CQL search scoped to space and optional labels
curl -s -u "$ATLASSIAN_EMAIL:$ATLASSIAN_API_TOKEN" \
  "https://<instance>.atlassian.net/wiki/rest/api/content/search?cql=space=<SPACE>+and+text~\"<keywords>\"+and+label+in+(<labels>)&limit=5"
```

For a specific page URL, extract the page ID:
```bash
curl -s -u "$ATLASSIAN_EMAIL:$ATLASSIAN_API_TOKEN" \
  "https://<instance>.atlassian.net/wiki/rest/api/content/<page_id>?expand=body.view,version"
```

### Fields to capture

| Field | Source |
|---|---|
| title | Page title |
| summary | First 500 words or the page abstract section |
| labels | Page labels |
| last_modified | Version date |
| url | Full page URL |
| key_sections | Headings matching ticket keywords + first paragraph under each |

### Context budget

- URL-triggered: page title + first 800 tokens of body
- Keyword search: top 3 matching pages, 400 tokens each

### TTL

`ttl_hours: 24` — Confluence pages are typically stable within a sprint.

### Fallback

If no MCP tool or API credentials:

```json
{ "source": "confluence", "status": "unavailable", "reason": "Confluence API not configured or inaccessible" }
```
