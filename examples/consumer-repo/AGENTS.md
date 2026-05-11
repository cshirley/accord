# Consumer Repo AGENTS.md template

This is a copy-pasteable template for consumers of the ACCORD autopipeline.

The `## Dev Harness` JSON block below is the source of truth for the project's
test/lint/typecheck commands. The autopipeline's AGENTS.md gate (AC-2) reads
the first fenced ```json block inside this section and refuses to run phases
unless `test.command` is a non-empty string.

## Dev Harness

```json
{
  "schema_version": "1.0",
  "language": "typescript",
  "test": {
    "command": "bun test",
    "file_pattern": "**/*.test.ts"
  },
  "type_check": "bun run check:types",
  "lint": null,
  "format": null,
  "tracker": {
    "type": "jira",
    "trigger_status": "Ready for Autopilot"
  },
  "verification_commands": [
    "bun test",
    "bun run check:types"
  ]
}
```
