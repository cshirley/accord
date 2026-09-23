# Cursor hook examples

Host-neutral scripts that wire ACCORD harness callables into Cursor (or any editor with subprocess hooks).

## Minimum hook set

| Hook site | Script | Core callable |
|-----------|--------|---------------|
| After `write` / `edit` | `validate-artifact-on-write.ts` | `validateHarnessArtifactWriteIfApplicable` |
| After `subagent` | `process-subagent-result.ts` | `processSubagentToolResult` |

## Usage

Point your hook runner at Bun with `ACCORD_CWD` set to the project root:

```json
{
  "afterToolCall": [
    {
      "command": "bun",
      "args": ["packages/accord-mcp/examples/cursor-hooks/validate-artifact-on-write.ts"]
    }
  ]
}
```

MCP stdio mode does not inject these automatically — the MCP client must wire them (or use Pi for full hook parity).
