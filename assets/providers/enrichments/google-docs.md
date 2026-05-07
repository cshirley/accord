# Enrichment: Google Docs

## URL trigger

Pattern: `https?://docs\.google\.com/document/d/([a-zA-Z0-9_-]+)`

## Keyword search (configured mode)

When `folder_id` is configured, search Google Drive for documents matching ticket title/keywords within that folder.

### Fetch instructions

Use the Google Docs/Drive MCP tool if available, or fall back to the API via bash:

```bash
# Search for documents by keyword in a specific folder
curl -s -H "Authorization: Bearer $GOOGLE_ACCESS_TOKEN" \
  "https://www.googleapis.com/drive/v3/files?q='<folder_id>'+in+parents+and+fullText+contains+'<keywords>'&fields=files(id,name,modifiedTime)"
```

For a specific document URL, extract the doc ID and fetch content:
```bash
# Export as plain text
curl -s -H "Authorization: Bearer $GOOGLE_ACCESS_TOKEN" \
  "https://docs.googleapis.com/v1/documents/<doc_id>" | jq '.body.content'
```

### Fields to capture

| Field | Source |
|---|---|
| title | Document title |
| summary | First 500 words or the document abstract/TL;DR section |
| last_modified | Last modification timestamp |
| url | Full document URL |
| key_sections | Headers that match ticket keywords (extract heading + first paragraph) |

### Context budget

- URL-triggered: document title + TL;DR or first 800 tokens of body
- Keyword search: top 2 matching docs, 400 tokens each

### TTL

`ttl_hours: 24` — Documents change infrequently within a sprint.

### Fallback

If no MCP tool, no `GOOGLE_ACCESS_TOKEN`, or API returns error:

```json
{ "source": "google-docs", "status": "unavailable", "reason": "Google Docs API not configured or inaccessible" }
```
