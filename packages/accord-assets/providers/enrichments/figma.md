# Enrichment: Figma

## URL trigger

Pattern: `https?://www\.figma\.com/(file|design|proto)/([a-zA-Z0-9]+)`

## Keyword search

Not supported — Figma enrichment is URL-triggered only. Design files are not meaningfully searchable by keyword.

### Fetch instructions

Use the Figma MCP tool if available, or fall back to the REST API:

```bash
# Get file metadata (not full design — just name, last modified, pages)
curl -s -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/<file_key>?depth=1"
```

### Fields to capture

| Field | Source |
|---|---|
| title | File name |
| last_modified | `lastModified` |
| url | Full Figma URL |
| pages | Top-level page/frame names (component inventory) |
| thumbnail | `thumbnailUrl` (reference only — not fetched) |

### Context budget

- URL-triggered only: file name + page list + last modified (max 200 tokens)
- No keyword search mode

### TTL

`ttl_hours: 48` — Design files change infrequently day-to-day.

### Fallback

If no MCP tool or no `FIGMA_ACCESS_TOKEN`:

```json
{ "source": "figma", "status": "unavailable", "reason": "Figma API not configured — design reference noted but not fetched" }
```
