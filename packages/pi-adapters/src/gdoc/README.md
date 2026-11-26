# Google Doc → Markdown

Pi extension that exports Google Docs to local Markdown files.

## Features

- `/gdoc-md <url-or-id> [output.md]` — save doc as Markdown in cwd (or given path)
- `google_doc_to_markdown` tool — same export, callable by the agent
- **Native Markdown export** via Drive API `text/markdown` when google-workspace OAuth is available
- **MCP fallback** via `docs_getText` (plain text; supports `tabId` for multi-tab docs)
- **HTML export fallback** when markdown export is unavailable

## Prerequisites

- `google-workspace` MCP server configured in `~/.pi/agent/mcp.json`
- Authenticated Google account (same OAuth used by google-workspace MCP)

## Usage

```text
/gdoc-md https://docs.google.com/document/d/ABC123/edit
/gdoc-md ABC123 ./notes/spec.md
```

Default output: `<document-title>.md` in the current working directory.

## How it works

1. If `tabId` is set, uses google-workspace MCP `docs_getText` for that tab
2. Otherwise tries Drive API `files.export` (`text/markdown`) using OAuth from macOS Keychain (`gemini-cli-workspace-oauth`)
3. Falls back to MCP `docs_getText` (plain text)
4. Last resort: Drive `text/html` export converted locally to Markdown

Reload after changes: `/reload`
