# Enrichment: Slack

## URL trigger

Pattern: `https?://[^/]*slack\.com/archives/([A-Z0-9]+)/p(\d+)` or `#[a-z0-9_-]+` channel references.

## Keyword search (configured mode)

When `channels` are configured, search each channel for messages matching the ticket title/keywords.

### Fetch instructions

Use the Slack MCP tool if available (`mcp__slack__search_messages`), or fall back to the Slack API via bash:

```bash
# Search by keyword across configured channels
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/search.messages?query=<keywords>&count=10"
```

For a specific message URL (archive link), extract channel ID and timestamp:
```bash
# channel_id = C0123, ts = 456 (from p456 → 456 with dot before last 6 digits)
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/conversations.history?channel=<channel_id>&latest=<ts>&inclusive=true&limit=5"
```

### Fields to capture

| Field | Source |
|---|---|
| summary | First 2-3 sentences of the relevant message(s) |
| thread_context | If the message is in a thread, include parent + key replies |
| participants | Usernames of key contributors |
| url | Permalink to the message |
| channel | Channel name |

### Context budget

- Keyword search: return top 3 most relevant messages (max 500 tokens total)
- URL-triggered: return the linked message + up to 5 thread replies (max 800 tokens)

### TTL

`ttl_hours: 4` — Slack messages are ephemeral; conversations move fast.

### Fallback

If no MCP tool, no `SLACK_BOT_TOKEN`, or API returns error:

```json
{ "source": "slack", "status": "unavailable", "reason": "Slack API not configured or inaccessible" }
```
