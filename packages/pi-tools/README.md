# Tool Integrations

Declarative tool definitions for Jira, Slack, Gmail, and Calendar.
Each tool is a single file exporting a `defineTool()` object.
The framework handles registration, provider chain wiring, and formatting.

## Structure

```
tools/
├── index.ts                     # Auto-registers all defs + commands
├── framework.ts                 # defineTool(), registerToolDefs(), schema conversion
├── auth.ts                      # Credential store (no pi dependency)
├── mcp-registry.ts              # Generic MCP client pool
│
├── defs/                        # One file per tool (25-45 lines each)
│   ├── jira-search.ts           #   ↳ native REST → atlassian MCP fallback
│   ├── jira-get.ts              #   ↳ native REST → atlassian MCP fallback
│   ├── gmail-search.ts          #   ↳ native OAuth → google-workspace MCP fallback
│   ├── gmail-get.ts             #   ↳ native OAuth → google-workspace MCP fallback
│   ├── gmail-thread.ts          #   ↳ native OAuth → google-workspace MCP fallback
│   ├── calendar-events.ts       #   ↳ native OAuth → google-workspace MCP fallback
│   ├── slack-search.ts          #   ↳ native REST (no MCP)
│   ├── slack-unread.ts          #   ↳ native REST (no MCP)
│   ├── slack-dm-history.ts      #   ↳ native REST (no MCP)
│   ├── slack-channel-history.ts #   ↳ native REST (no MCP)
│   ├── slack-user-info.ts       #   ↳ native REST (no MCP)
│   ├── slack-conversations.ts   #   ↳ native REST (no MCP)
│   └── preflight.ts             #   ↳ connectivity test for all services
│
├── services/                    # Shared HTTP clients (types, mappers)
│   ├── jira.client.ts
│   ├── slack.client.ts
│   └── google.client.ts
│
└── commands/                    # Interactive setup/status per service
    ├── jira.commands.ts
    ├── slack.commands.ts
    └── google.commands.ts
```

## Adding a New Tool

Create one file in `defs/`, add its import to `index.ts`:

```typescript
// defs/my-tool.ts
import { defineTool } from "../framework.js";

export default defineTool({
  name: "my-tool",
  label: "My Tool",
  description: "Does something useful",
  params: { query: "string" },
  progress: (p) => `Running: ${p.query}`,

  async execute(p) {
    const data = await callMyApi(p.query);
    return data;
  },

  // Optional MCP fallback — omit if no MCP server
  mcp: {
    server: "my-server",
    tool: "my_tool",
    mapParams: (p) => ({ q: p.query }),
    mapResult: (raw) => raw,
  },

  format(result) {
    return { text: `Found ${result.length} items`, details: { result } };
  },
});
```

That's it. ~25 lines for a complete tool.

## How It Works

```
defineTool({ params, execute, mcp?, format })
  │
  framework.ts converts to:
  │
  ├── TypeBox schema ← from params (auto-generated)
  ├── pi.registerTool() ← name, label, description, parameters
  ├── onUpdate ← from progress (string or fn)
  ├── Provider chain:
  │     ├── native: auth.check() → execute(params) → TResult
  │     └── mcp: isAvailable() → call server → mapResult() → TResult
  └── format(result) → { content, details }  ← called ONCE
```

Both `execute()` and `mcp.mapResult()` return the same domain type.
`format()` is called once, regardless of which provider succeeded.
No duplicate formatting.

## Error Handling

When all providers fail:
```
[jira-search] all 2 providers failed:
  • native: Jira API error (401): Unauthorized
  • mcp:atlassian/searchJiraIssuesUsingJql: MCP server exited
```

## Setup

```bash
/jira-setup        # Atlassian email + API token
/jira-status
/slack-setup       # Slack token (xoxp- or xoxb-)
/slack-status
/google-setup      # OAuth2 or handoff mode
/google-status
```
