---
name: agent-print
description: Run a one-shot non-interactive Agent task with JSON-friendly output (document pattern for scripts).
---

# Non-interactive agent one-shot

Use this pattern when a human or pipeline needs a single answer without the TUI:

1. From the repository root (or pass `--workspace`), run:

   `agent -p "Your clear task" --output-format json`

2. Parse the printed JSON in the caller; handle non-zero exit on failure.

3. For multi-step or streaming control, prefer `Agent.create` from `@cursor/sdk` or an ACP client instead of shell-glue.

Adjust flags for Plan or Ask mode if the task must not modify files (`--mode=ask` or `--mode=plan`).
