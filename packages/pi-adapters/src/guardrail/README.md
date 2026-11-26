# guardrail

Risk-classified gate for bash tool calls. Intercepts commands, classifies them
by risk level, and prompts for user confirmation before execution.

> Renamed from `dangerous-command-gate`. Legacy session entry keys
> (`dangerous-command-gate`, `dangerous-command-gate-context`) are still
> read on session restore so resumed sessions keep their remembered choices.

## Risk Levels

| Risk | Badge | Behaviour | Categories |
|------|-------|-----------|------------|
| **High** | 🔴 | Always prompts; blocked in non-interactive mode | destructive-fs, privilege-escalation, system-control, disk-format |
| **Medium** | 🟡 | Prompts interactively; allowed with warning non-interactively | permission-change, package-uninstall, network-exfiltration, git-destructive, kill-process, docker-destructive, credential-exposure, sensitive-path-write |

## Usage

The extension is auto-loaded from `~/.pi/agent/extensions/guardrail/`.

### Commands

| Command | Description |
|---------|-------------|
| `/guardrail` (alias `/gate`) | Show current status and remembered choices |
| `/guardrail on` | Enable the guardrail |
| `/guardrail off` | Disable the guardrail |
| `/guardrail reset` | Clear all remembered allow/block choices |

### Keyboard Shortcut

`Ctrl+Alt+G` — Toggle on/off.

### Interactive Prompt

When a risky command is detected, you'll see:

```
⚠️  Risky command detected  🔴 HIGH

  $ rm -rf /tmp/test

Matched rules:
  🔴 HIGH  destructive-fs — Recursive or forced file deletion

> Allow once
  Allow this category for session
  Block
  Block this category for session
```

**"Allow this category for session"** remembers the decision — subsequent commands in the same category won't prompt again until you `/guardrail reset` or start a new session.

### Non-Interactive Mode

When running without a UI (e.g., piped input):
- 🔴 High-risk commands are **blocked** automatically
- 🟡 Medium-risk commands are **allowed** (the LLM can self-correct)

### System Prompt

When active, the guardrail injects guidance nudging the LLM toward safer alternatives:
- `trash` over `rm -rf`
- Dry-run flags before destructive operations
- Narrow permission scopes over `chmod -R 777`

The injected prompt is tagged with `customType: "guardrail-context"` and
auto-stripped when the guardrail is disabled.

## Extending Patterns

Edit `patterns.ts` to add new rules. Each rule needs:

```typescript
{
  category: "my-category",     // unique identifier
  risk: "high" | "medium",    // risk classification
  description: "What it does", // shown in the prompt
  patterns: [/\bmy-regex\b/i], // one or more RegExp matchers
}
```

Run `/reload` to pick up changes.

## File structure

```
guardrail/
├── index.ts     Hooks (tool_call, before_agent_start, context, session_start),
│                /guardrail and /gate commands, Ctrl+Alt+G shortcut, status indicator
├── patterns.ts  Pattern rules + classify() function
└── README.md    This file
```
